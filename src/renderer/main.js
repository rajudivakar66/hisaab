import { app } from './ui/app.js';
import { companyForm, companyList } from './ui/company.js';
import { gateway } from './ui/gateway.js';
import { invoiceScreen } from './ui/invoice.js';
import { ledgerStatementScreen } from './ui/reports.js';
import { voucherScreen } from './ui/voucher.js';

// Screens that other modules open by name, which avoids circular imports.
app.start({
  companyList,
  companyForm,
  gateway,
  voucher: voucherScreen,
  invoice: invoiceScreen,
  ledgerStatement: (ledgerId) => ledgerStatementScreen({ ledgerId }),
});
