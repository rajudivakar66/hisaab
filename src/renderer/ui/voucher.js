// Voucher entry for all eight voucher types.
//   Sales, Purchase, Credit Note, Debit Note: item invoice with GST.
//   Payment, Receipt, Contra: one cash/bank account against several ledgers.
//   Journal: free debit and credit lines.

import {
  BooksError, computeInvoice, deleteVoucher, GST_RATES, isCashOrBank, isPartyLedger, ledgerById,
  natureOf, nextVoucherNumber, saveVoucher, VOUCHER_TYPES,
} from '../core/books.js';
import { amountInWords, formatAmount } from '../core/money.js';
import { STATES } from '../core/states.js';
import { app, closeModal, openModal } from './app.js';
import { field, h, toast, uid } from './dom.js';
import { ledgerFormBody } from './masters.js';
import { amountInput, ledgerPicker } from './widgets.js';

const CASH_LAYOUT = {
  payment: { account: 'Paid from (cash / bank)', rows: 'Paid to', accountSign: -1 },
  receipt: { account: 'Received in (cash / bank)', rows: 'Received from', accountSign: 1 },
  contra: { account: 'From account (Cr)', rows: 'To account (Dr)', accountSign: -1 },
};

export function voucherScreen(type, existing) {
  const company = app.company;
  const meta = VOUCHER_TYPES[type];
  let dirty = false;

  const date = h('input', { type: 'date', value: existing?.date || app.workingDate, min: company.booksFrom });
  const numberLabel = h('span', { class: 'voucher-no' });
  const showNumber = () => {
    const sameYearAndType = existing && existing.type === type;
    numberLabel.textContent = `No. ${sameYearAndType ? existing.number : nextVoucherNumber(company, type, date.value || app.workingDate)}`;
  };
  date.addEventListener('change', showNumber);
  showNumber();

  const narration = h('textarea', { rows: 2, placeholder: 'Narration (optional)' }, existing?.narration || '');

  // Pickers register here so Alt+C can fill whichever one was used last.
  const pickers = [];
  let lastPicker = null;
  const track = (picker, defaultGroup) => {
    picker.defaultGroup = defaultGroup;
    picker.input.addEventListener('focus', () => { lastPicker = picker; });
    pickers.push(picker);
    return picker;
  };

  const body = meta.invoice
    ? invoiceBody(type, existing, track)
    : CASH_LAYOUT[type] ? cashBody(type, existing, track) : journalBody(existing, track);

  function build() {
    return { id: existing?.id, type, date: date.value, narration: narration.value, ...body.data() };
  }

  async function accept({ print = false } = {}) {
    let saved;
    try {
      saved = saveVoucher(company, build());
    } catch (error) {
      if (error instanceof BooksError) return toast(error.message, 'error');
      throw error;
    }
    await app.save();
    app.workingDate = saved.date;
    toast(`${meta.name} No. ${saved.number} saved`, 'success');
    if (print) {
      app.replace(() => app.screens.invoice(saved.id));
    } else if (existing) {
      app.back({ force: true });
    } else {
      app.replace(() => voucherScreen(type));
    }
  }

  async function remove() {
    if (!confirm(`Delete ${meta.name} No. ${existing.number}?`)) return;
    deleteVoucher(company, existing.id);
    await app.save();
    toast('Voucher deleted');
    app.back({ force: true });
  }

  function createLedger() {
    const target = lastPicker || pickers[0];
    const body = ledgerFormBody(null, {
      defaultGroup: target?.defaultGroup,
      defaultName: target?.ledger ? '' : target?.input.value.trim(),
      onSaved: (ledger) => {
        closeModal();
        pickers.forEach((p) => p.refresh());
        if (target && (!target.filter || target.filter(ledger))) target.set(ledger);
        toast(`Ledger "${ledger.name}" created`, 'success');
        target?.input.focus();
      },
      onCancel: closeModal,
    });
    openModal('Create ledger', body.el, { onAccept: body.accept });
  }

  const el = h('div', { class: 'page voucher' },
    h('div', { class: 'voucher-head' },
      h('h1', {}, meta.name, ' ', numberLabel, existing ? h('span', { class: 'badge' }, 'Alteration') : null),
      h('label', { class: 'inline' }, 'Date ', date)),
    body.el,
    field('Narration', narration),
    h('div', { class: 'actions' },
      existing ? h('button', { class: 'danger', onclick: remove }, 'Delete (Alt+D)') : null,
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => app.back() }, 'Cancel'),
      meta.invoice ? h('button', { onclick: () => accept({ print: true }) }, 'Accept & Print (Ctrl+P)') : null,
      h('button', { class: 'primary', onclick: () => accept() }, 'Accept (Ctrl+A)')));
  el.addEventListener('input', () => { dirty = true; });

  return {
    title: `${meta.name} Voucher`,
    el,
    onAccept: () => accept(),
    onPrint: existing && meta.invoice ? () => app.push(() => app.screens.invoice(existing.id)) : null,
    isDirty: () => dirty,
    keys: [
      { key: 'Alt+C', label: 'Create ledger', run: createLedger },
      ...(existing ? [{ key: 'Alt+D', label: 'Delete voucher', run: remove }] : []),
    ],
    onKey(event, key) {
      if (key === 'Ctrl+P' && meta.invoice) {
        accept({ print: true });
        return true;
      }
      // Another voucher key switches type in place instead of stacking screens.
      const other = Object.keys(VOUCHER_TYPES).find((t) => VOUCHER_TYPES[t].key === key);
      if (other && !existing) {
        if (dirty && !confirm('Discard this voucher?')) return true;
        app.workingDate = date.value || app.workingDate;
        app.replace(() => voucherScreen(other));
        return true;
      }
      return false;
    },
  };
}

