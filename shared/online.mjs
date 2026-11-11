// Online ordering rules, shared by the customer order page and the server (Netlify function).
// The server re-checks everything here before charging, so nothing on the customer's side can change a price or a deadline.

export const TZ = 'America/New_York';
const r2 = n => Math.round(n * 100) / 100;

// ---------- Dates in New York time ----------
// Offset (ms) of New York from UTC at a given moment.
function tzOffset(ms){
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}
// "2026-11-25" + "17:00" in New York → ms
export function nyMs(date, time = '00:00'){
  const [y, m, d] = date.split('-').map(Number); const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - tzOffset(guess - tzOffset(guess));
}
export function nyDate(ms = Date.now()){ return new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(ms)); }
export function nyTime(ms = Date.now()){ return new Intl.DateTimeFormat('en-GB', {timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(ms)); }
export function weekday(date){ const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
export function addDays(date, n){ const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayLabel = date => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'}); };
export const timeLabel = t => { const [h, m] = t.split(':').map(Number); return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString('en-US', {timeZone: 'UTC', hour: 'numeric', minute: m ? '2-digit' : undefined}); };

// ---------- Settings (menu editor → Settings → Online ordering) ----------
export function onlineSettings(settings = {}){
  const o = settings.online || {};
  return {
    asap: o.asap === true,                     // "Today, ASAP" ordering: off until the shop moves off Toast; pre-orders only
    hours: o.hours || {},                     // {3: {open:'07:00', close:'14:00'}, ...} by weekday; missing = closed
    prepMinutes: Number(o.prepMinutes ?? 15),
    asapPer15: Number(o.asapPer15 || 0),       // most ASAP online orders per 15 minutes (0 = no limit)
    lastOrderMinutes: Number(o.lastOrderMinutes ?? 15), // stop ASAP this long before closing
    daysAhead: Number(o.daysAhead ?? 21),
    deadline: o.deadline || {weekly: true, weekday: 1, time: '13:00'}, // default pre-order deadline: Monday 1pm for that week's pickups (or {daysBefore, time})
    fireLead: Number(o.fireLead ?? 30),        // pre-orders appear on the KDS this many minutes before their pickup time
    slotLimit: Number(o.slotLimit || 0),
    taxFree: o.taxFree !== false,              // pre-orders are sold tax-free
    reminderDay: o.reminderDay ?? 0, reminderTime: o.reminderTime || '18:00', // weekly pre-order reminder text       // most pre-orders per 15-minute pickup time (0 = no limit)
    closedDates: o.closedDates || [],
    pickupNote: o.pickupNote || '',
    tips: settings.tipPercents || [0.18, 0.20, 0.22],
  };
}
export function isOpenDay(date, os, settings = {}){
  if (os.closedDates.includes(date)) return false;
  const h = os.hours[weekday(date)];
  if (h) return true;
  // No hours entered yet: fall back to the shop's open days.
  return !Object.keys(os.hours).length && (settings.openDays || [3, 4, 5, 6, 0]).includes(weekday(date));
}
// Is ASAP ordering open right now? Returns {ok, reason, readyAt}
export function asapState(settings, status = {}, now = Date.now()){
  const os = onlineSettings(settings); const today = nyDate(now);
  if (!os.asap) return {ok: false, reason: 'Ordering ahead for today is off. You can still pre-order.'};
  if (status.onlinePaused) return {ok: false, reason: "We're not taking online orders for today right now. Please order at the counter."};
  if (!isOpenDay(today, os, settings)) return {ok: false, reason: "We're closed today."};
  const h = os.hours[weekday(today)];
  if (!h) return {ok: false, reason: 'Online ordering hours are not set up yet.'};
  const open = nyMs(today, h.open), last = nyMs(today, h.close) - os.lastOrderMinutes * 60000;
  if (now < open) return {ok: false, reason: `Ordering for today opens at ${timeLabel(h.open)}.`, opensAt: open};
  if (now > last) return {ok: false, reason: "We're done taking orders for today."};
  return {ok: true, readyAt: now + os.prepMinutes * 60000};
}
// Pickup days a customer can pick for pre-orders.
export function pickupDates(settings, now = Date.now()){
  const os = onlineSettings(settings); const out = []; const today = nyDate(now);
  for (let i = 0; i <= os.daysAhead; i++){ const d = addDays(today, i); if (isOpenDay(d, os, settings)) out.push(d); }
  return out;
}

// Pickup times for a pre-order day, every 15 minutes from opening to 15 minutes before close.
export function pickupSlots(settings, date){
  const os = onlineSettings(settings); const h = os.hours[weekday(date)]; if (!h || !h.open || !h.close) return [];
  const toM = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
  const out = []; for (let m = Math.ceil(toM(h.open) / 15) * 15; m <= toM(h.close) - 15; m += 15) out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
  return out;
}
// ---------- Item availability ----------
// pickup = {type:'asap'} or {type:'date', date:'YYYY-MM-DD'}
export function deadlineFor(item, date, settings){
  const os = onlineSettings(settings); const dl = item.deadline || os.deadline;
  if (dl.weekly){ // the last cutoff day (e.g. Monday) before the pickup day
    let d = addDays(date, -1); for (let i = 0; i < 7 && weekday(d) !== Number(dl.weekday ?? 1); i++) d = addDays(d, -1);
    return nyMs(d, dl.time || '13:00');
  }
  return nyMs(addDays(date, -Number(dl.daysBefore || 0)), dl.time || '23:59');
}
// Which online page an item shows on: 'asap' (today only), 'preorder' (future days only) or 'both'.
// Items not set yet: pastries, breads and bulk bagels go on both; pre-order-only items on pre-order; everything else (sandwiches, drinks) today only.
export const BOTH_CATEGORIES = ['Pastries + Breads', 'Bulk Bagels'];
export function onlineWhen(item){
  if (['asap', 'preorder', 'both'].includes(item.onlineWhen)) return item.onlineWhen;
  if (item.preorderOnly) return 'preorder';
  return BOTH_CATEGORIES.includes(item.category) ? 'both' : 'asap';
}
// Future pickup days still open for pre-orders (the shop's deadline hasn't passed), and the days already closed.
export function preorderDays(settings, now = Date.now()){
  const today = nyDate(now); const open = [], closed = [];
  for (const d of pickupDates(settings, now)){ if (d === today) continue; const dl = deadlineFor({}, d, settings); (now > dl ? closed : open).push({date: d, deadline: dl}); }
  return {open, closed};
}
export const daysFromToday = (date, now = Date.now()) => Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(nyDate(now) + 'T12:00:00Z')) / 86400000);
// Most of an item that can be pre-ordered for one pickup day. limits = menu/preorderLimits {usual: {itemId: {weekday: n}}, dates: {date: {itemId: n}}}.
// Blank means no limit. A date's own number wins over the usual number for that weekday.
export function limitFor(item, date, limits){
  const d = limits?.dates?.[date]?.[item.id]; if (d !== undefined && d !== null && d !== '') return Number(d);
  const u = limits?.usual?.[item.id]?.[weekday(date)]; if (u !== undefined && u !== null && u !== '') return Number(u);
  return null;
}
// How staff pack and label a pre-order line.
export const PACK = {bagels: 'Bagels', pastries: 'Pastries', breads: 'Breads', cafe: 'From the cafe'};
export function packAs(item){
  if (item.fromCafe) return 'cafe';
  if (PACK[item.packAs]) return item.packAs;
  if (item.category === 'Bulk Bagels') return 'bagels';
  if (/bread|sourdough|loaf|rye|focaccia|baguette|challah|ciabatta|boule|batard/i.test(item.name || '')) return 'breads';
  return 'pastries';
}
const FRIDGE_WORDS = /cream cheese|schmear|cold brew|butter|lox|spread/i;
export function lineLabels(item, line){
  const picks = [...(line.mods || []).map(m => m.o), ...(line.noMods || []).map(() => '')].join(' ');
  return {packAs: packAs(item), fromCafe: !!item.fromCafe, fridge: !!item.refrigerated || FRIDGE_WORDS.test(item.name || '') || (line.mods || []).some(m => FRIDGE_WORDS.test(m.o)),
    sliced: !!item.sliced || /\bslic/i.test(picks)};
}
export function availability(item, pickup, settings, now = Date.now(), soldOnDate = 0, limits = null){
  if (!item || item.archived || item.active === false || item.alcohol || item.visible?.online === false) return {ok: false, reason: 'Not available online'};
  const date = pickup.type === 'asap' ? nyDate(now) : pickup.date;
  const when = onlineWhen(item);
  if (pickup.type === 'asap' && when === 'preorder') return {ok: false, reason: 'Pre-order only'};
  if (pickup.type === 'date' && when === 'asap') return {ok: false, reason: 'Today only, not for pre-order'};
  if (pickup.type === 'asap'){
    if (item.eightySixed || (typeof item.stockCount === 'number' && item.stockCount <= 0)) return {ok: false, reason: 'Sold out today'};
  }
  if (Array.isArray(item.dates) && item.dates.length && !item.dates.includes(date)){
    const next = item.dates.filter(d => d >= nyDate(now)).sort()[0];
    return {ok: false, reason: next ? `Available ${dayLabel(next)}` : 'No longer available'};
  }
  if (Array.isArray(item.days) && item.days.length && !item.days.includes(weekday(date))) return {ok: false, reason: item.days.length < 7 ? [3, 4, 5, 6, 0, 1, 2].filter(d => item.days.includes(d)).map(d => DAYN[d]).join(', ') + ' only' : 'Not that day'};
  if (pickup.type === 'date' && date !== nyDate(now) || item.preorderOnly){
    const dl = deadlineFor(item, date, settings);
    if (now > dl) return {ok: false, reason: 'Order deadline has passed'};
    const lim = limitFor(item, date, limits);
    if (lim !== null && soldOnDate >= lim) return {ok: false, reason: 'Sold out for that day'};
    return {ok: true, deadline: dl, left: lim !== null ? lim - soldOnDate : null};
  }
  return {ok: true};
}

// ---------- Prices (same math as the register) ----------
export const optPrice = (o, size, temp) => { if (!o) return 0; if (o.pricing === 'bySize' && o.bySize){ const k = temp && size ? temp + ' ' + size : null; if (k && o.bySize[k] !== undefined) return Number(o.bySize[k]); if (size && o.bySize[size] !== undefined) return Number(o.bySize[size]); } return Number(o.price || 0); };
function countPrice(n, unit, tiersIn){
  const tiers = (tiersIn || []).filter(t => t.qty > 0).sort((a, b) => b.qty - a.qty);
  let left = n, price = 0; const parts = [];
  for (const t of tiers){ const k = Math.floor(left / t.qty); if (k){ price += k * Number(t.price); left -= k * t.qty; parts.push((k > 1 ? k + ' × ' : '') + (t.name || t.qty)); } }
  price += left * unit; if (left) parts.push(left + ' single' + (left > 1 ? 's' : ''));
  return {price: r2(price), parts};
}
export const versionLabel = v => { if (!v) return ''; const t = v.temp === 'hot' ? 'Hot' : v.temp === 'iced' ? 'Iced' : ''; return [t, v.size].filter(Boolean).join(' '); };
export function minFor(it, g){ const r = (it.required || {})[g.id]; return r === undefined ? (g.min || 0) : r ? Math.max(1, g.min || 1) : 0; }
// Where a modifier group shows: register, kiosk, asap (online today) and preorder (online for a future day). Unset means everywhere.
export const CHANNELS = {register: 'Register', kiosk: 'Kiosk', asap: 'Online, today', preorder: 'Online, pre-order'};
// A single choice can also be limited to some places. Older choices used hideOnline (register only).
export const optOn = (o, ch) => !ch || !o ? true : o.showOn ? o.showOn[ch] !== false : (o.hideOnline ? ch === 'register' : true);
export const groupOn = (g, ch) => !ch || !g || !g.showOn || g.showOn[ch] !== false;
// A copy of an item with only the modifier groups that show on this channel.
export function onChannel(it, groupById, ch){
  if (!it || !ch || !(it.modifierGroupIds || []).length) return it;
  const ids = it.modifierGroupIds.filter(id => groupOn(groupById(id), ch)); if (ids.length === it.modifierGroupIds.length) return it;
  return {...it, modifierGroupIds: ids, included: (it.included || []).filter(x => ids.includes(x.g))};
}
export const groupShown = (it, gid, mods) => { const w = (it.showWhen || {})[gid]; return !w || mods.some(m => m.g === w.g && m.o === w.o); };
// Builds a kitchen line from a customer's choice and checks it is a valid build. Throws a plain-English error if not.
export function buildLine(menu, d, kds = {}, channel = null){
  const it = onChannel(menu.items.find(i => i.id === d.itemId), id => menu.groups.find(g => g.id === id), channel); if (!it) throw new Error('An item in your cart is no longer on the menu.');
  const vers = it.versions || []; const vi = vers.length > 1 ? d.versionIdx : 0;
  if (vi === null || vi === undefined || !vers[vi]) throw new Error(`Pick a size for ${it.name}.`);
  const v = vers[vi]; const groups = (it.modifierGroupIds || []).map(id => menu.groups.find(g => g.id === id)).filter(Boolean);
  const mods = (d.mods || []).filter(m => groups.some(g => g.id === m.g && groupShown(it, g.id, d.mods)));
  for (const m of mods){ const g = groups.find(x => x.id === m.g); const o = g.options.find(x => x.name === m.o); if (!o || !optOn(o, channel)) throw new Error(`${m.o} isn't available for ${it.name}.`); m.q = Math.max(1, Math.min(99, Math.floor(Number(m.q || 1)))); }
  for (const g of groups){ if (!groupShown(it, g.id, mods)) continue; const n = mods.filter(m => m.g === g.id).reduce((s, m) => s + m.q, 0); if (n < minFor(it, g)) throw new Error(`Pick ${g.name.toLowerCase()} for ${it.name}.`); const cp = it.countPricing && it.countPricing.group === g.id; if (!cp && g.max && n > g.max) throw new Error(`Too many ${g.name.toLowerCase()} for ${it.name}.`); }
  let price = Number(v.price || 0); const counts = {};
  for (const c of it.counts || []) if (!c.size || c.size === v.size) counts[c.name] = (counts[c.name] || 0) + Number(c.qty || 0);
  for (const m of mods){ const g = groups.find(x => x.id === m.g); const o = g.options.find(x => x.name === m.o); price += optPrice(o, v.size, v.temp) * m.q; for (const c of o.counts || []) counts[c.name] = (counts[c.name] || 0) + Number(c.qty || 0) * m.q; }
  let countNote = '';
  const cp = it.countPricing;
  if (cp && cp.group){ const n = mods.filter(m => m.g === cp.group).reduce((s, m) => s + m.q, 0); const r = countPrice(n, Number(v.price || 0), cp.tiers); price = r.price + (price - Number(v.price || 0)); countNote = n ? `${n} total: ${r.parts.join(' + ')}` : ''; }
  const inc = it.included || [];
  const noMods = inc.filter(x => !mods.some(m => m.g === x.g && m.o === x.o)).map(x => ({g: x.g, o: x.o}));
  const rr = kds.reroute && it.station === 'espresso' && (it.reroute === 'all' || (it.reroute === 'iced' && v.temp === 'iced'));
  return {lid: Math.random().toString(36).slice(2, 10), itemId: it.id, name: it.name, station: rr ? 'none' : (it.station || 'none'), rerouted: !!rr,
    versionIdx: vi, version: vers.length > 1 ? versionLabel(v) : '',
    mods: mods.map(m => { const c = {g: m.g, o: m.o, q: m.q}; if (inc.some(x => x.g === m.g && x.o === m.o)) c.inc = true; const g = groups.find(x => x.id === m.g); if (g.default === m.o && m.q === 1) c.def = true; return c; }),
    noMods, countNote, counts, price: r2(price), taxable: !!it.taxable, done: false, doneAt: 0, changed: null, changedAt: 0, removed: false};
}
export function cartTotals(lines, settings, tipPct = 0){
  const rate = Number(settings.taxRate || 0);
  const sub = r2(lines.reduce((s, l) => s + l.price, 0));
  // Online ordering is tax-free unless settings.online.taxFree is turned off.
  const taxable = onlineSettings(settings).taxFree ? 0 : r2(lines.filter(l => l.taxable).reduce((s, l) => s + l.price, 0));
  const tax = r2(taxable * rate / (1 + rate)); // prices include tax
  const tip = r2(sub * (Number(tipPct) || 0));
  return {sub, disc: 0, taxable, tax, inTax: tax, tip, tips: tip, surcharge: 0, total: sub, charge: r2(sub + tip)};
}
