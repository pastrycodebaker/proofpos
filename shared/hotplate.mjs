// Reads a Hot Plate orders export (CSV) into special orders for the Special orders page.
// One row per order; fixed columns first (order number, customer, pickup date and time, money), then one column per item holding the quantity.
import { lineLabels } from './online.mjs';

export function parseCsv(text){
  const rows = []; let row = [], cur = '', q = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){ if (ch === '"'){ if (text[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ','){ row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r'){ if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some(x => x !== '')) rows.push(row);
  return rows;
}
const FIXED_END = ['Fulfillment zip', 'Chef Hotplate fee'];
const META = /order|customer|name|email|phone|date|time|status|payment|subtotal|total|tip|fee|tax|discount|refund|balance|note|address|city|state|zip|fulfil|source|gift|loyalty|revenue|amount|method|type|id$/i;
export function isoDate(d){
  d = String(d || '').trim(); let m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m){ const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  m = d.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : '';
}
// "9:30 AM", "09:30", "9:30 AM - 10:00 AM" → "09:30" (the start of a window)
export function hhmm(t){
  const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/); if (!m) return '';
  let h = Number(m[1]); const ap = (m[3] || '').toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + m[2];
}
const norm = s => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Best menu item for a Hot Plate item name: exact, then by shared words.
export function matchItem(name, items){
  const n = norm(name); if (!n) return null;
  const exact = items.find(i => norm(i.name) === n); if (exact) return exact;
  const a = new Set(n.split(' ')); let best = null, bs = 0;
  for (const i of items){ const b = new Set(norm(i.name).split(' ')); let inter = 0; a.forEach(t => { if (b.has(t)) inter++; }); const sc = inter / (a.size + b.size - inter); if (sc > bs){ bs = sc; best = i; } }
  return bs >= 0.5 ? best : null;
}
export function readOrders(text, items = []){
  const rows = parseCsv(text); if (rows.length < 2) throw new Error('That file looks empty.');
  const h = rows[0].map(x => String(x).trim()); const find = re => h.findIndex(x => re.test(x));
  const iNum = find(/^order (number|#|id)$/i), iDate = find(/date fulfilled|pickup date|fulfillment date/i), iTime = find(/time fulfilled|pickup time|fulfillment time|window/i);
  const iName = find(/^customer name$|^name$/i), iFirst = find(/first name/i), iLast = find(/last name/i);
  const iPhone = find(/phone/i), iEmail = find(/email/i), iNote = find(/note|instruction|comment/i), iStatus = find(/^status$|order status/i);
  if (iNum < 0 || iDate < 0) throw new Error("This doesn't look like a Hot Plate orders export (no order number or pickup date column).");
  let end = -1; FIXED_END.forEach(k => { const i = h.indexOf(k); if (i > end) end = i; });
  const cols = h.map((name, i) => ({name, i})).filter(c => c.name && (end >= 0 ? c.i > end : !META.test(c.name) && rows.slice(1).some(r => /^\d+(\.\d+)?$/.test(String(r[c.i] || '').trim()))));
  const orders = [];
  for (const r of rows.slice(1)){
    const num = String(r[iNum] || '').trim(); if (!num) continue;
    if (iStatus >= 0 && /cancel|refund/i.test(r[iStatus] || '')) continue;
    const name = iName >= 0 ? String(r[iName] || '').trim() : [r[iFirst], r[iLast]].filter(Boolean).join(' ').trim();
    const lines = [];
    for (const c of cols){
      const q = parseFloat(r[c.i]); if (!(q > 0)) continue;
      const it = matchItem(c.name, items);
      for (let k = 0; k < Math.min(Math.round(q), 200); k++){
        const l = {lid: `hp${num}_${c.i}_${k}`, itemId: it ? it.id : null, name: c.name, price: 0, mods: [], noMods: [], station: 'none', removed: false, pos: lines.length};
        Object.assign(l, lineLabels(it || {name: c.name, category: /bagel/i.test(c.name) && /dozen/i.test(c.name) ? 'Bulk Bagels' : ''}, l));
        lines.push(l);
      }
    }
    orders.push({num, name: name || 'Hot Plate order', phone: iPhone >= 0 ? String(r[iPhone] || '').replace(/\D/g, '').slice(-10) : '', email: iEmail >= 0 ? String(r[iEmail] || '').trim() : '',
      date: isoDate(r[iDate]), time: iTime >= 0 ? hhmm(r[iTime]) : '', note: iNote >= 0 ? String(r[iNote] || '').trim() : '', lines});
  }
  const unmatched = [...new Set(orders.flatMap(o => o.lines.filter(l => !l.itemId).map(l => l.name)))];
  return {orders, columns: cols.map(c => c.name), unmatched};
}
// The order document saved for a Hot Plate order. Prices stay on Hot Plate, so it never counts in Proof POS sales.
export function toOrderDoc(o, nyMs){
  return {num: 'HP' + o.num, name: o.name, phone: o.phone, email: o.email, source: 'hotplate', importedFrom: 'hotplate', special: true, status: 'paid', staff: 'Hot Plate',
    pickup: {type: 'date', date: o.date, time: o.time}, pickupDate: o.date, pickupTime: o.time || null, readyAt: o.time ? nyMs(o.date, o.time) : null,
    allergySeparate: /allerg|separate/i.test(o.note), allergyNote: o.note, lines: Object.fromEntries(o.lines.map(l => [l.lid, l])),
    payments: [{method: 'hotplate', label: 'Paid on Hot Plate', amount: 0}], totals: {sub: 0, charge: 0, total: 0}};
}
