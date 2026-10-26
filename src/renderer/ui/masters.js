// Ledger and group masters, and the chart of accounts.

import {
  BooksError, deleteGroup, deleteLedger, isLedgerUsed, isUnder, ledgerBalances, primaryOf,
  saveGroup, saveLedger,
} from '../core/books.js';
import { formatBalance } from '../core/money.js';
import { STATES } from '../core/states.js';
import { app } from './app.js';
import { field, h, toast } from './dom.js';
import { amountInput, balanceInput } from './widgets.js';

/** Groups as indented <option>s, primary groups first. */
function groupOptions(selected, exclude) {
  const company = app.company;
  const options = [];
  const walk = (parent, depth) => {
    company.groups.filter((g) => (g.parent || null) === parent && g.id !== exclude)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((g) => {
        options.push(h('option', { value: g.id, selected: g.id === selected },
          `${'   '.repeat(depth)}${g.name}`));
        walk(g.id, depth + 1);
      });
  };
  walk(null, 0);
  return options;
}

/**
 * The ledger form. Used as a screen and inside the "create ledger" dialog of
 * a voucher, so it reports through `onSaved` instead of navigating itself.
 */
export function ledgerFormBody(existing, { onSaved, onCancel, defaultGroup = 'debtors', defaultName = '' } = {}) {
  const company = app.company;
  const l = existing || {};
  const name = h('input', { value: l.name || defaultName, autofocus: true });
  const group = h('select', { disabled: !!l.system },
    l.id === 'pl' ? h('option', { value: '' }, 'Primary') : groupOptions(l.groupId || defaultGroup));
  const opening = balanceInput(l.opening || 0);
  const closingStock = amountInput({ value: l.closingStock || 0 });
  const address = h('textarea', { rows: 2 }, l.address || '');
  const state = h('select', {},
    h('option', { value: '' }, '— Not applicable —'),
    STATES.map((s) => h('option', { value: s.name, selected: s.name === l.state }, `${s.code} · ${s.name}`)));
  const gstin = h('input', { value: l.gstin || '', maxlength: 15, style: { textTransform: 'uppercase' } });
  const phone = h('input', { value: l.phone || '' });
  const email = h('input', { value: l.email || '', type: 'email' });

  const partyFields = h('div', { class: 'form grid-2' },
    field('Address', address), field('State', state, 'Used for the place of supply on invoices.'),
    field('GSTIN', gstin), field('Phone', phone), field('E-mail', email));
  const stockField = field('Closing stock value', closingStock.el,
    'Enter the value of stock in hand at the report date; it updates Profit & Loss and the Balance Sheet.');

  const nominal = () => ['income', 'expense'].includes(primaryOf(company, group.value)?.nature);
  function updateVisibility() {
    const g = group.value;
    const isParty = ['debtors', 'creditors', 'bank', 'bank-od', 'secured-loans', 'unsecured-loans',
      'loans-advances'].some((id) => isUnder(company, g, id));
    partyFields.hidden = !isParty;
    stockField.hidden = !isUnder(company, g, 'stock');
    openingField.hidden = nominal() && !existing?.opening;
  }
  const openingField = field('Opening balance', opening.el,
    `As on ${company.booksFrom}. Assets and expenses are usually Dr; liabilities and incomes Cr.`);
  group.addEventListener('change', () => {
    // Liabilities and incomes usually open on the credit side.
    const nature = primaryOf(company, group.value)?.nature;
    if (!existing) opening.side.value = nature === 'liability' || nature === 'income' ? 'Cr' : 'Dr';
    updateVisibility();
  });

  function accept() {
    try {
      const saved = saveLedger(company, {
        id: existing?.id,
        name: name.value,
        groupId: group.value,
        opening: opening.value,
        closingStock: closingStock.value,
        address: address.value,
        state: state.value,
        gstin: gstin.value,
        phone: phone.value,
        email: email.value,
      });
      app.save().then(() => onSaved?.(saved));
    } catch (error) {
      if (error instanceof BooksError) return toast(error.message, 'error');
      throw error;
    }
  }

  function remove() {
    if (!confirm(`Delete the ledger "${existing.name}"?`)) return;
    try {
      deleteLedger(company, existing.id);
    } catch (error) {
      if (error instanceof BooksError) return toast(error.message, 'error');
      throw error;
    }
    app.save().then(() => {
      toast('Ledger deleted');
      onCancel?.();
    });
  }

  const el = h('div', {},
    h('div', { class: 'form grid-2' },
      field('Name', name),
      field('Under', group, l.system ? 'Built-in ledger: the group is fixed.' : null),
      openingField,
      stockField),
    partyFields,
    h('div', { class: 'actions' },
      existing && !existing.system && !isLedgerUsed(company, existing.id)
        ? h('button', { class: 'danger', onclick: remove }, 'Delete') : null,
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => onCancel?.() }, 'Cancel'),
      h('button', { class: 'primary', onclick: accept }, 'Accept (Ctrl+A)')));
  updateVisibility();
  const snapshot = () => [name.value, group.value, opening.value, address.value, state.value, gstin.value,
    phone.value, email.value, closingStock.value].join('|');
  const initial = snapshot();
  return { el, accept, isDirty: () => snapshot() !== initial };
}

export function ledgerForm(existing) {
  const body = ledgerFormBody(existing, {
    onSaved: (ledger) => {
      toast(existing ? 'Ledger updated' : `Ledger "${ledger.name}" created`, 'success');
      if (existing) app.back({ force: true });
      else app.replace(() => ledgerForm());
    },
    onCancel: () => app.back({ force: true }),
  });
  return {
    title: existing ? 'Ledger Alteration' : 'Ledger Creation',
    el: h('div', { class: 'page narrow' }, h('h1', {}, existing ? `Alter ledger: ${existing.name}` : 'Create Ledger'),
      body.el),
    onAccept: body.accept,
    isDirty: body.isDirty,
  };
}

