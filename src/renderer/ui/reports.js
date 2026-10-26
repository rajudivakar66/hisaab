// Reports: Day Book, Ledger, Trial Balance, Profit & Loss, Balance Sheet,
// Group Summary and GST. Each screen keeps its period in a `state` object that
// survives drilling down and coming back.

import {
  balanceSheet, dayBook, fyEndOf, fyStartOf, groupSummary, gstSummary, ledgerById, ledgerStatement,
  primaryOf, profitAndLoss, trialBalance, VOUCHER_TYPES,
} from '../core/books.js';
import { formatAmount, formatBalance, formatOrBlank } from '../core/money.js';
import { isDesktop } from '../core/storage.js';
import { app, formatDate } from './app.js';
import { downloadCsv, h, tableRows } from './dom.js';
import { ledgerPicker } from './widgets.js';

const dr = (balance) => (balance > 0 ? formatAmount(balance) : '');
const cr = (balance) => (balance < 0 ? formatAmount(-balance) : '');

function dateInput(value, onChange) {
  const input = h('input', { type: 'date', value, min: app.company.booksFrom });
  input.addEventListener('change', () => input.value && onChange(input.value));
  return input;
}

function periodBar(state) {
  return h('div', { class: 'toolbar period' },
    h('label', { class: 'inline' }, 'From ', dateInput(state.from, (v) => { state.from = v; app.refresh(); })),
    h('label', { class: 'inline' }, 'To ', dateInput(state.to, (v) => { state.to = v; app.refresh(); })),
    h('button', { class: 'link', onclick: () => {
      state.from = fyStartOf(app.company, app.workingDate);
      state.to = fyEndOf(app.company, app.workingDate);
      app.refresh();
    } }, 'This financial year'));
}

function asAtBar(state) {
  return h('div', { class: 'toolbar period' },
    h('label', { class: 'inline' }, 'As at ', dateInput(state.to, (v) => { state.to = v; app.refresh(); })));
}

function reportHeader(title, subtitle) {
  const c = app.company;
  return h('div', { class: 'report-header' },
    h('div', { class: 'report-company' }, c.name),
    c.address ? h('div', { class: 'muted small' }, c.address.replace(/\n/g, ', ')) : null,
    h('h1', {}, title),
    h('div', { class: 'muted' }, subtitle));
}

const range = (from, to) => `${formatDate(from)} to ${formatDate(to)}`;

/** Common screen shape for reports: print, CSV export and a row-click helper. */
function report(title, name, el, table) {
  return {
    title,
    el,
    onPrint: () => window.print(),
    onExport: table ? () => downloadCsv(`${app.company.name} - ${name}`, tableRows(table)) : null,
    keys: [
      { key: 'Alt+P', label: 'Print', run: () => window.print() },
      ...(table ? [{ key: 'Alt+E', label: 'Export CSV', run: () => downloadCsv(`${app.company.name} - ${name}`, tableRows(table)) }] : []),
      ...(isDesktop() ? [{ key: 'Alt+S', label: 'Save PDF', run: () => window.desktop.savePdf(`${app.company.name} - ${name}`) }] : []),
    ],
  };
}

function clickableRow(cells, open) {
  return h('tr', { class: 'clickable', tabindex: 0, onclick: open,
    onkeydown: (e) => { if (e.key === 'Enter') open(); } }, cells);
}

export const openLedger = (ledgerId, from, to) =>
  push(ledgerStatementScreen, { ledgerId, from, to });

const openGroup = (groupId, to) => push(groupSummaryScreen, { groupId, to });

/** Opens a report with its own state object, so the period survives going back. */
export function push(screen, state = {}) {
  app.push(() => screen(state));
}

// ---- Day Book --------------------------------------------------------------

export function dayBookScreen(state) {
  const c = app.company;
  state.from ??= app.workingDate.slice(0, 8) + '01';
  state.to ??= app.workingDate;
  const rows = dayBook(c, state.from, state.to);
  const table = h('table', { class: 'report' },
    h('thead', {}, h('tr', {}, ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Amount'].map((t, i) =>
      h('th', { class: i === 4 ? 'num' : '' }, t)))),
    h('tbody', {}, rows.length ? rows.map((r) => clickableRow([
      h('td', {}, formatDate(r.voucher.date)),
      h('td', {}, r.particulars, r.voucher.narration ? h('div', { class: 'muted small' }, r.voucher.narration) : null),
      h('td', {}, VOUCHER_TYPES[r.voucher.type].name),
      h('td', {}, r.voucher.number),
      h('td', { class: 'num' }, formatAmount(r.amount)),
    ], () => app.openVoucher(r.voucher.type, r.voucher))) : h('tr', {}, h('td', { colspan: 5, class: 'empty' }, 'No vouchers in this period'))));
  return report('Day Book', 'Day Book', h('div', { class: 'page' },
    reportHeader('Day Book', range(state.from, state.to)), periodBar(state), table,
    h('p', { class: 'muted small no-print' }, 'Click a voucher (or press Enter on it) to alter or delete it.')), table);
}