// ---- Invoice ---------------------------------------------------------------

/** Item names used before, with their last HSN, unit, rate and GST rate. */
function knownItems(company) {
  const items = new Map();
  for (const v of company.vouchers) {
    for (const item of v.invoice?.items || []) items.set(item.name.toLowerCase(), item);
  }
  return items;
}

function invoiceBody(type, existing, track) {
  const company = app.company;
  const outward = type === 'sales' || type === 'creditNote';
  const inv = existing?.invoice;

  const placeOfSupply = h('select', {},
    STATES.map((s) => h('option', { value: s.name, selected: s.name === (inv?.placeOfSupply || company.state) },
      `${s.code} · ${s.name}`)));
  const partyInfo = h('div', { class: 'muted small' });
  const showPartyInfo = (ledger) => {
    partyInfo.textContent = ledger
      ? [ledger.address, ledger.state, ledger.gstin ? `GSTIN ${ledger.gstin}` : 'Unregistered'].filter(Boolean).join(' · ')
      : '';
  };
  const party = track(ledgerPicker({
    filter: (l) => isPartyLedger(company, l),
    value: inv?.partyId,
    placeholder: outward ? 'Customer, cash or bank' : 'Supplier, cash or bank',
    onChange: (ledger) => {
      showPartyInfo(ledger);
      if (ledger?.state) placeOfSupply.value = ledger.state;
      else if (ledger) placeOfSupply.value = company.state || placeOfSupply.value;
      recompute();
    },
  }), outward ? 'debtors' : 'creditors');
  party.filter = (l) => isPartyLedger(company, l);

  const wanted = outward ? 'income' : 'expense';
  const accountFilter = (l) => natureOf(company, l.groupId) === wanted;
  const defaultAccount = inv?.ledgerId || (ledgerById(company, outward ? 'sales' : 'purchase') ? (outward ? 'sales' : 'purchase') : null);
  const account = track(ledgerPicker({ filter: accountFilter, value: defaultAccount, placeholder: outward ? 'Sales ledger' : 'Purchase ledger' }),
    outward ? 'sales' : 'purchase');
  account.filter = accountFilter;

  const partyRef = h('input', { value: inv?.partyRef || '',
    placeholder: outward ? 'Order / reference no.' : 'Supplier invoice no.' });
  const roundOff = h('input', { type: 'checkbox', checked: inv ? inv.roundOff !== false : true });

  const known = knownItems(company);
  const itemListId = uid('items');
  const itemList = h('datalist', { id: itemListId }, [...known.values()].map((i) => h('option', { value: i.name })));

  const tbody = h('tbody');
  const rows = [];

  function addRow(item = {}) {
    const name = h('input', { value: item.name || '', list: itemListId, placeholder: 'Item or service', autocomplete: 'off' });
    const hsn = h('input', { value: item.hsn || '', class: 'short' });
    const qty = h('input', { value: item.qty ?? '', class: 'qty', inputmode: 'decimal' });
    const unit = h('input', { value: item.unit || '', class: 'short', placeholder: 'Nos' });
    const row = { item };
    const rate = amountInput({ value: item.rate || 0, onChange: recompute });
    const gst = h('select', { class: 'short' }, GST_RATES.map((r) =>
      h('option', { value: r, selected: r === (item.gstRate ?? 18) }, `${r}%`)));
    const amount = h('td', { class: 'num' });
    const removeButton = h('button', { class: 'link', title: 'Remove line', tabindex: -1, onclick: () => {
      rows.splice(rows.indexOf(row), 1);
      tr.remove();
      if (!rows.length) addRow();
      recompute();
    } }, '✕');
    const tr = h('tr', {},
      h('td', { class: 'muted' }),
      h('td', {}, name), h('td', {}, hsn), h('td', {}, qty), h('td', {}, unit), h('td', {}, rate.el),
      h('td', {}, gst), amount, h('td', {}, removeButton));
    Object.assign(row, { name, hsn, qty, unit, rate, gst, amount, tr });

    name.addEventListener('change', () => {
      // A known item fills in its last HSN, unit, rate and GST rate.
      const k = known.get(name.value.trim().toLowerCase());
      if (k && !hsn.value && !rate.value) {
        hsn.value = k.hsn;
        unit.value = k.unit;
        rate.set(k.rate);
        gst.value = String(k.gstRate);
      }
      recompute();
    });
    name.addEventListener('input', () => {
      if (rows.at(-1) === row && name.value.trim()) addRow();
    });
    for (const input of [qty, gst, hsn, unit]) input.addEventListener('input', recompute);
    rows.push(row);
    tbody.append(tr);
    numberRows();
    return row;
  }

  function numberRows() {
    rows.forEach((r, i) => { r.tr.firstChild.textContent = i + 1; });
  }

  const items = () => rows.filter((r) => r.name.value.trim() || r.rate.value || r.qty.value).map((r) => ({
    name: r.name.value, hsn: r.hsn.value, qty: Number(r.qty.value) || 0, unit: r.unit.value,
    rate: r.rate.value, gstRate: Number(r.gst.value),
  }));

  const totals = h('table', { class: 'totals' });
  const words = h('div', { class: 'muted small words' });
  function recompute() {
    const computed = computeInvoice(company, { placeOfSupply: placeOfSupply.value, roundOff: roundOff.checked, items: items() });
    let i = 0;
    for (const row of rows) {
      const filled = row.name.value.trim() || row.rate.value || row.qty.value;
      row.amount.textContent = filled ? formatAmount(computed.lines[i++]?.amount || 0) : '';
    }
    const line = (label, value, cls) => h('tr', { class: cls }, h('td', {}, label), h('td', { class: 'num' }, formatAmount(value)));
    totals.replaceChildren(...[
      line('Taxable value', computed.taxable),
      ...(computed.interstate ? [line('IGST', computed.igst)] : [line('CGST', computed.cgst), line('SGST', computed.sgst)]),
      computed.roundOff ? line('Round off', computed.roundOff) : null,
      line('Total', computed.total, 'grand'),
    ].filter(Boolean));
    words.textContent = computed.total ? amountInWords(computed.total) : '';
  }
  placeOfSupply.addEventListener('change', recompute);
  roundOff.addEventListener('change', recompute);

  (inv?.items?.length ? inv.items : [{}]).forEach((item) => addRow(item));
  if (inv?.items?.length) addRow();
  showPartyInfo(party.ledger);
  recompute();

  const el = h('div', {},
    h('div', { class: 'form grid-2' },
      field(outward ? "Party A/c name" : 'Party A/c name (supplier)', h('div', {}, party.el, partyInfo)),
      field(outward ? 'Sales ledger' : 'Purchase ledger', account.el),
      field('Place of supply', placeOfSupply, 'Same state as the company: CGST + SGST. Other state: IGST.'),
      field(outward ? 'Reference no.' : 'Supplier invoice no.', partyRef)),
    itemList,
    h('table', { class: 'items' },
      h('thead', {}, h('tr', {}, ['#', 'Item', 'HSN/SAC', 'Qty', 'Unit', 'Rate', 'GST', 'Amount', ''].map((t) =>
        h('th', { class: ['Rate', 'Amount'].includes(t) ? 'num' : '' }, t)))),
      tbody),
    h('div', { class: 'invoice-foot' },
      h('label', { class: 'inline' }, roundOff, ' Round off total to the rupee'),
      h('div', {}, totals, words)));

  return {
    el,
    data: () => ({
      invoice: {
        partyId: party.ledger?.id,
        ledgerId: account.ledger?.id,
        placeOfSupply: placeOfSupply.value,
        partyRef: partyRef.value,
        roundOff: roundOff.checked,
        items: items(),
      },
    }),
  };
}

