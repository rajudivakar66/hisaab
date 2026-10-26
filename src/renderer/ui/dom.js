// A tiny helper for building DOM nodes without a framework.
//   h('button', { class: 'primary', onclick: save }, 'Save')

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else if (key === 'class') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key in el && typeof value !== 'string') {
      el[key] = value;
    } else if (key === 'value') {
      el.value = value;
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

let idCounter = 0;
export const uid = (prefix = 'id') => `${prefix}-${++idCounter}`;

/** Label + control stacked, for forms. */
export function field(label, control, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function toast(message, kind = 'info') {
  const holder = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}` }, message);
  holder.append(el);
  // Only the latest few stay on screen.
  while (holder.children.length > 3) holder.firstChild.remove();
  setTimeout(() => el.classList.add('leaving'), 2800);
  setTimeout(() => el.remove(), 3200);
}

/** Saves a table as CSV through the browser's download. */
export function downloadCsv(name, rows) {
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `${name}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV rows from a rendered table: header and body cells as text. */
export function tableRows(table) {
  return [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.querySelectorAll('th,td')].map((cell) => cell.textContent.trim()));
}
