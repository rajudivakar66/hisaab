# Hisaab

Double-entry accounting with GST for Indian businesses. A Windows desktop app that works offline and keeps your books on your own computer.

It works the way Tally users expect: a Gateway menu, F-key vouchers, Enter to move between fields and Ctrl+A to accept. It is independent software and is not affiliated with Tally Solutions.

## Features

- **Companies:** several companies, each with its GSTIN, state and financial year (April to March by default).
- **Chart of accounts:** the 28 standard groups (Sundry Debtors, Bank Accounts, Duties & Taxes and so on), your own sub-groups, and ledgers with opening balances.
- **Vouchers:** Contra (F4), Payment (F5), Receipt (F6), Journal (F7), Sales (F8), Purchase (F9), Credit Note (Ctrl+F8) and Debit Note (Ctrl+F9). Every voucher must balance.
- **GST invoices:** items with HSN/SAC, quantity, rate and GST rate. CGST + SGST within the state, IGST outside it, rounded to the rupee. Item names are remembered with their last rate.
- **Reports:** Day Book, Ledger, Trial Balance, Profit & Loss A/c (with trading account), Balance Sheet, Group Summary and GST Summary with outward and inward registers. Click any line to drill down to the voucher.
- **Printing:** A4 tax invoices and reports. Print, save as PDF, or export reports to CSV for Excel.
- **Safety:** every change is saved at once. The previous save is kept as a `.bak` file, and you can back up and restore all companies.

## Install

1. Open the latest run under **Actions** → **Build Windows app**.
2. Download the **Hisaab-Windows** artifact and unzip it.
3. Run `Hisaab-Setup-1.0.0.exe` to install it, or `Hisaab-Portable-1.0.0.exe` to run it without installing.

The app is not code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.

## Keys

| Key            | Does                                        |
| -------------- | ------------------------------------------- |
| F4 – F9        | Contra, Payment, Receipt, Journal, Sales, Purchase |
| Ctrl+F8 / F9   | Credit Note / Debit Note                    |
| F2             | Change the current date                     |
| Enter          | Next field                                  |
| Ctrl+A         | Accept (save)                               |
| Esc            | Back                                        |
| Alt+C          | Create a ledger while entering a voucher    |
| Alt+D          | Delete the voucher being altered            |
| Ctrl+P         | Save the invoice and print it               |
| Alt+P / Alt+E  | Print / export a report to CSV              |
| Alt+S          | Save a report or invoice as PDF             |

On the Gateway, press the underlined letter of a menu item.

## Where your data is

`%APPDATA%\Hisaab\hisaab-data.json`. The company list screen shows the folder and opens it. Copy it, or use **Backup all companies**, to keep a copy on a pen drive or in a cloud folder.

## Not included yet

- Inventory (stock items, godowns, batches). Stock is handled the simple way: enter the closing stock value on a Stock-in-Hand ledger.
- E-invoicing (IRN), e-way bills and GSTR JSON files. The GST Summary helps prepare returns but does not file them.
- Bank reconciliation, cost centres, multi-currency, TDS and payroll.
- Several people using the same books over a network.

## Development

```
npm install
npm start        # run the app
npm test         # accounting engine tests
npm run dist:win # build the Windows installer (on Windows)
```

The accounting engine is in `src/renderer/core/` and has no user-interface code, so it can be tested on its own. The screens are in `src/renderer/ui/`, and `src/main.js` is the Electron main process.
