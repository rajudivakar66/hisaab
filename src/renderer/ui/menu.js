// A keyboard menu: arrow keys move, Enter opens, and each item's highlighted
// letter opens it directly.

import { h } from './dom.js';

/**
 * sections: [{ title, items: [{ label, hotkey, run }] }]
 * Returns { el, onKey } to merge into a screen.
 */
export function keyboardMenu(sections) {
  const buttons = [];
  const el = h('div', { class: 'menu' }, sections.map((section) =>
    h('div', { class: 'menu-section' },
      h('div', { class: 'menu-heading' }, section.title),
      section.items.map((item) => {
        const button = h('button', { class: 'menu-item', onclick: item.run }, highlight(item.label, item.hotkey));
        buttons.push({ button, item });
        return button;
      }))));

  function onKey(event, key) {
    if (event.target.matches?.('input, select, textarea')) return false;
    const index = buttons.findIndex((b) => b.button === document.activeElement);
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const step = key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length].button.focus();
      return true;
    }
    if (key.length === 1) {
      const match = buttons.find((b) => b.item.hotkey?.toUpperCase() === key);
      if (match) {
        match.item.run();
        return true;
      }
    }
    return false;
  }

  return { el, onKey };
}

/** "Balance Sheet" with hotkey B -> <u>B</u>alance Sheet. */
function highlight(label, hotkey) {
  if (!hotkey) return label;
  const at = label.toUpperCase().indexOf(hotkey.toUpperCase());
  if (at < 0) return [label, h('span', { class: 'hotkey-tag' }, hotkey)];
  return [label.slice(0, at), h('u', {}, label[at]), label.slice(at + 1)];
}
