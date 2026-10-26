// Loads and saves all companies as one document. In the desktop app the file
// lives in the user's AppData folder; opened in a plain browser (for
// development) it falls back to localStorage.

const KEY = 'hisaab-data';
export const DATA_VERSION = 1;

const empty = () => ({ version: DATA_VERSION, companies: [] });

export const isDesktop = () => typeof window !== 'undefined' && !!window.desktop;

export async function loadData() {
  let data = null;
  if (isDesktop()) {
    data = await window.desktop.load();
  } else {
    try {
      data = JSON.parse(localStorage.getItem(KEY));
    } catch {
      data = null;
    }
  }
  return isValidData(data) ? data : empty();
}

export async function saveData(data) {
  if (isDesktop()) return window.desktop.save(data);
  localStorage.setItem(KEY, JSON.stringify(data));
}

/** True when `data` looks like a Hisaab document (used before restoring a backup). */
export function isValidData(data) {
  return !!data && typeof data === 'object' && Array.isArray(data.companies) &&
    data.companies.every((c) => c && c.id && c.name && Array.isArray(c.ledgers) &&
      Array.isArray(c.groups) && Array.isArray(c.vouchers));
}
