import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BooksError, balanceSheet, computeInvoice, createCompany, dayBook, deleteLedger, fyEndOf, fyLabel,
  gstSummary, ledgerBalance, ledgerStatement, nextVoucherNumber, profitAndLoss, saveGroup, saveLedger,
  saveVoucher, trialBalance,
} from '../src/renderer/core/books.js';
import { amountInWords, formatAmount, formatBalance, toPaise } from '../src/renderer/core/money.js';
import { isValidGstin, stateFromGstin } from '../src/renderer/core/states.js';

const rupees = (n) => Math.round(n * 100);

function company() {
  return createCompany({ name: 'Sharma Traders', state: 'Maharashtra', fyStart: '2026-04-01' });
}

/** A trading year: capital, stock, a bank, a customer and a supplier. */
function tradingCompany() {
  const c = company();
  const capital = saveLedger(c, { name: 'Capital', groupId: 'capital', opening: -rupees(150000) });
  const bank = saveLedger(c, { name: 'HDFC Bank', groupId: 'bank', opening: rupees(100000) });
  const stock = saveLedger(c, { name: 'Stock', groupId: 'stock', opening: rupees(50000), closingStock: rupees(60000) });
  const customer = saveLedger(c, { name: 'Ravi Stores', groupId: 'debtors', state: 'Maharashtra' });
  const outside = saveLedger(c, { name: 'Gupta & Sons', groupId: 'debtors', state: 'Gujarat' });
  const supplier = saveLedger(c, { name: 'Mehta Wholesale', groupId: 'creditors', state: 'Maharashtra' });
  const rent = saveLedger(c, { name: 'Rent', groupId: 'indirect-expenses' });
  return { c, capital, bank, stock, customer, outside, supplier, rent };
}

const item = (qty, rate, gstRate) => ({ name: 'Item', hsn: '1234', qty, rate: rupees(rate), gstRate });

test('money: parses, formats and spells amounts the Indian way', () => {
  assert.equal(toPaise('1,23,456.5'), 12345650);
  assert.equal(toPaise('₹ 10'), 1000);
  assert.equal(toPaise(''), 0);
  assert.ok(Number.isNaN(toPaise('12.345')));
  assert.ok(Number.isNaN(toPaise('abc')));
  assert.equal(formatAmount(12345650), '1,23,456.50');
  assert.equal(formatBalance(-500), '5.00 Cr');
  assert.equal(amountInWords(12345650),
    'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only');
  assert.equal(amountInWords(rupees(10000000)), 'Rupees One Crore Only');
});

test('states: GSTIN validation and state lookup', () => {
  assert.ok(isValidGstin('27ABCDE1234F1Z5'));
  assert.ok(!isValidGstin('27ABCDE1234F1Z'));
  assert.equal(stateFromGstin('29ABCDE1234F1Z5'), 'Karnataka');
});

test('financial year helpers', () => {
  const c = company();
  assert.equal(fyLabel(c, '2027-03-31'), '2026-27');
  assert.equal(fyLabel(c, '2027-04-01'), '2027-28');
  assert.equal(fyEndOf(c, '2026-06-15'), '2027-03-31');
});

test('ledgers: names are unique and used ledgers cannot be deleted', () => {
  const { c, bank, rent } = tradingCompany();
  assert.throws(() => saveLedger(c, { name: 'hdfc bank', groupId: 'bank' }), BooksError);
  saveVoucher(c, { type: 'payment', date: '2026-04-05', entries: [
    { ledgerId: rent.id, amount: rupees(5000) }, { ledgerId: bank.id, amount: -rupees(5000) },
  ] });
  assert.throws(() => deleteLedger(c, rent.id), /used in vouchers/);
  assert.throws(() => deleteLedger(c, 'cash'), /Built-in/);
});

test('groups: custom groups inherit the nature of their parent', () => {
  const c = company();
  const group = saveGroup(c, { name: 'Office Expenses', parent: 'indirect-expenses' });
  const ledger = saveLedger(c, { name: 'Stationery', groupId: group.id });
  saveVoucher(c, { type: 'payment', date: '2026-05-01', entries: [
    { ledgerId: ledger.id, amount: rupees(300) }, { ledgerId: 'cash', amount: -rupees(300) },
  ] });
  const pl = profitAndLoss(c, '2026-04-01', '2027-03-31');
  assert.deepEqual(pl.indirectExpenses.map((l) => [l.label, l.amount]), [['Indirect Expenses', rupees(300)]]);
});

