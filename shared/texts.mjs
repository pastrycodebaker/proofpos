// Text lists customers can sign up for, and the wording carriers require.
export const BRAND = 'Flour and Salt Bakery LLC';
export const LISTS = [
  ['weekly', 'Weekly pre-order reminder', 'Sunday evening, before the Monday deadline'],
  ['specials', 'Specials and new items', 'A few times a month'],
  ['closures', 'Closures and schedule changes', 'Only when we close or change hours'],
];
export const listName = id => (LISTS.find(l => l[0] === id) || [id, id])[1];
export const phone10 = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d.length === 10 ? d : ''; };
export const prettyPhone = p => { const d = phone10(p); return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p; };
export const CONSENT = `By checking a box and tapping Sign up, you agree to receive recurring automated text messages from ${BRAND} at the number above about the lists you chose. Consent is not a condition of purchase. Message frequency varies, up to about 6 a month. Msg & data rates may apply. Reply HELP for help or STOP to cancel.`;
// Every list text starts with the business name and ends with how to opt out.
export function finalText(body){
  let t = String(body || '').trim();
  if (!t.toLowerCase().startsWith(BRAND.toLowerCase())) t = `${BRAND}: ${t}`;
  if (!/\bstop\b/i.test(t)) t += (/[.!?]$/.test(t) ? '' : '.') + ' Reply STOP to opt out.';
  return t;
}
export const segments = t => { const gsm = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅå_ÆæßÉ¡ÄÖÑÜ§¿äöñüà€]*$/.test(t); const per = gsm ? 160 : 70, multi = gsm ? 153 : 67; return t.length <= per ? 1 : Math.ceil(t.length / multi); };
export const DEFAULT_WEEKLY = 'Pre-orders for this week close {deadline}. Order at order.flourandsalt.com';
export function textSettings(s = {}){ return {weeklyOn: s.weeklyOn !== false, weeklyText: s.weeklyText || DEFAULT_WEEKLY, weeklyTime: s.weeklyTime || '18:00', skipDate: s.skipDate || null, lastWeekly: s.lastWeekly || null}; }
