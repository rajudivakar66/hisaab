// Electron main process: one window, the app:// protocol for the screens, and
// file access (the books, backups, PDFs) on behalf of the sandboxed renderer.

import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(here, 'renderer');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const dataFile = () => path.join(app.getPath('userData'), 'hisaab-data.json');

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** The books, or null on first run. Falls back to the previous save if the file is damaged. */
async function loadData() {
  try {
    return await readJson(dataFile());
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return readJson(dataFile() + '.bak');
  }
}

// Saves run one after another, each written to a temporary file and then
// renamed over the real one, so a crash mid-save never leaves half a file.
let saving = Promise.resolve();
function saveData(data) {
  saving = saving.catch(() => {}).then(async () => {
    const file = dataFile();
    const temp = file + '.tmp';
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temp, JSON.stringify(data));
    await fs.copyFile(file, file + '.bak').catch(() => {});
    await fs.rename(temp, file);
  });
  return saving;
}

const today = () => new Date().toISOString().slice(0, 10);

function registerIpc() {
  ipcMain.handle('data:load', () => loadData());
  ipcMain.handle('data:save', (_event, data) => saveData(data));
  ipcMain.handle('data:folder', () => path.dirname(dataFile()));
  ipcMain.handle('data:open-folder', () => shell.openPath(path.dirname(dataFile())));

  ipcMain.handle('backup:export', async (event, data) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Save backup',
      defaultPath: `Hisaab-backup-${today()}.json`,
      filters: [{ name: 'Hisaab backup', extensions: ['json'] }],
    });
    if (canceled || !filePath) return null;
    await fs.writeFile(filePath, JSON.stringify(data, null, 1));
    return filePath;
  });

  ipcMain.handle('backup:import', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Restore backup',
      properties: ['openFile'],
      filters: [{ name: 'Hisaab backup', extensions: ['json'] }],
    });
    if (canceled || !filePaths.length) return null;
    return readJson(filePaths[0]);
  });

  ipcMain.handle('print:pdf', async (event, name) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Save as PDF',
      defaultPath: `${String(name || 'document').replace(/[\\/:*?"<>|]/g, '-')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return null;
    const pdf = await event.sender.printToPDF({ printBackground: true, pageSize: 'A4' });
    await fs.writeFile(filePath, pdf);
    shell.openPath(filePath);
    return filePath;
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    title: 'Hisaab',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.loadURL('app://hisaab/index.html');
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', (request) => {
      const { pathname } = new URL(request.url);
      const file = path.normalize(path.join(rendererDir, decodeURIComponent(pathname)));
      if (!file.startsWith(rendererDir + path.sep)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    // No menu bar: on Windows its Alt+letter mnemonics would swallow the app's
    // own Alt shortcuts. Copy and paste still work in text fields without it.
    Menu.setApplicationMenu(null);
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', async () => {
    await saving.catch(() => {});
    app.quit();
  });
}
