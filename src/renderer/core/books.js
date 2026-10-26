// The accounting engine. Everything here works on a plain company object, so
// it can be saved as JSON and tested without a user interface.
//
// Sign convention: every amount is integer paise, and a positive amount is a
// debit, a negative amount a credit. That holds for ledger opening balances,
// voucher entries and balances alike, so a voucher balances when its entries
// sum to zero.

import { DEFAULT_GROUPS } from './groups.js';
import { isValidGstin, stateFromGstin } from './states.js';

export class BooksError extends Error {}

export const VOUCHER_TYPES = {
  contra: { name: 'Contra', key: 'F4' },
  payment: { name: 'Payment', key: 'F5' },
  receipt: { name: 'Receipt', key: 'F6' },
  journal: { name: 'Journal', key: 'F7' },
  sales: { name: 'Sales', key: 'F8', invoice: true },
  purchase: { name: 'Purchase', key: 'F9', invoice: true },
  creditNote: { name: 'Credit Note', key: 'Ctrl+F8', invoice: true },
  debitNote: { name: 'Debit Note', key: 'Ctrl+F9', invoice: true },
};

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function requireDate(value, label) {
  if (!DATE.test(value || '') || Number.isNaN(Date.parse(value))) {
    throw new BooksError(`${label} must be a valid date`);
  }
  return value;
}

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---- Company ---------------------------------------------------------------

export function createCompany(details) {
  const company = {
    id: newId(),
    groups: structuredClone(DEFAULT_GROUPS),
    ledgers: [],
    vouchers: [],
    createdAt: new Date().toISOString(),
  };
  updateCompany(company, details);

  const ledger = (id, name, groupId, extra = {}) =>
    company.ledgers.push({ id, name, groupId, opening: 0, system: true, ...extra });
  ledger('cash', 'Cash', 'cash');
  ledger('pl', 'Profit & Loss A/c', null);
  ledger('sales', 'Sales', 'sales', { system: false });
  ledger('purchase', 'Purchase', 'purchase', { system: false });
  for (const direction of ['output', 'input']) {
    for (const type of ['cgst', 'sgst', 'igst']) {
      const label = `${direction[0].toUpperCase()}${direction.slice(1)} ${type.toUpperCase()}`;
      ledger(`${direction}-${type}`, label, 'duties', { tax: { type, direction } });
    }
  }
  ledger('round-off', 'Round Off', 'indirect-expenses');
  return company;
}

export function updateCompany(company, details) {
  const name = (details.name || '').trim();
  if (!name) throw new BooksError('Company name is required');
  const gstin = (details.gstin || '').trim().toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new BooksError('GSTIN is not valid (15 characters, e.g. 27ABCDE1234F1Z5)');
  const fyStart = requireDate(details.fyStart, 'Financial year start');
  const booksFrom = requireDate(details.booksFrom || fyStart, 'Books beginning date');
  if (booksFrom < fyStart) throw new BooksError('Books cannot begin before the financial year starts');
  Object.assign(company, {
    name,
    mailingName: (details.mailingName || '').trim() || name,
    address: (details.address || '').trim(),
    state: details.state || stateFromGstin(gstin),
    pincode: (details.pincode || '').trim(),
    phone: (details.phone || '').trim(),
    email: (details.email || '').trim(),
    gstin,
    fyStart,
    booksFrom,
  });
  return company;
}

/** The first day of the financial year that contains `date`. */
export function fyStartOf(company, date) {
  const monthDay = company.fyStart.slice(5);
  const year = Number(date.slice(0, 4));
  return date.slice(5) >= monthDay ? `${year}-${monthDay}` : `${year - 1}-${monthDay}`;
}

/** The last day of the financial year that contains `date`. */
export function fyEndOf(company, date) {
  const start = new Date(fyStartOf(company, date) + 'T00:00:00Z');
  start.setUTCFullYear(start.getUTCFullYear() + 1);
  start.setUTCDate(start.getUTCDate() - 1);
  return start.toISOString().slice(0, 10);
}

