// The application shell: the screen stack, the top bar, the shortcut panel on
// the right, global keys and saving.

import { fyEndOf, fyLabel, fyStartOf, VOUCHER_TYPES } from '../core/books.js';
import { loadData, saveData } from '../core/storage.js';
import { h, toast } from './dom.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-26" -> "26-Oct-2026". */
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
}

export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Shared state and navigation, passed to every screen. */
export const app = {
  data: null,
  company: null,
  /** The default date for new vouchers and reports, changed with F2. */
  workingDate: todayIso(),
  stack: [],
  screens: {},

  async start(screens) {
    this.screens = screens;
    this.data = await loadData();
    document.addEventListener('keydown', onKeyDown);
    this.reset(screens.companyList);
  },

  /** Writes all companies to disk. Call after every change. */
  async save() {
    try {
      await saveData(this.data);
    } catch (error) {
      toast(`Could not save: ${error.message}`, 'error');
      throw error;
    }
  },

  openCompany(company) {
    this.company = company;
    const today = todayIso();
    this.workingDate = today < company.booksFrom ? company.booksFrom : today;
    this.reset(this.screens.gateway);
  },

  closeCompany() {
    this.company = null;
    this.reset(this.screens.companyList);
  },

  /** The financial year around the working date, used as the default report period. */
  period() {
    return { from: fyStartOf(this.company, this.workingDate), to: fyEndOf(this.company, this.workingDate) };
  },

  push(factory) {
    this.stack.push({ factory });
    render();
  },

  replace(factory) {
    this.stack.pop();
    this.push(factory);
  },

  reset(factory) {
    this.stack = [];
    this.push(factory);
  },

  /** Goes back one screen, asking first if the current one has unsaved changes. */
  back({ force = false } = {}) {
    const top = this.current();
    if (!force && top?.isDirty?.() && !confirm('Discard the changes on this screen?')) return;
    if (this.stack.length <= 1) {
      if (this.company && this.stack[0]?.factory === this.screens.gateway) {
        if (confirm(`Close ${this.company.name}?`)) this.closeCompany();
      }
      return;
    }
    this.stack.pop();
    render();
  },

  current() {
    return this.stack.at(-1)?.screen;
  },

  /** Re-renders the current screen, e.g. after the working date changes. */
  refresh() {
    render();
  },

  openVoucher(type, voucher) {
    this.push(() => this.screens.voucher(type, voucher));
  },
};

const screenEl = () => document.getElementById('screen');

function render() {
  const top = app.stack.at(-1);
  if (!top) return;
  const screen = top.factory();
  top.screen = screen;
  screenEl().replaceChildren(screen.el);
  document.title = app.company ? `${screen.title} · ${app.company.name} · Hisaab` : 'Hisaab';
  renderTopBar(screen);
  renderKeys(screen);
  requestAnimationFrame(() => {
    const target = screen.el.querySelector('[autofocus]') ||
      screen.el.querySelector('input:not([disabled]), select, textarea, .menu-item');
    target?.focus();
  });
}

function renderTopBar(screen) {
  const bar = document.getElementById('topbar');
  const company = app.company;
  bar.replaceChildren(...[
    h('div', { class: 'brand' }, 'Hisaab'),
    h('div', { class: 'screen-title' }, screen.title),
    company ? h('div', { class: 'company-info' },
      h('strong', {}, company.name),
      h('span', {}, `FY ${fyLabel(company, app.workingDate)}`),
      h('button', { class: 'link', title: 'Change date (F2)', onclick: changeDate },
        `Date: ${formatDate(app.workingDate)}`),
    ) : null,
  ].filter(Boolean));
}

/** The right-hand panel: this screen's own shortcuts, then the voucher keys. */
function renderKeys(screen) {
  const panel = document.getElementById('keys');
  const button = (key, label, run) =>
    h('button', { class: 'key', onclick: run }, h('kbd', {}, key), h('span', {}, label));

  const own = (screen.keys || []).map((k) => button(k.key, k.label, k.run));
  const vouchers = app.company
    ? Object.entries(VOUCHER_TYPES).map(([type, t]) => button(t.key, t.name, () => app.openVoucher(type)))
    : [];
  panel.replaceChildren(...[
    own.length ? h('div', { class: 'key-group' }, own) : null,
    app.company ? h('div', { class: 'key-group' }, button('F2', 'Date', changeDate)) : null,
    vouchers.length ? h('div', { class: 'key-group' }, h('div', { class: 'key-heading' }, 'Vouchers'), vouchers) : null,
  ].filter(Boolean));
  document.getElementById('hints').textContent = [
    'Esc: Back',
    screen.onAccept ? 'Ctrl+A: Accept' : null,
    screen.onPrint ? 'Alt+P: Print' : null,
    screen.onExport ? 'Alt+E: Export' : null,
    'Enter: Next field',
  ].filter(Boolean).join('   ·   ');
}

