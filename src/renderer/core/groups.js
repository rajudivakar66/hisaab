// The standard chart of account groups used by Indian accounting software:
// 15 primary groups and 13 sub-groups.
//
// nature:      asset | liability | income | expense
// grossProfit: income and expense groups that belong in the trading account
//              (above gross profit) rather than the profit and loss account.

export const DEFAULT_GROUPS = [
  // Primary groups
  { id: 'branch', name: 'Branch / Divisions', parent: null, nature: 'liability' },
  { id: 'capital', name: 'Capital Account', parent: null, nature: 'liability' },
  { id: 'current-assets', name: 'Current Assets', parent: null, nature: 'asset' },
  { id: 'current-liabilities', name: 'Current Liabilities', parent: null, nature: 'liability' },
  { id: 'direct-expenses', name: 'Direct Expenses', parent: null, nature: 'expense', grossProfit: true },
  { id: 'direct-incomes', name: 'Direct Incomes', parent: null, nature: 'income', grossProfit: true },
  { id: 'fixed-assets', name: 'Fixed Assets', parent: null, nature: 'asset' },
  { id: 'indirect-expenses', name: 'Indirect Expenses', parent: null, nature: 'expense' },
  { id: 'indirect-incomes', name: 'Indirect Incomes', parent: null, nature: 'income' },
  { id: 'investments', name: 'Investments', parent: null, nature: 'asset' },
  { id: 'loans', name: 'Loans (Liability)', parent: null, nature: 'liability' },
  { id: 'misc-expenses', name: 'Misc. Expenses (ASSET)', parent: null, nature: 'asset' },
  { id: 'purchase', name: 'Purchase Accounts', parent: null, nature: 'expense', grossProfit: true },
  { id: 'sales', name: 'Sales Accounts', parent: null, nature: 'income', grossProfit: true },
  { id: 'suspense', name: 'Suspense A/c', parent: null, nature: 'liability' },

  // Sub-groups
  { id: 'bank', name: 'Bank Accounts', parent: 'current-assets' },
  { id: 'bank-od', name: 'Bank OD A/c', parent: 'loans' },
  { id: 'cash', name: 'Cash-in-Hand', parent: 'current-assets' },
  { id: 'deposits', name: 'Deposits (Asset)', parent: 'current-assets' },
  { id: 'duties', name: 'Duties & Taxes', parent: 'current-liabilities' },
  { id: 'loans-advances', name: 'Loans & Advances (Asset)', parent: 'current-assets' },
  { id: 'provisions', name: 'Provisions', parent: 'current-liabilities' },
  { id: 'reserves', name: 'Reserves & Surplus', parent: 'capital' },
  { id: 'secured-loans', name: 'Secured Loans', parent: 'loans' },
  { id: 'stock', name: 'Stock-in-Hand', parent: 'current-assets' },
  { id: 'creditors', name: 'Sundry Creditors', parent: 'current-liabilities' },
  { id: 'debtors', name: 'Sundry Debtors', parent: 'current-assets' },
  { id: 'unsecured-loans', name: 'Unsecured Loans', parent: 'loans' },
].map((g) => ({ ...g, system: true }));
