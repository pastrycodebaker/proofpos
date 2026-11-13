// Emails (Resend) and texts (Twilio) for online orders. Each one is skipped quietly until its keys are set in Netlify:
//   RESEND_API_KEY, MAIL_FROM (e.g. "Flour & Salt <orders@flourandsalt.com>", on the domain verified in Resend), REPLY_TO (where customer replies go), OWNER_EMAIL
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (the registered texting number)
import { dayLabel, timeLabel } from './online.mjs';

const money = n => '$' + (Number(n) || 0).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
export const canEmail = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
export const canText = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

export async function sendEmail(to, subject, html, text){
  if (!canEmail() || !to) return {skipped: true};
  const r = await fetch('https://api.resend.com/emails', {method: 'POST', headers: {authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json'},
    body: JSON.stringify({from: process.env.MAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html, text, ...(process.env.REPLY_TO ? {reply_to: process.env.REPLY_TO} : {})})});
  if (!r.ok) console.error('email failed', r.status, await r.text().catch(() => ''));
  return {ok: r.ok};
}
export async function sendText(to, body){
  const n = String(to || '').replace(/\D/g, '').slice(-10);
  if (!canText() || n.length !== 10) return {skipped: true};
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {method: 'POST',
    headers: {authorization: 'Basic ' + Buffer.from(sid + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64'), 'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({To: '+1' + n, From: process.env.TWILIO_FROM, Body: body})});
  if (r.ok) return {ok: true};
  const err = await r.json().catch(() => ({}));
  console.error('text failed', r.status, err.code, err.message);
  return {ok: false, code: err.code, message: err.message}; // 21610 = they replied STOP
}

const lineText = l => [l.version, l.name].filter(Boolean).join(' ') + (() => { const m = [...(l.noMods || []).map(x => 'No ' + x.o), ...(l.mods || []).filter(x => !x.def && !x.inc).map(x => (x.q > 1 ? x.q + '× ' : '') + x.o)]; return m.length ? ' (' + m.join(', ') + ')' : ''; })();
const whenText = o => o.pickup?.type === 'date' ? `${dayLabel(o.pickup.date)} at ${timeLabel(o.pickup.time)}` : 'today';

// Customer confirmation: email with every item, plus a short text.
export async function orderConfirmation(o){
  const lines = Object.values(o.lines || {}).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  const grouped = []; for (const l of lines){ const g = grouped.find(x => lineText(x.l) === lineText(l) && x.l.price === l.price); if (g) g.n++; else grouped.push({l, n: 1}); }
  const rows = grouped.map(({l, n}) => `<tr><td style="padding:6px 0">${n > 1 ? n + '× ' : ''}${esc(lineText(l))}</td><td style="padding:6px 0;text-align:right">${money(l.price * n)}</td></tr>`).join('');
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:auto;color:#2B2622">
    <h1 style="font-size:26px;margin:0 0 4px">Thanks, ${esc((o.name || '').split(' ')[0])}!</h1>
    <p style="font-size:17px;margin:0 0 16px">Your order <b>#${esc(o.num)}</b> is set for pickup <b>${esc(whenText(o))}</b> at 37 Lebanon Street, Hamilton.</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px">${rows}
    ${o.totals?.tip ? `<tr><td style="padding:6px 0">Tip</td><td style="text-align:right">${money(o.totals.tip)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;border-top:1px solid #ddd"><b>Total paid</b></td><td style="text-align:right;border-top:1px solid #ddd"><b>${money(o.totals?.charge)}</b></td></tr></table>
    ${o.allergySeparate ? `<p style="font-size:14px">We'll pack your items separately${o.allergyNote ? ': ' + esc(o.allergyNote) : ''}.</p>` : ''}
    <p style="font-size:14px;color:#6B6157">Give your name at the counter. Questions? Reply to this email.</p></div>`;
  const text = `Thanks, ${o.name}! Order #${o.num} is set for pickup ${whenText(o)} at 37 Lebanon Street.\n\n${grouped.map(({l, n}) => '- ' + (n > 1 ? n + '× ' : '') + lineText(l) + ' ' + money(l.price * n)).join('\n')}\n\nTotal paid ${money(o.totals?.charge)}`;
  await Promise.all([
    sendEmail(o.email, `Your Flour & Salt order #${o.num} · pickup ${whenText(o)}`, html, text),
    o.smsOptIn ? sendText(o.phone, `Flour and Salt Bakery LLC: thanks ${(o.name || '').split(' ')[0]}! Order #${o.num} is set for pickup ${whenText(o)}. We'll text when it's time to pick up. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`) : null]);
}
export const pickupReminder = o => !o.smsOptIn ? null : sendText(o.phone, `Flour & Salt: your order #${o.num} is ready for pickup at ${timeLabel(o.pickup?.time || '')} today at 37 Lebanon Street. See you soon!`);
export const ownerNotice = (subject, text) => sendEmail(process.env.OWNER_EMAIL || 'hello@flourandsalt.com', subject, `<pre style="font:15px Helvetica,Arial,sans-serif;white-space:pre-wrap">${esc(text)}</pre>`, text);
