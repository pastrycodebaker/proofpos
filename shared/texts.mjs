// Contact lists (text and email) and the wording carriers and email rules require.
// Everyone lives in the rewards customer record (customers/{phone}); people with only an email get customers/e_<email>.
//   subs: {weekly_text: true, newsletter_email: true, ...}   textOk / emailOk: false once they reply STOP or unsubscribe
export const BRAND = 'Flour and Salt Bakery LLC';
export const LISTS = [
  ['weekly', 'Weekly pre-order reminder', 'Before each Monday deadline', ['text', 'email']],
  ['specials', 'Specials and new items', 'A few times a month', ['text', 'email']],
  ['closures', 'Closures and schedule changes', 'Only when we close or change hours', ['text', 'email']],
  ['newsletter', 'Newsletter', 'About once a month', ['email']],
];
export const CHANNELS = {text: 'Text', email: 'Email'};
export const subKey = (list, ch) => `${list}_${ch}`;
export const listName = id => (LISTS.find(l => l[0] === id) || [id, id])[1];
export const phone10 = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d.length === 10 ? d : ''; };
export const prettyPhone = p => { const d = phone10(p); return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || ''); };
export const cleanEmail = e => { const x = String(e || '').trim().toLowerCase(); return /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(x) ? x : ''; };
export const emailId = e => 'e_' + cleanEmail(e).replace(/[^a-z0-9@._+-]/g, '_');
export const CONSENT = `By checking this box and tapping Sign up, you agree to receive the texts and emails you picked from ${BRAND}. Texts are recurring and automated, at the mobile number above; consent is not a condition of purchase. Message frequency varies, up to about 6 texts a month. Msg & data rates may apply. Reply HELP for help or STOP to cancel texts. Every email has an unsubscribe link.`;
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
// Is this person on this list by this channel (and still allowed to get it)?
export const onList = (c, list, ch) => !!(c && c.subs && c.subs[subKey(list, ch)] && (ch === 'text' ? c.textOk !== false && c.phone : c.emailOk !== false && c.email));
