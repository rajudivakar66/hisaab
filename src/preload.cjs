// The only bridge between the screens and the computer. Each call goes to a
// handler in main.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  dataFolder: () => ipcRenderer.invoke('data:folder'),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  exportBackup: (data) => ipcRenderer.invoke('backup:export', data),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  savePdf: (name) => ipcRenderer.invoke('print:pdf', name),
});
