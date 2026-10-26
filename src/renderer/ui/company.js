// Company selection, creation and alteration, plus backup and restore.

import { BooksError, createCompany, fyLabel, updateCompany } from '../core/books.js';
import { isDesktop, isValidData } from '../core/storage.js';
import { STATES } from '../core/states.js';
import { app, closeModal, openModal, todayIso } from './app.js';
import { field, h, toast } from './dom.js';
import { keyboardMenu } from './menu.js';

export function companyList() {
  const companies = [...app.data.companies].sort((a, b) => a.name.localeCompare(b.name));
  const menu = keyboardMenu([
    {
      title: companies.length ? 'Select a company' : 'No companies yet',
      items: companies.map((c, i) => ({
        label: `${c.name}  ·  FY ${fyLabel(c, c.booksFrom)}${c.gstin ? '  ·  ' + c.gstin : ''}`,
        hotkey: i < 9 ? String(i + 1) : undefined,
        run: () => app.openCompany(c),
      })),
    },
    {
      title: 'Company',
      items: [
        { label: 'Create Company', hotkey: 'C', run: () => app.push(() => companyForm()) },
        { label: 'Backup all companies', hotkey: 'B', run: backup },
        { label: 'Restore from backup', hotkey: 'R', run: restore },
      ],
    },
  ]);

  const info = h('p', { class: 'muted small' });
  if (isDesktop()) {
    window.desktop.dataFolder().then((folder) => {
      info.replaceChildren('Your books are saved in ', h('button', {
        class: 'link', onclick: () => window.desktop.openDataFolder(),
      }, folder), '. Keep regular backups on a pen drive or cloud folder.');
    });
  } else {
    info.textContent = 'Running in a browser: books are saved in this browser only. Use backups.';
  }

  return {
    title: 'Gateway',
    el: h('div', { class: 'page narrow' },
      h('h1', {}, 'Welcome to Hisaab'),
      h('p', { class: 'muted' }, 'Double-entry accounting with GST for Indian businesses.'),
      menu.el,
      info),
    onKey: menu.onKey,
  };
}