test('vouchers: must balance and follow their type', () => {
  const { c, bank, rent, customer } = tradingCompany();
  const unbalanced = { type: 'journal', date: '2026-04-02', entries: [
    { ledgerId: rent.id, amount: 100 }, { ledgerId: bank.id, amount: -90 },
  ] };
  assert.throws(() => saveVoucher(c, unbalanced), /do not match/);
  assert.throws(() => saveVoucher(c, { type: 'contra', date: '2026-04-02', entries: [
    { ledgerId: rent.id, amount: 100 }, { ledgerId: bank.id, amount: -100 },
  ] }), /cash and bank/);
  assert.throws(() => saveVoucher(c, { type: 'receipt', date: '2026-04-02', entries: [
    { ledgerId: customer.id, amount: 100 }, { ledgerId: rent.id, amount: -100 },
  ] }), /received into a cash or bank/);
  assert.throws(() => saveVoucher(c, { type: 'journal', date: '2026-03-31', entries: [
    { ledgerId: rent.id, amount: 100 }, { ledgerId: bank.id, amount: -100 },
  ] }), /Books begin/);
});

test('vouchers: numbers run per type and restart each financial year', () => {
  const { c, bank } = tradingCompany();
  const contra = (date) => saveVoucher(c, { type: 'contra', date, entries: [
    { ledgerId: 'cash', amount: 100 }, { ledgerId: bank.id, amount: -100 },
  ] });
  assert.equal(contra('2026-04-10').number, 1);
  assert.equal(contra('2026-04-11').number, 2);
  assert.equal(contra('2027-04-01').number, 1);
  assert.equal(nextVoucherNumber(c, 'contra', '2026-12-01'), 3);
  // Editing keeps the number while the year stays the same.
  const first = c.vouchers[0];
  const edited = saveVoucher(c, { ...first, date: '2026-05-01' });
  assert.equal(edited.number, 1);
  assert.equal(c.vouchers.length, 3);
});

test('GST: intrastate splits CGST and SGST, interstate charges IGST, totals round to the rupee', () => {
  const c = company();
  const local = computeInvoice(c, { placeOfSupply: 'Maharashtra', items: [item(3, 333.33, 18)] });
  assert.equal(local.taxable, 99999);
  assert.equal(local.cgst, 9000);
  assert.equal(local.sgst, 9000);
  assert.equal(local.igst, 0);
  assert.equal(local.total, 117999 + 1);
  assert.equal(local.roundOff, 1);

  const outside = computeInvoice(c, { placeOfSupply: 'Gujarat', items: [item(2, 1000, 12), item(1, 500, 5)] });
  assert.equal(outside.interstate, true);
  assert.equal(outside.igst, rupees(240 + 25));
  assert.equal(outside.total, rupees(2500 + 265));
});

test('sales invoice posts party, sales and output tax', () => {
  const { c, customer } = tradingCompany();
  const v = saveVoucher(c, { type: 'sales', date: '2026-04-15', invoice: {
    partyId: customer.id, ledgerId: 'sales', items: [item(10, 100, 18)],
  } });
  const posted = Object.fromEntries(v.entries.map((e) => [e.ledgerId, e.amount]));
  assert.deepEqual(posted, {
    [customer.id]: rupees(1180), sales: -rupees(1000), 'output-cgst': -rupees(90), 'output-sgst': -rupees(90),
  });
  assert.equal(v.invoice.placeOfSupply, 'Maharashtra');
  assert.throws(() => saveVoucher(c, { type: 'sales', date: '2026-04-15', invoice: {
    partyId: customer.id, ledgerId: 'purchase', items: [item(1, 1, 0)],
  } }), /sales ledger/);
});