// ---- Modal -----------------------------------------------------------------

let modal = null;

/** Shows `content` above the screen. Returns a function that closes it. */
export function openModal(title, content, { onAccept } = {}) {
  closeModal();
  const root = document.getElementById('modal-root');
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
    h('div', { class: 'modal-title' }, title, h('button', { class: 'link', onclick: closeModal }, 'Close (Esc)')),
    content);
  root.replaceChildren(h('div', { class: 'modal-backdrop' }, box));
  modal = { box, onAccept };
  requestAnimationFrame(() => box.querySelector('input, select, button')?.focus());
  return closeModal;
}

export function closeModal() {
  document.getElementById('modal-root').replaceChildren();
  modal = null;
}

function changeDate() {
  if (!app.company) return;
  const input = h('input', { type: 'date', value: app.workingDate, min: app.company.booksFrom });
  const apply = () => {
    if (!input.value) return;
    if (input.value < app.company.booksFrom) {
      toast(`Books begin on ${formatDate(app.company.booksFrom)}`, 'error');
      return;
    }
    app.workingDate = input.value;
    closeModal();
    app.refresh();
  };
  openModal('Change current date', h('div', { class: 'form' },
    h('p', { class: 'muted' }, 'New vouchers and reports use this date.'),
    input,
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: apply }, 'Accept'))),
  { onAccept: apply });
}

// ---- Keys ------------------------------------------------------------------

export function keyName(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey && event.key.length > 1) parts.push('Shift');
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join('+');
}

const FOCUSABLE = 'input:not([disabled]):not([type=hidden]):not([readonly]), select:not([disabled]), textarea, button.primary';

/** Tally-style Enter: move to the next field instead of submitting. */
function focusNext(from) {
  const scope = from.closest('.modal') || screenEl();
  const all = [...scope.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  const next = all[all.indexOf(from) + 1];
  if (next) {
    next.focus();
    if (next.select && next.tagName === 'INPUT') next.select();
  }
}

function onKeyDown(event) {
  const key = keyName(event);

  if (modal) {
    if (key === 'Escape') {
      event.preventDefault();
      closeModal();
    } else if ((key === 'Ctrl+A' || key === 'Ctrl+S') && modal.onAccept) {
      event.preventDefault();
      modal.onAccept();
    } else if (key === 'Enter') {
      enterToNext(event);
    }
    return;
  }

  const screen = app.current();
  if (screen?.onKey?.(event, key)) {
    event.preventDefault();
    return;
  }

  const handled = (() => {
    if (key === 'Escape') return app.back(), true;
    if ((key === 'Ctrl+A' || key === 'Ctrl+S') && screen?.onAccept) return screen.onAccept(), true;
    if (key === 'Alt+P' && screen?.onPrint) return screen.onPrint(), true;
    if (key === 'Alt+E' && screen?.onExport) return screen.onExport(), true;
    if (app.company) {
      if (key === 'F2') return changeDate(), true;
      const type = Object.keys(VOUCHER_TYPES).find((t) => VOUCHER_TYPES[t].key === key);
      if (type) return app.openVoucher(type), true;
    }
    const own = (screen?.keys || []).find((k) => k.key === key);
    if (own) return own.run(), true;
    return false;
  })();
  if (handled) {
    event.preventDefault();
    return;
  }
  if (key === 'Enter') enterToNext(event);
  // Stop the browser's own F-key actions (F5 reload and so on).
  if (/^F\d+$/.test(event.key)) event.preventDefault();
}

function enterToNext(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON' || target.type === 'checkbox') return;
  if (!target.matches('input, select')) return;
  if (target.getAttribute('list')) {
    // Let the suggestion list take the Enter first, then move on.
    setTimeout(() => focusNext(target), 0);
    return;
  }
  event.preventDefault();
  focusNext(target);
}
