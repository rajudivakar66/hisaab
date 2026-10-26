// Indian states and union territories with their GST state codes.
export const STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
  ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'],
  ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
].map(([code, name]) => ({ code, name }));

/** The state a GSTIN belongs to: its first two digits are the state code. */
export function stateFromGstin(gstin) {
  const code = String(gstin || '').slice(0, 2);
  return STATES.find((s) => s.code === code)?.name || '';
}

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(gstin) {
  return GSTIN.test(String(gstin || '').toUpperCase());
}