/** "2026-27" for the financial year that contains `date`. */
export function fyLabel(company, date) {
  const start = Number(fyStartOf(company, date).slice(0, 4));
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// ---- Groups ----------------------------------------------------------------

export const groupById = (company, id) => company.groups.find((g) => g.id === id);

/** The primary group at the top of `groupId`'s chain. */
export function primaryOf(company, groupId) {
  let group = groupById(company, groupId);
  while (group?.parent) group = groupById(company, group.parent);
  return group;
}

export const natureOf = (company, groupId) => primaryOf(company, groupId)?.nature;

export function isUnder(company, groupId, ancestorId) {
  for (let g = groupById(company, groupId); g; g = groupById(company, g.parent)) {
    if (g.id === ancestorId) return true;
  }
  return false;
}

export function saveGroup(company, data) {
  const name = (data.name || '').trim();
  if (!name) throw new BooksError('Group name is required');
  if (company.groups.some((g) => g.id !== data.id && sameName(g.name, name))) {
    throw new BooksError(`A group called "${name}" already exists`);
  }
  if (!groupById(company, data.parent)) throw new BooksError('Choose the group this one comes under');
  const existing = data.id && groupById(company, data.id);
  if (existing) {
    if (existing.system) throw new BooksError('Built-in groups cannot be changed');
    if (isUnder(company, data.parent, existing.id)) throw new BooksError('A group cannot sit under itself');
    Object.assign(existing, { name, parent: data.parent });
    return existing;
  }
  const group = { id: newId(), name, parent: data.parent };
  company.groups.push(group);
  return group;
}

export function deleteGroup(company, id) {
  const group = groupById(company, id);
  if (!group) return;
  if (group.system) throw new BooksError('Built-in groups cannot be deleted');
  if (company.groups.some((g) => g.parent === id) || company.ledgers.some((l) => l.groupId === id)) {
    throw new BooksError('Move or delete the groups and ledgers under this group first');
  }
  company.groups = company.groups.filter((g) => g.id !== id);
}

// ---- Ledgers ---------------------------------------------------------------

export const ledgerById = (company, id) => company.ledgers.find((l) => l.id === id);

export const findLedgerByName = (company, name) =>
  company.ledgers.find((l) => sameName(l.name, name || ''));

export const isCashOrBank = (company, ledger) =>
  !!ledger && (isUnder(company, ledger.groupId, 'cash') || isUnder(company, ledger.groupId, 'bank') ||
    isUnder(company, ledger.groupId, 'bank-od'));

export const isStockLedger = (company, ledger) => !!ledger && isUnder(company, ledger.groupId, 'stock');

const isNominal = (company, ledger) => ['income', 'expense'].includes(natureOf(company, ledger.groupId));

export const isPartyLedger = (company, ledger) =>
  !!ledger && (isUnder(company, ledger.groupId, 'debtors') || isUnder(company, ledger.groupId, 'creditors') ||
    isCashOrBank(company, ledger));

export function saveLedger(company, data) {
  const name = (data.name || '').trim();
  if (!name) throw new BooksError('Ledger name is required');
  if (company.ledgers.some((l) => l.id !== data.id && sameName(l.name, name))) {
    throw new BooksError(`A ledger called "${name}" already exists`);
  }
  const existing = data.id && ledgerById(company, data.id);
  const groupId = existing?.system ? existing.groupId : data.groupId;
  if (existing?.id !== 'pl' && !groupById(company, groupId)) throw new BooksError('Choose a group for the ledger');
  const opening = Math.round(Number(data.opening) || 0);
  const gstin = (data.gstin || '').trim().toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new BooksError('GSTIN is not valid (15 characters, e.g. 27ABCDE1234F1Z5)');

  const fields = {
    name,
    groupId,
    opening,
    address: (data.address || '').trim(),
    state: data.state || stateFromGstin(gstin),
    gstin,
    phone: (data.phone || '').trim(),
    email: (data.email || '').trim(),
    closingStock: isUnder(company, groupId, 'stock') ? Math.round(Number(data.closingStock) || 0) : 0,
  };
  if (existing) {
    Object.assign(existing, fields);
    return existing;
  }
  const ledger = { id: newId(), ...fields };
  company.ledgers.push(ledger);
  return ledger;
}

export function isLedgerUsed(company, id) {
  return company.vouchers.some((v) => v.entries.some((e) => e.ledgerId === id) ||
    v.invoice?.partyId === id || v.invoice?.ledgerId === id);
}

export function deleteLedger(company, id) {
  const ledger = ledgerById(company, id);
  if (!ledger) return;
  if (ledger.system) throw new BooksError('Built-in ledgers cannot be deleted');
  if (isLedgerUsed(company, id)) throw new BooksError('This ledger is used in vouchers and cannot be deleted');
  company.ledgers = company.ledgers.filter((l) => l.id !== id);
}

// ---- Invoices (Sales, Purchase, Credit Note, Debit Note) ----------------------

/**
 * Works out the lines, taxes and total of an invoice.
 * Supplies within the company's state carry CGST + SGST; others carry IGST.
 */
export function computeInvoice(company, invoice) {
  const interstate = !!invoice.placeOfSupply && !!company.state && invoice.placeOfSupply !== company.state;
  const lines = (invoice.items || []).map((item) => {
    const qty = Number(item.qty) || 0;
    const rate = Math.round(Number(item.rate) || 0);
    const gstRate = Number(item.gstRate) || 0;
    const amount = Math.round(qty * rate);
    const half = Math.round((amount * gstRate) / 200);
    return {
      ...item,
      qty,
      rate,
      gstRate,
      amount,
      cgst: interstate ? 0 : half,
      sgst: interstate ? 0 : half,
      igst: interstate ? Math.round((amount * gstRate) / 100) : 0,
    };
  });
  const sum = (key) => lines.reduce((total, line) => total + line[key], 0);
  const taxable = sum('amount');
  const cgst = sum('cgst');
  const sgst = sum('sgst');
  const igst = sum('igst');
  const exact = taxable + cgst + sgst + igst;
  const total = invoice.roundOff === false ? exact : Math.round(exact / 100) * 100;
  return { interstate, lines, taxable, cgst, sgst, igst, roundOff: total - exact, total };
}

/** Which way each part of an invoice posts. +1 debits the party, -1 credits it. */
const PARTY_SIDE = { sales: 1, purchase: -1, creditNote: -1, debitNote: 1 };
const TAX_DIRECTION = { sales: 'output', creditNote: 'output', purchase: 'input', debitNote: 'input' };

function invoiceEntries(company, type, invoice, computed) {
  const party = ledgerById(company, invoice.partyId);
  if (!isPartyLedger(company, party)) {
    throw new BooksError('Choose a party: a customer, a supplier, cash or a bank');
  }
  const account = ledgerById(company, invoice.ledgerId);
  const wanted = type === 'sales' || type === 'creditNote' ? 'income' : 'expense';
  if (!account || natureOf(company, account.groupId) !== wanted) {
    throw new BooksError(`Choose a ${wanted === 'income' ? 'sales' : 'purchase'} ledger`);
  }
  if (!computed.lines.length) throw new BooksError('Add at least one item');
  computed.lines.forEach((line, i) => {
    if (!String(line.name || '').trim()) throw new BooksError(`Item ${i + 1} needs a name`);
    if (!(line.qty > 0)) throw new BooksError(`Item ${i + 1} needs a quantity above zero`);
    if (line.rate < 0) throw new BooksError(`Item ${i + 1} has a negative rate`);
  });
  if (computed.total <= 0) throw new BooksError('The invoice total must be above zero');

  const side = PARTY_SIDE[type];
  const direction = TAX_DIRECTION[type];
  const entries = [
    { ledgerId: party.id, amount: side * computed.total },
    { ledgerId: account.id, amount: -side * computed.taxable },
  ];
  for (const tax of ['cgst', 'sgst', 'igst']) {
    if (computed[tax]) entries.push({ ledgerId: `${direction}-${tax}`, amount: -side * computed[tax] });
  }
  if (computed.roundOff) entries.push({ ledgerId: 'round-off', amount: -side * computed.roundOff });
  return entries.filter((e) => e.amount !== 0);
}

// ---- Vouchers --------------------------------------------------------------

export const voucherById = (company, id) => company.vouchers.find((v) => v.id === id);

function checkEntries(company, type, entries) {
  if (entries.length < 2) throw new BooksError('A voucher needs at least one debit and one credit');
  for (const entry of entries) {
    if (!ledgerById(company, entry.ledgerId)) throw new BooksError('Every line needs a ledger');
    if (!Number.isInteger(entry.amount) || entry.amount === 0) throw new BooksError('Every line needs an amount');
  }
  const difference = entries.reduce((total, e) => total + e.amount, 0);
  if (difference !== 0) throw new BooksError('Debit and credit totals do not match');

  const cashBank = (e) => isCashOrBank(company, ledgerById(company, e.ledgerId));
  if (type === 'contra' && !entries.every(cashBank)) {
    throw new BooksError('Contra vouchers move money between cash and bank ledgers only');
  }
  if (type === 'payment' && !entries.some((e) => e.amount < 0 && cashBank(e))) {
    throw new BooksError('A payment must be paid from a cash or bank ledger');
  }
  if (type === 'receipt' && !entries.some((e) => e.amount > 0 && cashBank(e))) {
    throw new BooksError('A receipt must be received into a cash or bank ledger');
  }
}

/** Next voucher number for this type within the financial year of `date`. */
export function nextVoucherNumber(company, type, date) {
  const fy = fyStartOf(company, date);
  const numbers = company.vouchers
    .filter((v) => v.type === type && fyStartOf(company, v.date) === fy)
    .map((v) => v.number);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

/** Creates or updates a voucher. Throws BooksError when it would not balance. */
export function saveVoucher(company, data) {
  const type = data.type;
  if (!VOUCHER_TYPES[type]) throw new BooksError('Unknown voucher type');
  const date = requireDate(data.date, 'Voucher date');
  if (date < company.booksFrom) throw new BooksError(`Books begin on ${company.booksFrom}; choose a later date`);

  let entries;
  let invoice;
  if (VOUCHER_TYPES[type].invoice) {
    const party = ledgerById(company, data.invoice?.partyId);
    invoice = {
      partyId: data.invoice?.partyId,
      ledgerId: data.invoice?.ledgerId,
      placeOfSupply: data.invoice?.placeOfSupply || party?.state || company.state,
      partyRef: (data.invoice?.partyRef || '').trim(),
      roundOff: data.invoice?.roundOff !== false,
      items: (data.invoice?.items || []).map((item) => ({
        name: String(item.name || '').trim(),
        hsn: String(item.hsn || '').trim(),
        qty: Number(item.qty) || 0,
        unit: String(item.unit || '').trim(),
        rate: Math.round(Number(item.rate) || 0),
        gstRate: Number(item.gstRate) || 0,
      })),
    };
    const computed = computeInvoice(company, invoice);
    entries = invoiceEntries(company, type, invoice, computed);
    invoice.totals = {
      taxable: computed.taxable, cgst: computed.cgst, sgst: computed.sgst, igst: computed.igst,
      roundOff: computed.roundOff, total: computed.total,
    };
  } else {
    entries = (data.entries || [])
      .filter((e) => e.ledgerId || e.amount)
      .map((e) => ({ ledgerId: e.ledgerId, amount: Math.round(Number(e.amount) || 0) }));
  }
  checkEntries(company, type, entries);

  const existing = data.id && voucherById(company, data.id);
  const keepNumber = existing && existing.type === type &&
    fyStartOf(company, existing.date) === fyStartOf(company, date);
  const voucher = {
    id: existing?.id || newId(),
    type,
    number: keepNumber ? existing.number : nextVoucherNumber(company, type, date),
    date,
    narration: (data.narration || '').trim(),
    entries,
    ...(invoice ? { invoice } : {}),
  };
  if (existing) {
    company.vouchers[company.vouchers.indexOf(existing)] = voucher;
  } else {
    company.vouchers.push(voucher);
  }
  return voucher;
}

export function deleteVoucher(company, id) {
  company.vouchers = company.vouchers.filter((v) => v.id !== id);
}

const byDate = (a, b) => a.date.localeCompare(b.date) ||
  a.type.localeCompare(b.type) || a.number - b.number;

/** Debit total of a voucher, which is the amount it is known by. */
export const voucherAmount = (voucher) =>
  voucher.entries.reduce((total, e) => total + Math.max(e.amount, 0), 0);

/** The ledger a voucher is "about": the party of an invoice, else its first non-cash line. */
export function voucherParticulars(company, voucher) {
  if (voucher.invoice) return ledgerById(company, voucher.invoice.partyId)?.name || '';
  const main = voucher.entries.find((e) => !isCashOrBank(company, ledgerById(company, e.ledgerId))) ||
    voucher.entries[0];
  return ledgerById(company, main?.ledgerId)?.name || '';
}

// ---- Balances --------------------------------------------------------------

/** Net movement per ledger for vouchers dated within [from, to]. Either bound may be omitted. */
function movements(company, from, to) {
  const totals = new Map();
  for (const voucher of company.vouchers) {
    if ((from && voucher.date < from) || (to && voucher.date > to)) continue;
    for (const entry of voucher.entries) {
      totals.set(entry.ledgerId, (totals.get(entry.ledgerId) || 0) + entry.amount);
    }
  }
  return totals;
}

/** Balance of a ledger at the end of `to`, including its opening balance. */
export function ledgerBalance(company, ledgerId, to) {
  return (ledgerById(company, ledgerId)?.opening || 0) + (movements(company, null, to).get(ledgerId) || 0);
}

/** Sum of all opening balances. Non-zero means the opening balances do not agree. */
export function openingDifference(company) {
  return company.ledgers.reduce((total, l) => total + l.opening, 0);
}

function dayBefore(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Profit carried in from before `fyStart`: everything the income and expense
 * ledgers did in earlier years, plus their opening balances.
 */
function profitBefore(company, fyStart) {
  const earlier = movements(company, null, dayBefore(fyStart));
  let nominal = 0;
  for (const ledger of company.ledgers) {
    if (isNominal(company, ledger)) nominal += ledger.opening + (earlier.get(ledger.id) || 0);
  }
  return -nominal;
}

// ---- Reports ---------------------------------------------------------------

export function dayBook(company, from, to) {
  return company.vouchers
    .filter((v) => v.date >= from && v.date <= to)
    .sort(byDate)
    .map((voucher) => ({
      voucher,
      particulars: voucherParticulars(company, voucher),
      amount: voucherAmount(voucher),
    }));
}

/** Every voucher touching a ledger in [from, to], with a running balance. */
export function ledgerStatement(company, ledgerId, from, to) {
  const ledger = ledgerById(company, ledgerId);
  const opening = ledger.opening + (movements(company, null, dayBefore(from)).get(ledgerId) || 0);
  let balance = opening;
  let debit = 0;
  let credit = 0;
  const rows = [];
  for (const voucher of company.vouchers.filter((v) => v.date >= from && v.date <= to).sort(byDate)) {
    const own = voucher.entries.filter((e) => e.ledgerId === ledgerId);
    if (!own.length) continue;
    const amount = own.reduce((total, e) => total + e.amount, 0);
    // The other side: ledgers posted the opposite way, largest first.
    const others = voucher.entries
      .filter((e) => e.ledgerId !== ledgerId && Math.sign(e.amount) !== Math.sign(amount || own[0].amount))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const names = others.map((e) => ledgerById(company, e.ledgerId)?.name).filter(Boolean);
    balance += amount;
    if (amount > 0) debit += amount; else credit -= amount;
    rows.push({
      voucher,
      particulars: names.length > 1 ? `${names[0]} + ${names.length - 1} more` : names[0] || '',
      debit: Math.max(amount, 0),
      credit: Math.max(-amount, 0),
      balance,
    });
  }
  return { ledger, opening, rows, debit, credit, closing: balance };
}

/**
 * The closing figure for each ledger in a report as at `to`:
 * balance-sheet ledgers carry everything since the books began, income and
 * expense ledgers only the current financial year (earlier years are in the
 * Profit & Loss A/c line).
 */
function closingFigures(company, to) {
  const fyStart = fyStartOf(company, to);
  const all = movements(company, null, to);
  const thisYear = movements(company, fyStart, to);
  const figures = new Map();
  for (const ledger of company.ledgers) {
    if (ledger.id === 'pl') {
      figures.set(ledger.id, ledger.opening + (all.get(ledger.id) || 0) - profitBefore(company, fyStart));
    } else if (isNominal(company, ledger)) {
      figures.set(ledger.id, thisYear.get(ledger.id) || 0);
    } else {
      figures.set(ledger.id, ledger.opening + (all.get(ledger.id) || 0));
    }
  }
  return figures;
}

/** Ledgers and sub-groups directly under a group, with their closing figures as at `to`. */
export function groupSummary(company, groupId, to) {
  const figures = closingFigures(company, to);
  const total = (gid) =>
    company.ledgers.filter((l) => l.groupId && isUnder(company, l.groupId, gid))
      .reduce((sum, l) => sum + figures.get(l.id), 0);
  const rows = [
    ...company.groups.filter((g) => g.parent === groupId)
      .map((g) => ({ kind: 'group', id: g.id, name: g.name, balance: total(g.id) })),
    ...company.ledgers.filter((l) => l.groupId === groupId)
      .map((l) => ({ kind: 'ledger', id: l.id, name: l.name, balance: figures.get(l.id) })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return { group: groupById(company, groupId), rows, total: total(groupId) };
}

export function trialBalance(company, to) {
  const figures = closingFigures(company, to);
  const groups = company.groups.filter((g) => !g.parent).map((group) => {
    const ledgers = company.ledgers
      .filter((l) => l.groupId && isUnder(company, l.groupId, group.id) && figures.get(l.id))
      .map((l) => ({ ledger: l, balance: figures.get(l.id) }))
      .sort((a, b) => a.ledger.name.localeCompare(b.ledger.name));
    return { group, ledgers, balance: ledgers.reduce((sum, r) => sum + r.balance, 0) };
  }).filter((g) => g.ledgers.length);

  const pl = figures.get('pl');
  const difference = 0 - openingDifference(company);
  const all = [...groups.map((g) => g.balance), pl, difference];
  return {
    groups,
    pl,
    difference,
    debit: all.filter((x) => x > 0).reduce((a, b) => a + b, 0),
    credit: -all.filter((x) => x < 0).reduce((a, b) => a + b, 0),
  };
}

/** Trading and profit and loss account for [from, to]. */
export function profitAndLoss(company, from, to) {
  const period = movements(company, from, to);
  const line = (group, sign) => {
    const amount = sign * company.ledgers
      .filter((l) => l.groupId && isUnder(company, l.groupId, group.id))
      .reduce((sum, l) => sum + (period.get(l.id) || 0), 0);
    return { label: group.name, groupId: group.id, amount };
  };
  const primaries = company.groups.filter((g) => !g.parent);
  const pick = (nature, grossProfit) =>
    primaries.filter((g) => g.nature === nature && !!g.grossProfit === grossProfit)
      .map((g) => line(g, nature === 'income' ? -1 : 1))
      .filter((l) => l.amount);

  // Stock without inventory: the stock ledgers' book balance is the opening
  // stock and the closing value typed on each ledger is the closing stock.
  const stockLedgers = company.ledgers.filter((l) => isStockLedger(company, l));
  const openingStock = stockLedgers.reduce((sum, l) => sum + ledgerBalance(company, l.id, to), 0);
  const closingStock = stockLedgers.reduce((sum, l) => sum + (l.closingStock || 0), 0);

  const tradingDebit = [
    ...(openingStock ? [{ label: 'Opening Stock', groupId: 'stock', amount: openingStock }] : []),
    ...pick('expense', true),
  ];
  const tradingCredit = [
    ...pick('income', true),
    ...(closingStock ? [{ label: 'Closing Stock', groupId: 'stock', amount: closingStock }] : []),
  ];
  const sum = (lines) => lines.reduce((total, l) => total + l.amount, 0);
  const grossProfit = sum(tradingCredit) - sum(tradingDebit);
  const indirectExpenses = pick('expense', false);
  const indirectIncomes = pick('income', false);
  const netProfit = grossProfit + sum(indirectIncomes) - sum(indirectExpenses);
  return { tradingDebit, tradingCredit, grossProfit, indirectExpenses, indirectIncomes, netProfit };
}

/** Balance sheet as at `to`. Liabilities and assets always agree. */
export function balanceSheet(company, to) {
  const fyStart = fyStartOf(company, to);
  const figures = closingFigures(company, to);
  const sideOf = (nature) => company.groups
    .filter((g) => !g.parent && g.nature === nature)
    .map((group) => {
      let amount = 0;
      for (const ledger of company.ledgers) {
        if (!ledger.groupId || !isUnder(company, ledger.groupId, group.id)) continue;
        amount += isStockLedger(company, ledger) ? ledger.closingStock || 0 : figures.get(ledger.id);
      }
      return { label: group.name, groupId: group.id, amount: nature === 'liability' ? -amount : amount };
    })
    .filter((row) => row.amount);

  const liabilities = sideOf('liability');
  const assets = sideOf('asset');
  const currentProfit = profitAndLoss(company, fyStart, to).netProfit;
  const profitAccount = -figures.get('pl') + currentProfit;
  if (profitAccount) {
    liabilities.push({ label: 'Profit & Loss A/c', groupId: null, amount: profitAccount,
      opening: profitAccount - currentProfit, current: currentProfit });
  }
  const difference = openingDifference(company);
  if (difference > 0) liabilities.push({ label: 'Diff. in opening balances', groupId: null, amount: difference });
  if (difference < 0) assets.push({ label: 'Diff. in opening balances', groupId: null, amount: -difference });

  const sum = (rows) => rows.reduce((total, r) => total + r.amount, 0);
  return { liabilities, assets, totalLiabilities: sum(liabilities), totalAssets: sum(assets) };
}

const TAX_TYPES = ['cgst', 'sgst', 'igst'];

/** Output tax, input tax and the register of GST invoices for [from, to]. */
export function gstSummary(company, from, to) {
  const period = movements(company, from, to);
  const tax = (direction, sign) => Object.fromEntries(TAX_TYPES.map((t) =>
    [t, sign * (period.get(`${direction}-${t}`) || 0)]));
  const output = tax('output', -1);
  const input = tax('input', 1);
  const payable = Object.fromEntries(TAX_TYPES.map((t) => [t, output[t] - input[t]]));

  const register = company.vouchers
    .filter((v) => v.invoice && v.date >= from && v.date <= to)
    .sort(byDate)
    .map((voucher) => {
      const party = ledgerById(company, voucher.invoice.partyId);
      // Returns reduce the figures, so they are shown negative.
      const sign = voucher.type === 'creditNote' || voucher.type === 'debitNote' ? -1 : 1;
      const t = voucher.invoice.totals;
      return {
        voucher,
        party: party?.name || '',
        gstin: party?.gstin || '',
        outward: voucher.type === 'sales' || voucher.type === 'creditNote',
        taxable: sign * t.taxable,
        cgst: sign * t.cgst,
        sgst: sign * t.sgst,
        igst: sign * t.igst,
        total: sign * t.total,
      };
    });
  return { output, input, payable, register };
}

/** Closing balance of every ledger as at `to`, for the list of ledgers. */
export function ledgerBalances(company, to) {
  const figures = closingFigures(company, to);
  return company.ledgers
    .map((ledger) => ({ ledger, group: groupById(company, ledger.groupId), balance: figures.get(ledger.id) }))
    .sort((a, b) => a.ledger.name.localeCompare(b.ledger.name));
}