// ---- Payment, Receipt, Contra ----------------------------------------------

function cashBody(type, existing, track) {
  const company = app.company;
  const layout = CASH_LAYOUT[type];
  const cashBank = (l) => isCashOrBank(company, l);

  // On an existing voucher the account is the cash/bank line on the account side.
  const accountEntry = existing?.entries.find((e) =>
    Math.sign(e.amount) === layout.accountSign && cashBank(ledgerById(company, e.ledgerId)));
  const others = existing ? existing.entries.filter((e) => e !== accountEntry) : [];

  const account = track(ledgerPicker({ filter: cashBank, value: accountEntry?.ledgerId || 'cash', placeholder: 'Cash or bank' }), 'bank');
  account.filter = cashBank;
  const rowFilter = type === 'contra' ? cashBank : (l) => l.id !== account.ledger?.id;
  const defaultGroup = type === 'contra' ? 'bank' : type === 'payment' ? 'indirect-expenses' : 'debtors';

  const tbody = h('tbody');
  const rows = [];
  const total = h('td', { class: 'num total' });

  function addRow(entry) {
    const row = {};
    row.picker = track(ledgerPicker({ filter: rowFilter, value: entry?.ledgerId }), defaultGroup);
    row.picker.filter = rowFilter;
    row.amount = amountInput({ value: Math.abs(entry?.amount || 0), onChange: update });
    row.picker.input.addEventListener('input', () => {
      if (rows.at(-1) === row && row.picker.input.value.trim()) addRow();
    });
    row.tr = h('tr', {}, h('td', {}, row.picker.el), h('td', {}, row.amount.el));
    rows.push(row);
    tbody.append(row.tr);
  }

  function update() {
    total.textContent = formatAmount(rows.reduce((sum, r) => sum + r.amount.value, 0));
  }

  others.forEach(addRow);
  addRow();
  update();

  return {
    el: h('div', {},
      h('div', { class: 'form grid-2' }, field(layout.account, account.el)),
      h('table', { class: 'entries' },
        h('thead', {}, h('tr', {}, h('th', {}, layout.rows), h('th', { class: 'num' }, 'Amount'))),
        tbody,
        h('tfoot', {}, h('tr', {}, h('td', { class: 'num' }, 'Total'), total)))),
    data() {
      const lines = rows.filter((r) => r.picker.ledger || r.amount.value)
        .map((r) => ({ ledgerId: r.picker.ledger?.id, amount: -layout.accountSign * r.amount.value }));
      const sum = lines.reduce((s, l) => s + l.amount, 0);
      return { entries: [{ ledgerId: account.ledger?.id, amount: -sum }, ...lines] };
    },
  };
}