test('reports: a trading year balances and the profit is right', () => {
  const { c, capital, bank, stock, customer, outside, supplier, rent } = tradingCompany();
  // Buy 40,000 + 18% GST on credit.
  saveVoucher(c, { type: 'purchase', date: '2026-04-05', invoice: {
    partyId: supplier.id, ledgerId: 'purchase', items: [item(400, 100, 18)],
  } });
  // Sell 50,000 + 18% locally and 20,000 + 18% IGST to Gujarat.
  saveVoucher(c, { type: 'sales', date: '2026-04-20', invoice: {
    partyId: customer.id, ledgerId: 'sales', items: [item(250, 200, 18)],
  } });
  saveVoucher(c, { type: 'sales', date: '2026-04-25', invoice: {
    partyId: outside.id, ledgerId: 'sales', items: [item(100, 200, 18)],
  } });
  // Customer returns goods worth 2,000 + GST.
  saveVoucher(c, { type: 'creditNote', date: '2026-05-02', invoice: {
    partyId: customer.id, ledgerId: 'sales', items: [item(10, 200, 18)],
  } });
  // Pay rent, receive from the customer, pay the supplier.
  saveVoucher(c, { type: 'payment', date: '2026-05-01', entries: [
    { ledgerId: rent.id, amount: rupees(8000) }, { ledgerId: bank.id, amount: -rupees(8000) },
  ] });
  saveVoucher(c, { type: 'receipt', date: '2026-05-10', entries: [
    { ledgerId: bank.id, amount: rupees(30000) }, { ledgerId: customer.id, amount: -rupees(30000) },
  ] });
  saveVoucher(c, { type: 'payment', date: '2026-05-12', entries: [
    { ledgerId: supplier.id, amount: rupees(47200) }, { ledgerId: bank.id, amount: -rupees(47200) },
  ] });

  const pl = profitAndLoss(c, '2026-04-01', '2027-03-31');
  // Sales 70,000 - 2,000 return; purchase 40,000; stock 50,000 -> 60,000.
  assert.equal(pl.grossProfit, rupees(68000 - 40000 - 50000 + 60000));
  assert.equal(pl.netProfit, rupees(38000 - 8000));

  const tb = trialBalance(c, '2027-03-31');
  assert.equal(tb.debit, tb.credit);
  assert.equal(tb.difference, 0);

  const bs = balanceSheet(c, '2027-03-31');
  assert.equal(bs.totalAssets, bs.totalLiabilities);
  const row = (side, label) => bs[side].find((r) => r.label === label)?.amount;
  assert.equal(row('liabilities', 'Capital Account'), rupees(150000));
  assert.equal(row('liabilities', 'Profit & Loss A/c'), rupees(30000));
  // Output GST 12,600 - 360 on the return, input GST 7,200.
  assert.equal(row('liabilities', 'Current Liabilities'), rupees(12240 - 7200));
  assert.equal(ledgerBalance(c, bank.id, '2027-03-31'), rupees(100000 - 8000 + 30000 - 47200));

  const gst = gstSummary(c, '2026-04-01', '2027-03-31');
  assert.equal(gst.output.cgst, rupees(4500 - 180));
  assert.equal(gst.output.igst, rupees(3600));
  assert.equal(gst.input.cgst, rupees(3600));
  assert.equal(gst.payable.igst, rupees(3600));
  assert.equal(gst.register.length, 4);
  assert.equal(gst.register.find((r) => r.voucher.type === 'creditNote').taxable, -rupees(2000));

  const statement = ledgerStatement(c, customer.id, '2026-04-01', '2027-03-31');
  assert.equal(statement.opening, 0);
  assert.equal(statement.closing, rupees(59000 - 2360 - 30000));
  assert.equal(statement.rows[0].particulars, 'Sales + 2 more');

  assert.equal(dayBook(c, '2026-05-01', '2026-05-31').length, 4);
  void capital;
  void stock;
});

test('reports: profit carries into the next year through the Profit & Loss A/c', () => {
  const { c, bank, rent } = tradingCompany();
  const income = saveLedger(c, { name: 'Commission', groupId: 'indirect-incomes' });
  saveVoucher(c, { type: 'receipt', date: '2026-06-01', entries: [
    { ledgerId: bank.id, amount: rupees(20000) }, { ledgerId: income.id, amount: -rupees(20000) },
  ] });
  saveVoucher(c, { type: 'payment', date: '2027-04-10', entries: [
    { ledgerId: rent.id, amount: rupees(5000) }, { ledgerId: bank.id, amount: -rupees(5000) },
  ] });
  const nextYear = profitAndLoss(c, '2027-04-01', '2028-03-31');
  assert.equal(nextYear.indirectIncomes.length, 0);

  const bs = balanceSheet(c, '2028-03-31');
  assert.equal(bs.totalAssets, bs.totalLiabilities);
  const pl = bs.liabilities.find((r) => r.label === 'Profit & Loss A/c');
  // Stock 50,000 -> 60,000 adds 10,000 in the year of the closing value.
  assert.equal(pl.opening, rupees(20000));
  assert.equal(pl.current, rupees(10000 - 5000));

  const tb = trialBalance(c, '2028-03-31');
  assert.equal(tb.debit, tb.credit);
});

test('reports: unequal opening balances show as a difference and still balance', () => {
  const c = company();
  saveLedger(c, { name: 'Bank', groupId: 'bank', opening: rupees(1000) });
  const bs = balanceSheet(c, '2027-03-31');
  assert.equal(bs.totalAssets, bs.totalLiabilities);
  assert.equal(bs.liabilities.at(-1).label, 'Diff. in opening balances');
  const tb = trialBalance(c, '2027-03-31');
  assert.equal(tb.difference, -rupees(1000));
  assert.equal(tb.debit, tb.credit);
});
