// Every amount in the books is an integer number of paise, so that sums never
// pick up floating-point errors. These helpers convert at the edges.

/** Parses "1,23,456.50" or "1234.5" into paise. Returns NaN when the text is not a number. */
export function toPaise(text) {
  if (typeof text === 'number') return Math.round(text * 100);
  const cleaned = String(text ?? '').replace(/[,\s₹]/g, '');
  if (cleaned === '') return 0;
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '-' || cleaned === '.') return NaN;
  const negative = cleaned.startsWith('-');
  const [whole, fraction = ''] = cleaned.replace('-', '').split('.');
  const paise = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -paise : paise;
}

const indian = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12345650 -> "1,23,456.50". */
export function formatAmount(paise) {
  return indian.format(paise / 100);
}

/** Like formatAmount, but blank for zero, which keeps report columns readable. */
export function formatOrBlank(paise) {
  return paise ? formatAmount(paise) : '';
}

/** Amount with a Dr / Cr suffix. Positive balances are debits. */
export function formatBalance(paise) {
  if (!paise) return '0.00';
  return `${formatAmount(Math.abs(paise))} ${paise > 0 ? 'Dr' : 'Cr'}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}

function belowThousand(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? ONES[hundreds] + ' Hundred' : '', rest ? belowHundred(rest) : '']
    .filter(Boolean).join(' ');
}

/** Indian system: crore, lakh, thousand. 12345678 -> "One Crore Twenty Three Lakh ..." */
function integerInWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(integerInWords(crore) + ' Crore');
  if (lakh) parts.push(belowHundred(lakh) + ' Lakh');
  if (thousand) parts.push(belowHundred(thousand) + ' Thousand');
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/** 12345650 -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only". */
export function amountInWords(paise) {
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  let words = 'Rupees ' + integerInWords(rupees);
  if (rest) words += ' and ' + belowHundred(rest) + ' Paise';
  return words + ' Only';
}