// ---- Journal ---------------------------------------------------------------

function journalBody(existing, track) {
  const tbody = h('tbody');
  const rows = [];
  const totalDr = h('td', { class: 'num total' });
  const totalCr = h('td', { class: 'num total' });
  const difference = h('div', { class: 'difference' });

  const balance = () => rows.reduce((sum, r) => sum + (r.side.value === 'Dr' ? 1 : -1) * r.amount.value, 0);

  function addRow(entry) {
    const row = {};
    // A new line starts on the side that would balance the voucher.
    const gap = entry ? 0 : balance();
    const side = entry ? (entry.amount > 0 ? 'Dr' : 'Cr') : gap > 0 ? 'Cr' : 'Dr';
    row.side = h('select', { class: 'side' }, ['Dr', 'Cr'].map((s) => h('option', { value: s, selected: s === side }, s)));
    row.picker = track(ledgerPicker({ value: entry?.ledgerId }), 'indirect-expenses');
    row.amount = amountInput({ value: entry ? Math.abs(entry.amount) : 0, onChange: update });
    // Reaching an empty amount fills in whatever still balances the voucher.
    row.amount.el.addEventListener('focus', () => {
      if (row.amount.value || !row.picker.ledger) return;
      const open = balance();
      if (!open) return;
      row.side.value = open > 0 ? 'Cr' : 'Dr';
      row.amount.set(Math.abs(open));
      row.amount.el.select();
      update();
    });
    row.side.addEventListener('change', update);
    row.picker.input.addEventListener('input', () => {
      if (rows.at(-1) === row && row.picker.input.value.trim()) addRow();
    });
    row.tr = h('tr', {}, h('td', {}, row.side), h('td', {}, row.picker.el), h('td', {}, row.amount.el));
    rows.push(row);
    tbody.append(row.tr);
    update();
  }

  function update() {
    let dr = 0;
    let cr = 0;
    for (const r of rows) {
      if (!r.picker.ledger && !r.amount.value) continue;
      if (r.side.value === 'Dr') dr += r.amount.value; else cr += r.amount.value;
    }
    totalDr.textContent = formatAmount(dr);
    totalCr.textContent = formatAmount(cr);
    difference.textContent = dr === cr ? '' : `Difference: ${formatAmount(Math.abs(dr - cr))} ${dr > cr ? 'Dr' : 'Cr'}`;
  }

  (existing?.entries || []).forEach(addRow);
  if (!existing) addRow();
  addRow();

  return {
    el: h('div', {},
      h('table', { class: 'entries' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Dr/Cr'), h('th', {}, 'Particulars'), h('th', { class: 'num' }, 'Amount'))),
        tbody,
        h('tfoot', {},
          h('tr', {}, h('td', {}), h('td', { class: 'num' }, 'Total Dr'), totalDr),
          h('tr', {}, h('td', {}), h('td', { class: 'num' }, 'Total Cr'), totalCr))),
      difference),
    data: () => ({
      entries: rows.filter((r) => r.picker.ledger || r.amount.value).map((r) => ({
        ledgerId: r.picker.ledger?.id,
        amount: (r.side.value === 'Dr' ? 1 : -1) * r.amount.value,
      })),
    }),
  };
}

