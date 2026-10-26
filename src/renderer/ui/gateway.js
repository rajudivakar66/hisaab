// The main menu of an open company, with a few balances at a glance.

import { groupSummary } from '../core/books.js';
import { formatBalance } from '../core/money.js';
import { app, formatDate } from './app.js';
import { companyForm } from './company.js';
import { h } from './dom.js';
import { chartOfAccounts, groupForm, ledgerForm } from './masters.js';
import { keyboardMenu } from './menu.js';
import {
  balanceSheetScreen, dayBookScreen, gstScreen, ledgerStatementScreen, profitLossScreen, push, trialBalanceScreen,
} from './reports.js';

export function gateway() {
  const c = app.company;
  const menu = keyboardMenu([
    {
      title: 'Masters',
      items: [
        { label: 'Create Ledger', hotkey: 'C', run: () => app.push(() => ledgerForm()) },
        { label: 'Create Group', hotkey: 'G', run: () => app.push(() => groupForm()) },
        { label: 'Chart of Accounts', hotkey: 'H', run: () => app.push(() => chartOfAccounts()) },
      ],
    },
    {
      title: 'Transactions',
      items: [
        { label: 'Vouchers', hotkey: 'V', run: () => app.openVoucher('sales') },
        { label: 'Day Book', hotkey: 'K', run: () => push(dayBookScreen) },
      ],
    },
    {
      title: 'Reports',
      items: [
        { label: 'Balance Sheet', hotkey: 'B', run: () => push(balanceSheetScreen) },
        { label: 'Profit & Loss A/c', hotkey: 'P', run: () => push(profitLossScreen) },
        { label: 'Trial Balance', hotkey: 'T', run: () => push(trialBalanceScreen) },
        { label: 'Ledger', hotkey: 'L', run: () => push(ledgerStatementScreen) },
        { label: 'GST Summary', hotkey: 'S', run: () => push(gstScreen) },
      ],
    },
    {
      title: 'Company',
      items: [
        { label: 'Alter Company', hotkey: 'A', run: () => app.push(() => companyForm(c)) },
        { label: 'Quit Company', hotkey: 'Q', run: () => app.closeCompany() },
      ],
    },
  ]);

  const glance = [
    ['Cash-in-Hand', 'cash'], ['Bank Accounts', 'bank'], ['Sundry Debtors', 'debtors'], ['Sundry Creditors', 'creditors'],
  ].map(([label, id]) => h('div', { class: 'glance-item' },
    h('span', { class: 'muted small' }, label),
    h('strong', {}, formatBalance(groupSummary(c, id, app.workingDate).total))));

  return {
    title: 'Gateway',
    el: h('div', { class: 'page gateway' },
      h('div', { class: 'gateway-head' },
        h('div', {}, h('h1', {}, c.name), h('p', { class: 'muted' },
          [c.gstin && `GSTIN ${c.gstin}`, c.state, `Books from ${formatDate(c.booksFrom)}`].filter(Boolean).join(' · '))),
        h('div', { class: 'glance' }, glance)),
      menu.el,
      h('p', { class: 'muted small' }, 'Press the underlined letter, or use the arrow keys and Enter. F4–F9 open vouchers from anywhere.')),
    onKey: menu.onKey,
  };
}