async function backup() {
  if (!app.data.companies.length) return toast('There is nothing to back up yet');
  if (isDesktop()) {
    const path = await window.desktop.exportBackup(app.data);
    if (path) toast(`Backup saved: ${path}`, 'success');
    return;
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(app.data)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `Hisaab-backup-${todayIso()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
}

async function restore() {
  let data;
  try {
    data = isDesktop() ? await window.desktop.importBackup() : await pickFile();
  } catch {
    return toast('That file is not a Hisaab backup', 'error');
  }
  if (!data) return;
  if (!isValidData(data)) return toast('That file is not a Hisaab backup', 'error');
  const names = data.companies.map((c) => c.name).join(', ');
  if (!confirm(`Restore ${data.companies.length} company(ies): ${names}?\n\n` +
    'Companies with the same ID are replaced by the backup copy. Others are kept.')) return;
  for (const company of data.companies) {
    const at = app.data.companies.findIndex((c) => c.id === company.id);
    if (at >= 0) app.data.companies[at] = company;
    else app.data.companies.push(company);
  }
  await app.save();
  toast('Backup restored', 'success');
  app.reset(companyList);
}

function pickFile() {
  return new Promise((resolve, reject) => {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => {
      try {
        resolve(input.files[0] ? JSON.parse(await input.files[0].text()) : null);
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

/** Creates a company, or alters `existing`. */
export function companyForm(existing) {
  const fyDefault = (() => {
    const today = todayIso();
    const year = Number(today.slice(0, 4)) - (today.slice(5) < '04-01' ? 1 : 0);
    return `${year}-04-01`;
  })();
  const c = existing || {};
  const input = (name, props = {}) => h('input', { name, value: c[name] || '', ...props });
  const els = {
    name: input('name', { autofocus: true, required: true }),
    mailingName: input('mailingName'),
    address: h('textarea', { name: 'address', rows: 3 }, c.address || ''),
    state: h('select', { name: 'state' },
      h('option', { value: '' }, '— Select state —'),
      STATES.map((s) => h('option', { value: s.name, selected: s.name === c.state }, `${s.code} · ${s.name}`))),
    pincode: input('pincode', { inputmode: 'numeric', maxlength: 6 }),
    phone: input('phone'),
    email: input('email', { type: 'email' }),
    gstin: input('gstin', { maxlength: 15, style: { textTransform: 'uppercase' } }),
    fyStart: input('fyStart', { type: 'date', value: c.fyStart || fyDefault }),
    booksFrom: input('booksFrom', { type: 'date', value: c.booksFrom || c.fyStart || fyDefault }),
  };
  if (existing && existing.vouchers.length) {
    els.fyStart.disabled = true;
    els.booksFrom.disabled = true;
  }
  els.fyStart.addEventListener('change', () => {
    if (!existing) els.booksFrom.value = els.fyStart.value;
  });
  const initial = JSON.stringify(Object.values(els).map((e) => e.value));

  async function accept() {
    const details = Object.fromEntries(Object.entries(els).map(([k, e]) => [k, e.value]));
    try {
      if (existing) {
        updateCompany(existing, { ...existing, ...details });
      } else {
        app.data.companies.push(createCompany(details));
      }
    } catch (error) {
      if (error instanceof BooksError) return toast(error.message, 'error');
      throw error;
    }
    await app.save();
    toast(existing ? 'Company updated' : 'Company created', 'success');
    if (existing) {
      app.back({ force: true });
    } else {
      app.openCompany(app.data.companies.at(-1));
    }
  }

  // Electron has no window.prompt, so the name check is a small dialog.
  function remove() {
    const typed = h('input', { placeholder: existing.name });
    const confirmDelete = async () => {
      if (typed.value.trim() !== existing.name) return toast('Name did not match; nothing deleted', 'error');
      closeModal();
      app.data.companies = app.data.companies.filter((x) => x.id !== existing.id);
      await app.save();
      toast('Company deleted');
      app.closeCompany();
    };
    openModal('Delete company', h('div', { class: 'form' },
      h('p', {}, `This deletes ${existing.name} and all its vouchers. Type the company name to confirm.`),
      typed,
      h('div', { class: 'actions' },
        h('button', { onclick: closeModal }, 'Cancel'),
        h('button', { class: 'danger', onclick: confirmDelete }, 'Delete'))),
    { onAccept: confirmDelete });
  }

  return {
    title: existing ? 'Company Alteration' : 'Company Creation',
    el: h('div', { class: 'page narrow' },
      h('h1', {}, existing ? `Alter ${existing.name}` : 'Create Company'),
      h('div', { class: 'form grid-2' },
        field('Company name', els.name),
        field('Mailing name', els.mailingName, 'Printed on invoices. Defaults to the company name.'),
        field('Address', els.address),
        h('div', {},
          field('State', els.state, 'Decides CGST + SGST or IGST on invoices.'),
          field('Pincode', els.pincode)),
        field('Phone', els.phone),
        field('E-mail', els.email),
        field('GSTIN', els.gstin, 'Leave blank if not registered.'),
        h('div', {}),
        field('Financial year begins from', els.fyStart),
        field('Books beginning from', els.booksFrom,
          existing?.vouchers.length ? 'Fixed once vouchers exist.' : 'Opening balances are as on this date.')),
      h('div', { class: 'actions' },
        existing ? h('button', { class: 'danger', onclick: remove }, 'Delete company') : null,
        h('span', { class: 'spacer' }),
        h('button', { onclick: () => app.back() }, 'Cancel'),
        h('button', { class: 'primary', onclick: accept }, 'Accept (Ctrl+A)'))),
    onAccept: accept,
    isDirty: () => JSON.stringify(Object.values(els).map((e) => e.value)) !== initial,
  };
}