export function groupForm(existing) {
  const company = app.company;
  const name = h('input', { value: existing?.name || '', autofocus: true });
  const parent = h('select', {}, groupOptions(existing?.parent || 'indirect-expenses', existing?.id));
  const nature = h('p', { class: 'muted small' });
  const showNature = () => {
    const p = primaryOf(company, parent.value);
    nature.textContent = `Behaves like ${p.name} (${p.nature}).`;
  };
  parent.addEventListener('change', showNature);
  showNature();

  function accept() {
    try {
      saveGroup(company, { id: existing?.id, name: name.value, parent: parent.value });
    } catch (error) {
      if (error instanceof BooksError) return toast(error.message, 'error');
      throw error;
    }
    app.save().then(() => {
      toast(existing ? 'Group updated' : 'Group created', 'success');
      app.back({ force: true });
    });
  }

  function remove() {
    if (!confirm(`Delete the group "${existing.name}"?`)) return;
    try {
      deleteGroup(company, existing.id);
    } catch (error) {
      if (error instanceof BooksError) return toast(error.message, 'error');
      throw error;
    }
    app.save().then(() => app.back({ force: true }));
  }

  const initial = `${name.value}|${parent.value}`;
  return {
    title: existing ? 'Group Alteration' : 'Group Creation',
    el: h('div', { class: 'page narrow' },
      h('h1', {}, existing ? `Alter group: ${existing.name}` : 'Create Group'),
      h('div', { class: 'form grid-2' }, field('Name', name), h('div', {}, field('Under', parent), nature)),
      h('div', { class: 'actions' },
        existing ? h('button', { class: 'danger', onclick: remove }, 'Delete') : null,
        h('span', { class: 'spacer' }),
        h('button', { onclick: () => app.back() }, 'Cancel'),
        h('button', { class: 'primary', onclick: accept }, 'Accept (Ctrl+A)'))),
    onAccept: accept,
    isDirty: () => `${name.value}|${parent.value}` !== initial,
  };
}

/** Every ledger with its group and balance, and the group tree. */
export function chartOfAccounts(tab = 'ledgers') {
  const company = app.company;
  const search = h('input', { type: 'search', placeholder: 'Search ledgers…', autofocus: true });
  const tbody = h('tbody');
  const rows = ledgerBalances(company, app.workingDate);

  function fill() {
    const q = search.value.trim().toLowerCase();
    tbody.replaceChildren(...rows
      .filter((r) => !q || r.ledger.name.toLowerCase().includes(q) || r.group?.name.toLowerCase().includes(q))
      .map((r) => h('tr', { class: 'clickable', tabindex: 0, onclick: () => app.push(() => ledgerForm(r.ledger)),
        onkeydown: (e) => { if (e.key === 'Enter') app.push(() => ledgerForm(r.ledger)); } },
      h('td', {}, r.ledger.name),
      h('td', {}, r.group?.name || 'Primary'),
      h('td', { class: 'num' }, formatBalance(r.balance)),
      h('td', { class: 'num' }, h('button', { class: 'link', onclick: (e) => {
        e.stopPropagation();
        app.push(() => app.screens.ledgerStatement(r.ledger.id));
      } }, 'Statement')))));
  }
  search.addEventListener('input', fill);
  fill();

  const groupTree = h('ul', { class: 'tree' });
  const walk = (parent, holder) => {
    company.groups.filter((g) => (g.parent || null) === parent).sort((a, b) => a.name.localeCompare(b.name))
      .forEach((g) => {
        const children = h('ul');
        holder.append(h('li', {},
          g.system ? h('span', {}, g.name) : h('button', { class: 'link', onclick: () => app.push(() => groupForm(g)) }, g.name),
          g.system ? null : h('span', { class: 'muted small' }, ' (custom)'),
          children));
        walk(g.id, children);
      });
  };
  walk(null, groupTree);

  const ledgersPanel = h('div', {},
    h('div', { class: 'toolbar' }, search, h('span', { class: 'spacer' }),
      h('button', { onclick: () => app.push(() => ledgerForm()) }, 'Create ledger (Alt+C)')),
    h('table', { class: 'report' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Ledger'), h('th', {}, 'Under'), h('th', { class: 'num' }, 'Closing balance'),
        h('th', {}))),
      tbody));
  const groupsPanel = h('div', {},
    h('div', { class: 'toolbar' }, h('span', { class: 'spacer' }),
      h('button', { onclick: () => app.push(() => groupForm()) }, 'Create group (Alt+G)')),
    groupTree);

  const show = (which) => {
    ledgersPanel.hidden = which !== 'ledgers';
    groupsPanel.hidden = which !== 'groups';
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === which));
  };
  const tabs = h('div', { class: 'tabs' },
    h('button', { dataset: { tab: 'ledgers' }, onclick: () => show('ledgers') }, 'Ledgers'),
    h('button', { dataset: { tab: 'groups' }, onclick: () => show('groups') }, 'Groups'));
  show(tab);

  return {
    title: 'Chart of Accounts',
    el: h('div', { class: 'page' }, h('h1', {}, 'Chart of Accounts'), tabs, ledgersPanel, groupsPanel),
    keys: [
      { key: 'Alt+C', label: 'Create ledger', run: () => app.push(() => ledgerForm()) },
      { key: 'Alt+G', label: 'Create group', run: () => app.push(() => groupForm()) },
    ],
  };
}
