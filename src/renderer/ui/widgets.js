// Form controls shared by the masters and voucher screens.

import { findLedgerByName, ledgerBalance, ledgerById } from '../core/books.js';
import { formatAmount, formatBalance, toPaise } from '../core/money.js';
import { app } from './app.js';
import { h, uid } from './dom.js';

/**
 * A text box with suggestions that resolves to a ledger.
 * `filter(ledger)` limits the choices. `onChange(ledger|null)` fires when the
 * choice changes. Shows the ledger's current balance underneath.
 */
export function ledgerPicker({ filter = () => true, value = null, onChange = () => {}, placeholder = 'Ledger name' } = {}) {
  const listId = uid('ledgers');
  const list = h('datalist', { id: listId });
  const input = h('input', { list: listId, placeholder, autocomplete: 'off', class: 'ledger-input' });
  const balance = h('span', { class: 'cur-bal' });
  let current = value ? ledgerById(app.company, value) : null;

  function fillList() {
    list.replaceChildren(...app.company.ledgers.filter(filter)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((l) => h('option', { value: l.name })));
  }

  function showBalance() {
    balance.textContent = current
      ? `Cur Bal: ${formatBalance(ledgerBalance(app.company, current.id, app.workingDate))}`
      : '';
  }

  function resolve() {
    const found = findLedgerByName(app.company, input.value);
    const next = found && filter(found) ? found : null;
    input.classList.toggle('invalid', !!input.value.trim() && !next);
    if (next) input.value = next.name;
    if (next?.id !== current?.id) {
      current = next;
      onChange(current);
    }
    showBalance();
  }

  input.addEventListener('change', resolve);
  input.addEventListener('input', () => {
    // Choosing a suggestion fires `input` with the full name: resolve straight away.
    if (findLedgerByName(app.company, input.value)) resolve();
  });

  fillList();
  if (current) input.value = current.name;
  showBalance();

  return {
    el: h('div', { class: 'picker' }, input, list, balance),
    input,
    get ledger() {
      return current;
    },
    set(ledger) {
      current = ledger;
      input.value = ledger?.name || '';
      input.classList.remove('invalid');
      showBalance();
      onChange(current);
    },
    /** Picks up ledgers created since the picker was made. */
    refresh: fillList,
  };
}

/** A right-aligned amount box that stores paise and reformats on blur. */
export function amountInput({ value = 0, onChange = () => {}, placeholder = '0.00' } = {}) {
  const input = h('input', { class: 'amount', inputmode: 'decimal', placeholder, autocomplete: 'off' });
  let paise = value;
  const show = () => {
    input.value = paise ? formatAmount(paise) : '';
  };
  input.addEventListener('focus', () => {
    input.value = paise ? (paise / 100).toFixed(2) : '';
    input.select();
  });
  input.addEventListener('input', () => {
    const parsed = toPaise(input.value);
    input.classList.toggle('invalid', Number.isNaN(parsed));
    if (!Number.isNaN(parsed)) {
      paise = Math.abs(parsed);
      onChange(paise);
    }
  });
  input.addEventListener('blur', show);
  show();
  return {
    el: input,
    get value() {
      return paise;
    },
    set(next) {
      paise = next;
      if (document.activeElement === input) input.value = paise ? (paise / 100).toFixed(2) : '';
      else show();
    },
  };
}

/** A Dr/Cr switch next to an amount, for opening balances. */
export function balanceInput(signed = 0) {
  const amount = amountInput({ value: Math.abs(signed) });
  const side = h('select', { class: 'side' },
    h('option', { value: 'Dr', selected: signed >= 0 }, 'Dr'),
    h('option', { value: 'Cr', selected: signed < 0 }, 'Cr'));
  return {
    el: h('div', { class: 'balance-input' }, amount.el, side),
    get value() {
      return side.value === 'Cr' ? -amount.value : amount.value;
    },
    side,
  };
}