// ---- Ledger ----------------------------------------------------------------

export function ledgerStatementScreen(state) {
  const c = app.company;
  state.from ??= fyStartOf(c, app.workingDate);
  state.to ??= fyEndOf(c, app.workingDate);
  const picker = ledgerPicker({ value: state.ledgerId, onChange: (l) => {
    if (l) {
      state.ledgerId = l.id;
      app.refresh();
    }
  } });
  picker.input.autofocus = !state.ledgerId;
  const top = h('div', { class: 'toolbar' }, h('label', { class: 'inline' }, 'Ledger ', picker.el));
  const ledger = state.ledgerId && ledgerById(c, state.ledgerId);
  if (!ledger) {
    return { title: 'Ledger', el: h('div', { class: 'page' }, h('h1', {}, 'Ledger statement'), top,
      h('p', { class: 'muted' }, 'Type a ledger name to see its account.')) };
  }

  const s = ledgerStatement(c, ledger.id, state.from, state.to);
  const table = h('table', { class: 'report' },
    h('thead', {}, h('tr', {}, ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit', 'Balance'].map((t, i) =>
      h('th', { class: i >= 4 ? 'num' : '' }, t)))),
    h('tbody', {},
      h('tr', { class: 'subtotal' }, h('td', {}, formatDate(state.from)), h('td', {}, 'Opening balance'), h('td'), h('td'),
        h('td', { class: 'num' }, dr(s.opening)), h('td', { class: 'num' }, cr(s.opening)), h('td', { class: 'num' }, formatBalance(s.opening))),
      s.rows.map((r) => clickableRow([
        h('td', {}, formatDate(r.voucher.date)),
        h('td', {}, r.particulars, r.voucher.narration ? h('div', { class: 'muted small' }, r.voucher.narration) : null),
        h('td', {}, VOUCHER_TYPES[r.voucher.type].name),
        h('td', {}, r.voucher.number),
        h('td', { class: 'num' }, formatOrBlank(r.debit)),
        h('td', { class: 'num' }, formatOrBlank(r.credit)),
        h('td', { class: 'num' }, formatBalance(r.balance)),
      ], () => app.openVoucher(r.voucher.type, r.voucher)))),
    h('tfoot', {},
      h('tr', {}, h('td', { colspan: 4, class: 'num' }, 'Current total'), h('td', { class: 'num' }, formatAmount(s.debit)),
        h('td', { class: 'num' }, formatAmount(s.credit)), h('td')),
      h('tr', { class: 'grand' }, h('td', { colspan: 4, class: 'num' }, 'Closing balance'),
        h('td', { class: 'num' }, dr(s.closing)), h('td', { class: 'num' }, cr(s.closing)), h('td', { class: 'num' }, formatBalance(s.closing)))));

  const details = [ledger.address, ledger.gstin && `GSTIN ${ledger.gstin}`, ledger.phone].filter(Boolean).join(' · ');
  return report('Ledger', `Ledger ${ledger.name}`, h('div', { class: 'page' },
    h('div', { class: 'no-print' }, top),
    reportHeader(`Ledger: ${ledger.name}`, range(state.from, state.to)),
    details ? h('p', { class: 'muted small' }, details) : null,
    periodBar(state), table), table);
}

// ---- Trial Balance ---------------------------------------------------------

