// A printable A4 invoice for Sales, Purchase, Credit Note and Debit Note vouchers.

import { computeInvoice, ledgerById, VOUCHER_TYPES, voucherById } from '../core/books.js';
import { amountInWords, formatAmount } from '../core/money.js';
import { STATES } from '../core/states.js';
import { isDesktop } from '../core/storage.js';
import { app, formatDate } from './app.js';
import { h } from './dom.js';

const stateCode = (name) => STATES.find((s) => s.name === name)?.code || '';

function documentTitle(company, type) {
  if (type === 'sales') return company.gstin ? 'Tax Invoice' : 'Invoice';
  if (type === 'creditNote') return 'Credit Note';
  if (type === 'debitNote') return 'Debit Note';
  return 'Purchase Voucher';
}

export function invoiceScreen(voucherId) {
  const c = app.company;
  const v = voucherById(c, voucherId);
  if (!v) return { title: 'Invoice', el: h('div', { class: 'page' }, h('p', {}, 'This voucher no longer exists.')) };
  const party = ledgerById(c, v.invoice.partyId) || {};
  const computed = computeInvoice(c, v.invoice);
  const title = documentTitle(c, v.type);
  const outward = v.type === 'sales' || v.type === 'creditNote';

  // Tax summary by GST rate.
  const byRate = new Map();
  for (const line of computed.lines) {
    const row = byRate.get(line.gstRate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += line.amount;
    row.cgst += line.cgst;
    row.sgst += line.sgst;
    row.igst += line.igst;
    byRate.set(line.gstRate, row);
  }

  const seller = outward ? c : party;
  const buyer = outward ? party : c;
  const block = (label, who) => h('div', { class: 'inv-party' },
    h('div', { class: 'muted small' }, label),
    h('strong', {}, who.mailingName || who.name || ''),
    who.address ? h('div', { class: 'pre' }, who.address) : null,
    who.state ? h('div', {}, `State: ${who.state} (${stateCode(who.state)})`) : null,
    h('div', {}, who.gstin ? `GSTIN: ${who.gstin}` : 'GSTIN: Unregistered'),
    who.phone ? h('div', {}, `Phone: ${who.phone}`) : null);

  const taxColumns = computed.interstate ? ['IGST'] : ['CGST', 'SGST'];
  const doc = h('div', { class: 'invoice-doc' },
    h('div', { class: 'inv-title' }, title),
    h('div', { class: 'inv-top' },
      block(outward ? 'From' : 'Supplier', seller),
      h('div', { class: 'inv-meta' },
        h('div', {}, h('span', {}, 'No.'), h('strong', {}, String(v.number))),
        h('div', {}, h('span', {}, 'Date'), h('strong', {}, formatDate(v.date))),
        v.invoice.partyRef ? h('div', {}, h('span', {}, outward ? 'Reference' : 'Supplier invoice'), h('strong', {}, v.invoice.partyRef)) : null,
        h('div', {}, h('span', {}, 'Place of supply'), h('strong', {}, `${v.invoice.placeOfSupply} (${stateCode(v.invoice.placeOfSupply)})`))),
    ),
    block(outward ? 'Bill to' : 'Buyer', buyer),
    h('table', { class: 'inv-items' },
      h('thead', {}, h('tr', {}, ['#', 'Description', 'HSN/SAC', 'Qty', 'Rate', 'Taxable value', 'GST %', ...taxColumns].map((t, i) =>
        h('th', { class: i >= 3 && t !== 'GST %' ? 'num' : '' }, t)))),
      h('tbody', {}, computed.lines.map((l, i) => h('tr', {},
        h('td', {}, i + 1), h('td', {}, l.name), h('td', {}, l.hsn),
        h('td', { class: 'num' }, `${l.qty} ${l.unit || ''}`.trim()), h('td', { class: 'num' }, formatAmount(l.rate)),
        h('td', { class: 'num' }, formatAmount(l.amount)), h('td', {}, `${l.gstRate}%`),
        ...(computed.interstate ? [l.igst] : [l.cgst, l.sgst]).map((x) => h('td', { class: 'num' }, formatAmount(x)))))),
    ),
    h('div', { class: 'inv-bottom' },
      h('div', {},
        h('table', { class: 'inv-taxes' },
          h('thead', {}, h('tr', {}, ['GST rate', 'Taxable', ...taxColumns].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
          h('tbody', {}, [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, r]) => h('tr', {},
            h('td', {}, `${rate}%`), h('td', { class: 'num' }, formatAmount(r.taxable)),
            ...(computed.interstate ? [r.igst] : [r.cgst, r.sgst]).map((x) => h('td', { class: 'num' }, formatAmount(x))))))),
        h('p', { class: 'words' }, h('span', { class: 'muted small' }, 'Amount in words'), h('br'), amountInWords(computed.total)),
        v.narration ? h('p', { class: 'small' }, v.narration) : null),
      h('table', { class: 'inv-totals' },
        h('tr', {}, h('td', {}, 'Taxable value'), h('td', { class: 'num' }, formatAmount(computed.taxable))),
        ...(computed.interstate
          ? [h('tr', {}, h('td', {}, 'IGST'), h('td', { class: 'num' }, formatAmount(computed.igst)))]
          : [h('tr', {}, h('td', {}, 'CGST'), h('td', { class: 'num' }, formatAmount(computed.cgst))),
            h('tr', {}, h('td', {}, 'SGST'), h('td', { class: 'num' }, formatAmount(computed.sgst)))]),
        computed.roundOff ? h('tr', {}, h('td', {}, 'Round off'), h('td', { class: 'num' }, formatAmount(computed.roundOff))) : null,
        h('tr', { class: 'grand' }, h('td', {}, 'Total'), h('td', { class: 'num' }, `₹ ${formatAmount(computed.total)}`)))),
    h('div', { class: 'inv-sign' },
      h('div', { class: 'muted small' }, 'This is a computer-generated document.'),
      h('div', {}, h('div', {}, `For ${c.mailingName || c.name}`), h('div', { class: 'sign-space' }), h('div', {}, 'Authorised Signatory'))));

  const name = `${VOUCHER_TYPES[v.type].name} ${v.number} ${party.name || ''}`.trim();
  const savePdf = () => window.desktop.savePdf(name);
  return {
    title,
    el: h('div', { class: 'page invoice-page' },
      h('div', { class: 'toolbar no-print' },
        h('button', { onclick: () => app.back() }, 'Back'),
        h('span', { class: 'spacer' }),
        h('button', { onclick: () => app.openVoucher(v.type, v) }, 'Edit'),
        isDesktop() ? h('button', { onclick: savePdf }, 'Save PDF (Alt+S)') : null,
        h('button', { class: 'primary', onclick: () => window.print() }, 'Print (Alt+P)')),
      doc),
    onPrint: () => window.print(),
    keys: isDesktop() ? [{ key: 'Alt+S', label: 'Save PDF', run: savePdf }] : [],
  };
}
