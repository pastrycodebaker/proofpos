// Rewards points expiration: points expire after a stretch with no visit. Any visit keeps all of a person's points.
// Everyone's clock starts no earlier than the launch date, so points brought over from Toast get a fresh start.
import { nyDate, addDays } from './online.mjs';

export const REWARD = {points: 150, amount: 3};
export const EXPIRY_DEFAULTS = {on: true, months: 6, warnDays: 30, launch: '2027-01-08', dailyEmails: 50};
export const expirySettings = raw => ({...EXPIRY_DEFAULTS, ...(raw || {})});

export function addMonths(date, n){
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate(); // Aug 31 + 6 months = Feb 28, not Mar 3
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

// The day the clock started: their last visit, but never before launch.
export const clockStart = (c, s) => { const v = c.lastVisit ? nyDate(c.lastVisit) : ''; return v > s.launch ? v : s.launch; };

// When this person's points expire (YYYY-MM-DD), or '' if they have none or expiration is off.
// Someone with an email is never expired before their warning has had its full notice period.
export function expiresOn(c, settings, today = nyDate()){
  const s = expirySettings(settings);
  if (!s.on || !((c.points || 0) > 0)) return '';
  const rule = addMonths(clockStart(c, s), s.months);
  const warned = c.expiryWarnedFor === rule && c.expiryWarnedAt ? addDays(nyDate(c.expiryWarnedAt), s.warnDays) : '';
  if (canWarn(c) && !warned) return rule < addDays(today, s.warnDays) ? addDays(today, s.warnDays) : rule; // still waiting on a warning
  return warned > rule ? warned : rule;
}
export const ruleDate = (c, settings) => { const s = expirySettings(settings); return addMonths(clockStart(c, s), s.months); };
export const canWarn = c => !!(c.email && /@/.test(c.email) && c.emailOk !== false && !c.rewardEmailBad);
// Due a warning today: has an email, has points, rule date is within the warning window, not yet warned for this date.
export function needsWarning(c, settings, today = nyDate()){
  const s = expirySettings(settings);
  if (!s.on || !((c.points || 0) > 0) || !canWarn(c)) return false;
  const rule = ruleDate(c, s);
  return addDays(rule, -s.warnDays) <= today && c.expiryWarnedFor !== rule;
}
export const isExpired = (c, settings, today = nyDate()) => { const e = expiresOn(c, settings, today); return !!e && e <= today; };

export const niceDate = date => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric'}); };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));

// The warning email.
export function warningEmail(c, date, months = EXPIRY_DEFAULTS.months){
  const first = (c.name || '').trim().split(/\s+/)[0];
  const pts = c.points || 0, rewards = Math.floor(pts / REWARD.points);
  const worth = rewards ? ` That's ${rewards === 1 ? `$${REWARD.amount} off` : `${rewards} rewards ($${rewards * REWARD.amount} off)`} waiting for you.` : '';
  const subject = `Your ${pts} Flour & Salt points expire ${niceDate(date)}`;
  const text = `Hi${first ? ' ' + first : ''},\n\nYou have ${pts} rewards points at Flour & Salt.${worth} Points expire after ${months} months without a visit, and yours expire on ${niceDate(date)}.\n\nAny purchase before then keeps all of your points. Just give us your phone number at the register.\n\nSee you soon,\nFlour & Salt Bakery and Cafe\n37 Lebanon Street\n\nYou're getting this because you have a Flour & Salt rewards account.`;
  const html = `<div style="font:16px/1.5 Helvetica,Arial,sans-serif;color:#222;max-width:520px;margin:0 auto;padding:24px">
<p>Hi${first ? ' ' + esc(first) : ''},</p>
<p style="font-size:22px;font-weight:700;margin:18px 0">You have ${pts} points.</p>
<p>${worth ? esc(worth.trim()) + ' ' : ''}Points expire after ${months} months without a visit, and yours expire on <b>${esc(niceDate(date))}</b>.</p>
<p>Any purchase before then keeps all of your points. Just give us your phone number at the register.</p>
<p>See you soon,<br>Flour &amp; Salt Bakery and Cafe<br>37 Lebanon Street</p>
<p style="color:#888;font-size:13px;margin-top:28px">You're getting this because you have a Flour &amp; Salt rewards account.</p></div>`;
  return {subject, html, text};
}