export function trialBalanceScreen(state) {
  const c = app.company;
  state.to ??= fyEndOf(c, app.workingDate);
  state.detailed ??= false;
  const tb = trialBalance(c, state.to);
  const detailed = h('input', { type: 'checkbox', checked: state.detailed, onchange: (e) => {
    state.detailed = e.target.checked;
    app.refresh();
  } });

  const body = [];
  for (const g of tb.groups) {
    body.push(clickableRow([h('td', { class: 'strong' }, g.group.name), h('td', { class: 'num' }, dr(g.balance)),
      h('td', { class: 'num' }, cr(g.balance))], () => openGroup(g.group.id, state.to)));
    if (state.detailed) {
      for (const l of g.ledgers) {
        body.push(clickableRow([h('td', { class: 'indent' }, l.ledger.name), h('td', { class: 'num' }, dr(l.balance)),
          h('td', { class: 'num' }, cr(l.balance))], () => openLedger(l.ledger.id, fyStartOf(c, state.to), state.to)));
      }
    }
  }
  if (tb.pl) {
    body.push(clickableRow([h('td', { class: 'strong' }, 'Profit & Loss A/c'), h('td', { class: 'num' }, dr(tb.pl)),
      h('td', { class: 'num' }, cr(tb.pl))], () => openLedger('pl', fyStartOf(c, state.to), state.to)));
  }
  if (tb.difference) {
    body.push(h('tr', { class: 'warning' }, h('td', {}, 'Difference in opening balances'),
      h('td', { class: 'num' }, dr(tb.difference)), h('td', { class: 'num' }, cr(tb.difference))));
  }
  const table = h('table', { class: 'report' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Particulars'), h('th', { class: 'num' }, 'Debit'), h('th', { class: 'num' }, 'Credit'))),
    h('tbody', {}, body.length ? body : h('tr', {}, h('td', { colspan: 3, class: 'empty' }, 'No balances yet'))),
    h('tfoot', {}, h('tr', { class: 'grand' }, h('td', {}, 'Grand Total'),
      h('td', { class: 'num' }, formatAmount(tb.debit)), h('td', { class: 'num' }, formatAmount(tb.credit)))));

  return report('Trial Balance', 'Trial Balance', h('div', { class: 'page' },
    reportHeader('Trial Balance', `As at ${formatDate(state.to)}`),
    h('div', { class: 'toolbar period' },
      h('label', { class: 'inline' }, 'As at ', dateInput(state.to, (v) => { state.to = v; app.refresh(); })),
      h('label', { class: 'inline' }, detailed, ' Show ledgers')),
    table), table);
}

// ---- Two-column (T) reports --------------------------------------------------

function tAccount(leftTitle, rightTitle, leftLines, rightLines, onRow) {
  // Totals sit on the same line on both sides, as in a printed T account.
  const isTotal = (line) => line?.className === 'total-line';
  const left = leftLines.filter((l) => !isTotal(l));
  const right = rightLines.filter((l) => !isTotal(l));
  const bodyRows = Math.max(left.length, right.length);
  left.length = bodyRows;
  right.length = bodyRows;
  left.push(leftLines.find(isTotal));
  right.push(rightLines.find(isTotal));
  const rows = left.length;
  const cell = (line) => line
    ? [h('td', { class: line.className || '' }, line.label, line.note ? h('div', { class: 'muted small' }, line.note) : null),
      h('td', { class: 'num' }, line.amount === undefined ? '' : formatAmount(line.amount))]
    : [h('td'), h('td')];
  const body = [];
  for (let i = 0; i < rows; i++) {
    const tr = h('tr', {}, cell(left[i]), cell(right[i]));
    [left[i], right[i]].forEach((line, side) => {
      if (line?.groupId || line?.ledgerId) {
        const cells = [...tr.children].slice(side * 2, side * 2 + 2);
        cells.forEach((td) => {
          td.classList.add('clickable');
          td.addEventListener('click', () => onRow(line));
        });
      }
    });
    body.push(tr);
  }
  return h('table', { class: 'report t-account' },
    h('thead', {}, h('tr', {}, h('th', {}, leftTitle), h('th', { class: 'num' }), h('th', {}, rightTitle), h('th', { class: 'num' }))),
    h('tbody', {}, body));
}

export function profitLossScreen(state) {
  const c = app.company;
  state.from ??= fyStartOf(c, app.workingDate);
  state.to ??= fyEndOf(c, app.workingDate);
  const pl = profitAndLoss(c, state.from, state.to);
  const sum = (lines) => lines.reduce((t, l) => t + l.amount, 0);
  const gp = pl.grossProfit;
  const np = pl.netProfit;

  const tradingLeft = [...pl.tradingDebit];
  const tradingRight = [...pl.tradingCredit];
  if (gp >= 0) tradingLeft.push({ label: 'Gross Profit c/o', amount: gp, className: 'strong' });
  else tradingRight.push({ label: 'Gross Loss c/o', amount: -gp, className: 'strong' });
  const tradingTotal = Math.max(sum(tradingLeft), sum(tradingRight));
  tradingLeft.push({ label: 'Total', amount: tradingTotal, className: 'total-line' });
  tradingRight.push({ label: 'Total', amount: tradingTotal, className: 'total-line' });

  const plLeft = [];
  const plRight = [];
  if (gp >= 0) plRight.push({ label: 'Gross Profit b/f', amount: gp });
  else plLeft.push({ label: 'Gross Loss b/f', amount: -gp });
  plLeft.push(...pl.indirectExpenses);
  plRight.push(...pl.indirectIncomes);
  if (np >= 0) plLeft.push({ label: 'Net Profit', amount: np, className: 'strong' });
  else plRight.push({ label: 'Net Loss', amount: -np, className: 'strong' });
  const plTotal = Math.max(sum(plLeft), sum(plRight));
  plLeft.push({ label: 'Total', amount: plTotal, className: 'total-line' });
  plRight.push({ label: 'Total', amount: plTotal, className: 'total-line' });

  const open = (line) => openGroup(line.groupId, state.to);
  const trading = tAccount('Particulars', 'Particulars', tradingLeft, tradingRight, open);
  const profit = tAccount('Particulars', 'Particulars', plLeft, plRight, open);
  const exportTable = h('table', {}, h('tbody', {}, [...trading.querySelectorAll('tr'), ...profit.querySelectorAll('tr')].map((tr) => tr.cloneNode(true))));

  return report('Profit & Loss A/c', 'Profit and Loss', h('div', { class: 'page' },
    reportHeader('Profit & Loss A/c', range(state.from, state.to)), periodBar(state),
    h('h2', {}, 'Trading account'), trading,
    h('h2', {}, 'Profit & loss account'), profit,
    h('div', { class: `result ${np >= 0 ? 'profit' : 'loss'}` }, np >= 0 ? `Net profit: ₹ ${formatAmount(np)}` : `Net loss: ₹ ${formatAmount(-np)}`)),
  exportTable);
}

export function balanceSheetScreen(state) {
  const c = app.company;
  state.to ??= fyEndOf(c, app.workingDate);
  const bs = balanceSheet(c, state.to);
  const liabilities = bs.liabilities.map((r) => ({
    ...r,
    note: r.current !== undefined ? `Opening ${formatAmount(r.opening)} · Current period ${formatAmount(r.current)}` : null,
    ledgerId: r.label === 'Profit & Loss A/c' ? 'pl' : undefined,
  }));
  liabilities.push({ label: 'Total', amount: bs.totalLiabilities, className: 'total-line' });
  const assets = [...bs.assets, { label: 'Total', amount: bs.totalAssets, className: 'total-line' }];
  const open = (line) => (line.ledgerId === 'pl'
    ? push(profitLossScreen, { from: fyStartOf(c, state.to), to: state.to })
    : openGroup(line.groupId, state.to));
  const table = tAccount('Liabilities', 'Assets', liabilities, assets, open);
  return report('Balance Sheet', 'Balance Sheet', h('div', { class: 'page' },
    reportHeader('Balance Sheet', `As at ${formatDate(state.to)}`), asAtBar(state), table,
    h('p', { class: 'muted small no-print' }, 'Click a group to see its ledgers. Click Profit & Loss A/c for the P&L.')), table);
}

// ---- Group Summary -----------------------------------------------------------

export function groupSummaryScreen(state) {
  const c = app.company;
  const summary = groupSummary(c, state.groupId, state.to);
  const nominal = ['income', 'expense'].includes(primaryOf(c, state.groupId)?.nature);
  const from = fyStartOf(c, state.to);
  const table = h('table', { class: 'report' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Particulars'), h('th', { class: 'num' }, 'Debit'), h('th', { class: 'num' }, 'Credit'))),
    h('tbody', {}, summary.rows.length ? summary.rows.map((r) => clickableRow([
      h('td', { class: r.kind === 'group' ? 'strong' : '' }, r.name),
      h('td', { class: 'num' }, dr(r.balance)), h('td', { class: 'num' }, cr(r.balance)),
    ], () => (r.kind === 'group' ? openGroup(r.id, state.to) : openLedger(r.id, from, state.to))))
      : h('tr', {}, h('td', { colspan: 3, class: 'empty' }, 'Nothing under this group yet'))),
    h('tfoot', {}, h('tr', { class: 'grand' }, h('td', {}, 'Total'),
      h('td', { class: 'num' }, dr(summary.total)), h('td', { class: 'num' }, cr(summary.total)))));
  const subtitle = nominal ? range(from, state.to) : `As at ${formatDate(state.to)}`;
  const extra = state.groupId === 'stock'
    ? h('p', { class: 'muted small' }, 'Book balances shown. Profit & Loss and the Balance Sheet use the closing stock value on each stock ledger.')
    : null;
  return report('Group Summary', `Group ${summary.group.name}`, h('div', { class: 'page' },
    reportHeader(`Group Summary: ${summary.group.name}`, subtitle), asAtBar(state), table, extra), table);
}

// ---- GST -------------------------------------------------------------------

export function gstScreen(state) {
  const c = app.company;
  state.from ??= app.workingDate.slice(0, 8) + '01';
  state.to ??= app.workingDate;
  const g = gstSummary(c, state.from, state.to);
  const types = ['cgst', 'sgst', 'igst'];
  const total = (o) => types.reduce((s, t) => s + o[t], 0);

  const taxTable = h('table', { class: 'report' },
    h('thead', {}, h('tr', {}, ['Tax', 'Output tax (sales)', 'Input tax credit (purchases)', 'Net payable'].map((t, i) =>
      h('th', { class: i ? 'num' : '' }, t)))),
    h('tbody', {}, types.map((t) => h('tr', {}, h('td', {}, t.toUpperCase()),
      h('td', { class: 'num' }, formatAmount(g.output[t])), h('td', { class: 'num' }, formatAmount(g.input[t])),
      h('td', { class: 'num' }, formatBalancePayable(g.payable[t]))))),
    h('tfoot', {}, h('tr', { class: 'grand' }, h('td', {}, 'Total'),
      h('td', { class: 'num' }, formatAmount(total(g.output))), h('td', { class: 'num' }, formatAmount(total(g.input))),
      h('td', { class: 'num' }, formatBalancePayable(total(g.payable))))));

  const register = (title, rows) => {
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    return [h('h2', {}, title), h('table', { class: 'report register' },
      h('thead', {}, h('tr', {}, ['Date', 'Vch', 'Party', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'].map((t, i) =>
        h('th', { class: i >= 4 ? 'num' : '' }, t)))),
      h('tbody', {}, rows.length ? rows.map((r) => clickableRow([
        h('td', {}, formatDate(r.voucher.date)),
        h('td', {}, `${VOUCHER_TYPES[r.voucher.type].name} ${r.voucher.number}`),
        h('td', {}, r.party), h('td', {}, r.gstin || 'Unregistered'),
        ...['taxable', 'cgst', 'sgst', 'igst', 'total'].map((k) => h('td', { class: 'num' }, formatAmount(r[k]))),
      ], () => app.openVoucher(r.voucher.type, r.voucher))) : h('tr', {}, h('td', { colspan: 9, class: 'empty' }, 'None in this period'))),
      h('tfoot', {}, h('tr', { class: 'grand' }, h('td', { colspan: 4 }, 'Total'),
        ...['taxable', 'cgst', 'sgst', 'igst', 'total'].map((k) => h('td', { class: 'num' }, formatAmount(sum(k)))))))];
  };
  const outward = register('Outward supplies (sales and credit notes)', g.register.filter((r) => r.outward));
  const inward = register('Inward supplies (purchases and debit notes)', g.register.filter((r) => !r.outward));
  const exportTable = h('table', {}, h('tbody', {},
    [taxTable, outward[1], inward[1]].flatMap((t) => [...t.querySelectorAll('tr')].map((tr) => tr.cloneNode(true)))));

  return report('GST Summary', 'GST Summary', h('div', { class: 'page' },
    reportHeader('GST Summary', range(state.from, state.to)), periodBar(state),
    c.gstin ? null : h('p', { class: 'warning-box' }, 'The company has no GSTIN. Add it under Alter Company to print tax invoices.'),
    taxTable, outward, inward,
    h('p', { class: 'muted small' }, 'A summary to help prepare GST returns. Check the figures before filing.')), exportTable);
}

function formatBalancePayable(amount) {
  if (amount >= 0) return formatAmount(amount);
  return `${formatAmount(-amount)} (credit)`;
}
