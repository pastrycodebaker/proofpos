// Online ordering: prices and checks the cart, takes payment through Stripe, and creates the order for the KDS.
// Needs these Netlify environment variables:
//   STRIPE_SECRET_KEY        (already set)
//   STRIPE_PUBLISHABLE_KEY   pk_test_… / pk_live_… from the Stripe Dashboard (safe to show customers)
//   ORDER_BOT_EMAIL, ORDER_BOT_PASSWORD   a Firebase sign-in used only by this function to write orders
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, query, where, runTransaction, setDoc, updateDoc, increment } from 'firebase/firestore';
import { buildLine, availability, asapState, cartTotals, onlineSettings, nyMs, nyDate, pickupDates, pickupSlots, preorderDays, dayLabel, timeLabel, lineLabels, limitFor } from '../../shared/online.mjs';
import { orderConfirmation } from '../../shared/notify.mjs';

const app = initializeApp({apiKey: 'AIzaSyAoAZWaLAYw0rKmgpzvYj8TMAN37YSH2UY', authDomain: 'proofpos-90500.firebaseapp.com', projectId: 'proofpos-90500'}, 'online-orders');
const db = getFirestore(app);
let signedIn = null;
const signIn = () => signedIn || (signedIn = signInWithEmailAndPassword(getAuth(app), process.env.ORDER_BOT_EMAIL, process.env.ORDER_BOT_PASSWORD).catch(e => { signedIn = null; throw new Error('Online ordering is not set up yet (order sign-in).'); }));

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
function form(obj, prefix, out = []){
  for (const [k, v] of Object.entries(obj)){ if (v === undefined || v === null) continue; const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`); }
  return out.join('&');
}
async function stripe(method, path, body){
  const r = await fetch('https://api.stripe.com/v1/' + path, {method, headers: {authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded'}, body: body ? form(body) : undefined});
  const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || 'Payment error'); return data;
}
async function loadMenu(){
  const [items, groups, main, status, kds, limits] = await Promise.all([getDocs(collection(db, 'menu', 'main', 'items')), getDocs(collection(db, 'menu', 'main', 'modifierGroups')), getDoc(doc(db, 'menu', 'main')), getDoc(doc(db, 'menu', 'status')), getDoc(doc(db, 'settings', 'kds')), getDoc(doc(db, 'menu', 'preorderLimits'))]);
  return {items: items.docs.map(d => d.data()), groups: groups.docs.map(d => d.data()), settings: main.exists() ? main.data() : {}, status: status.exists() ? status.data() : {}, kds: kds.exists() ? kds.data() : {}, limits: limits.exists() ? limits.data() : {}};
}
// How many of each item are already ordered for a pickup day (for per-day limits).
async function soldOn(date){
  const snap = await getDocs(query(collection(db, 'orders'), where('pickupDate', '==', date)));
  const n = {}; for (const d of snap.docs){ const o = d.data(); if (o.status === 'void') continue; for (const l of Object.values(o.lines || {})) if (!l.removed) n[l.itemId] = (n[l.itemId] || 0) + 1; }
  return n;
}

async function start(b){
  await signIn();
  const M = await loadMenu(); const now = Date.now();
  const cart = Array.isArray(b.cart) ? b.cart.slice(0, 60) : [];
  if (!cart.length) throw new Error('Your cart is empty.');
  const c = b.customer || {}; const name = String(c.name || '').trim().slice(0, 40), email = String(c.email || '').trim().slice(0, 120), phone = String(c.phone || '').replace(/\D/g, '').slice(-10);
  if (!name) throw new Error('Please add your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Please add an email for your receipt.');
  if (b.pickup?.type === 'date' && phone.length !== 10) throw new Error('Please add a phone number so we can reach you about your pre-order.');
  const allergySeparate = !!c.allergySeparate, allergyNote = String(c.allergyNote || '').trim().slice(0, 200), smsOptIn = !!c.smsOptIn && phone.length === 10;
  // Pickup: ASAP today, or a pre-order day
  let pickup;
  if (b.pickup?.type === 'date'){
    if (!preorderDays(M.settings, now).open.some(x => x.date === b.pickup.date)) throw new Error("Pre-orders for that day are closed. Please pick another day.");
    if (!pickupSlots(M.settings, b.pickup.date).includes(b.pickup.time)) throw new Error('Please pick a pickup time.');
    pickup = {type: 'date', date: b.pickup.date, time: b.pickup.time};
    const os = onlineSettings(M.settings);
    if (os.slotLimit){ const snap = await getDocs(query(collection(db, 'orders'), where('pickupDate', '==', pickup.date))); const n = snap.docs.filter(d => d.data().status === 'paid' && d.data().pickup?.time === pickup.time).length; if (n >= os.slotLimit) throw new Error(`${timeLabel(pickup.time)} is full. Please pick another time.`); }
  } else {
    const a = asapState(M.settings, M.status, now); if (!a.ok) throw new Error(a.reason);
    const os = onlineSettings(M.settings);
    if (os.asapPer15){ const recent = await getDocs(query(collection(db, 'orders'), where('createdAtMs', '>=', now - 15 * 60000))); const n = recent.docs.filter(d => d.data().source === 'online' && d.data().pickup?.type === 'asap').length; if (n >= os.asapPer15) throw new Error("We're very busy right now. Try again in a few minutes, or pre-order for later."); }
    pickup = {type: 'asap'};
  }
  const date = pickup.type === 'asap' ? nyDate(now) : pickup.date;
  const sold = pickup.type === 'date' ? await soldOn(date) : {};
  const lines = []; const inCart = {};
  for (const d of cart){
    const it = M.items.find(i => i.id === d.itemId);
    const av = availability(it, pickup, M.settings, now, (sold[d.itemId] || 0) + (inCart[d.itemId] || 0), M.limits);
    if (!av.ok) throw new Error(`${it ? it.name : 'An item'}: ${av.reason}.`);
    const l = buildLine(M, d, M.kds, pickup.type === 'date' ? 'preorder' : 'asap');
    if (onlineSettings(M.settings).taxFree) l.taxable = false;
    if (pickup.type === 'date'){ Object.assign(l, lineLabels(it, l)); if (!it.fromCafe) l.station = 'none'; }  // only cafe-made items go to the KDS
    lines.push(l); inCart[d.itemId] = (inCart[d.itemId] || 0) + 1;
  }
  const tipPct = Math.max(0, Math.min(0.5, Number(b.tipPct) || 0));
  const t = cartTotals(lines, M.settings, tipPct);
  if (t.charge < 0.5) throw new Error('Online orders must be at least $0.50.');
  const pi = await stripe('POST', 'payment_intents', {amount: Math.round(t.charge * 100), currency: 'usd', automatic_payment_methods: {enabled: true}, receipt_email: email,
    description: `Online order for ${name}${pickup.type === 'date' ? ' · pick up ' + dayLabel(pickup.date) + ' at ' + timeLabel(pickup.time) : ''}`, metadata: {source: 'online', pickup: pickup.type === 'date' ? pickup.date + ' ' + pickup.time : 'asap'}});
  await setDoc(doc(db, 'onlineCheckouts', pi.id), {createdAt: now, status: 'pending', pickup, name, email, phone, lines, totals: t, tipPct, allergySeparate, allergyNote, smsOptIn, smsOptInAt: smsOptIn ? now : null});
  return {clientSecret: pi.client_secret, paymentIntent: pi.id, totals: t, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY};
}

// Creates the order once Stripe says it's paid. Safe to call more than once (the order id is the payment id).
export async function finish(paymentIntent){
  await signIn();
  const pi = await stripe('GET', `payment_intents/${paymentIntent}?expand[]=latest_charge`);
  if (pi.status !== 'succeeded') return {paid: false, status: pi.status};
  const coRef = doc(db, 'onlineCheckouts', pi.id), orderRef = doc(db, 'orders', 'web_' + pi.id);
  const M = await loadMenu(); const os = onlineSettings(M.settings);
  const result = await runTransaction(db, async tx => {
    const [co, existing] = [await tx.get(coRef), await tx.get(orderRef)];
    if (existing.exists()) return {num: existing.data().num, readyAt: existing.data().readyAt, pickup: existing.data().pickup, already: true};
    if (!co.exists()) throw new Error('Order details not found.');
    const c = co.data(); const now = Date.now();
    const pre = c.pickup.type === 'date' && c.pickup.date !== nyDate(now);
    // Pre-orders get their own running numbers (1001, 1002…) so they never clash with the day's shop numbers.
    const counter = doc(db, 'counters', pre ? 'preorders' : 'orders-' + nyDate(now)); const cs = await tx.get(counter); const num = cs.exists() ? cs.data().next : (pre ? 1001 : 101);
    const at = pre && c.pickup.time ? nyMs(c.pickup.date, c.pickup.time) : null;
    const fireAtMs = pre ? (at ? at - os.fireLead * 60000 : nyMs(c.pickup.date, '06:00')) : now;
    const readyAt = pre ? at : now + os.prepMinutes * 60000;
    const card = pi.latest_charge?.payment_method_details?.card || {};
    const pay = {method: 'card', label: `${card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : 'Card'} ${card.funding || ''} ••${card.last4 || ''}`.replace(/\s+/g, ' ').trim(), amount: c.totals.sub, tip: c.totals.tip, surcharge: 0, charged: pi.amount / 100, funding: card.funding || null, paymentIntent: pi.id, at: now, staff: 'Online'};
    tx.set(counter, {next: num + 1});
    tx.set(orderRef, {num, name: c.name, email: c.email, phone: c.phone || null, source: 'online', status: 'paid', staff: 'Online', rush: false, cleared: false, clearedAt: 0,
      scheduled: pre, createdAtMs: now, fireAtMs, readyAt, pickup: c.pickup, pickupDate: c.pickup.type === 'date' ? c.pickup.date : nyDate(now), pickupTime: c.pickup.time || null,
      lines: Object.fromEntries(c.lines.map((l, i) => [l.lid, {...l, pos: i}])), payments: [pay], totals: c.totals, paidAt: now, taxExempt: false, discount: null,
      special: pre, smsOptIn: !!c.smsOptIn, smsOptInAt: c.smsOptInAt || null, allergySeparate: !!c.allergySeparate, allergyNote: c.allergyNote || '', packed: {}, pickedUp: false, reminderSent: false,
      ...(c.phone ? {customerPhone: c.phone, customerName: c.name, pointsEarned: Math.floor(c.totals.total), pointsUsed: 0} : {})});
    tx.update(coRef, {status: 'done', orderId: orderRef.id});
    return {num, readyAt, pickup: c.pickup, lines: c.lines, phone: c.phone, name: c.name, email: c.email, totals: c.totals, total: c.totals.total, pre, allergySeparate: c.allergySeparate, allergyNote: c.allergyNote, smsOptIn: !!c.smsOptIn};
  });
  if (!result.already){
    // Same-day orders count down stock; rewards points for customers who gave a phone number.
    if (!result.pre) for (const l of result.lines){ const it = M.items.find(i => i.id === l.itemId); if (it && typeof it.stockCount === 'number') await updateDoc(doc(db, 'menu', 'main', 'items', it.id), {stockCount: increment(-1), ...(it.stockCount - 1 <= 0 ? {eightySixed: true} : {})}).catch(() => {}); }
    await orderConfirmation({...result, lines: Object.fromEntries(result.lines.map((l, i) => [l.lid, {...l, pos: i}]))}).catch(e => console.error(e));
    if (result.phone) await setDoc(doc(db, 'customers', result.phone), {phone: result.phone, name: result.name, points: increment(Math.floor(result.total)), visits: increment(1), lastVisit: Date.now()}, {merge: true}).catch(() => {});
  }
  return {paid: true, num: result.num, readyAt: result.readyAt, pickup: result.pickup};
}

// Pre-order counts for the Proof Box production planner: items and choices per pickup day. No customer details.
async function production(from, to){
  await signIn();
  const snap = await getDocs(query(collection(db, 'orders'), where('pickupDate', '>=', from), where('pickupDate', '<=', to)));
  const sums = {};
  for (const d of snap.docs){
    const o = d.data(); if (!(o.special || o.pickup?.type === 'date') || o.importedFrom || o.status === 'void' || o.cancelled) continue;  // Hot Plate imports are already in the planner's own Hot Plate import
    for (const l of Object.values(o.lines || {})){
      if (l.removed) continue;
      const name = [l.version, l.name].filter(Boolean).join(' ');
      const mods = (l.mods || []).filter(m => !m.def && !m.inc).map(m => (m.q || 1) + 'X ' + String(m.o).toUpperCase()).join(' • ');
      const k = o.pickupDate + '|' + name + '|' + mods; sums[k] = (sums[k] || 0) + 1;
    }
  }
  return Object.entries(sums).map(([k, qty]) => { const [date, name, mods] = k.split('|'); return {date, name, mods, qty}; });
}

export default async (req) => {
  if (req.method === 'GET'){
    const u = new URL(req.url); const cors = {'access-control-allow-origin': '*', 'content-type': 'application/json', 'cache-control': 'no-store'};
    if (u.searchParams.get('action') !== 'production') return new Response('{"error":"Unknown action"}', {status: 400, headers: cors});
    const from = u.searchParams.get('from') || '', to = u.searchParams.get('to') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new Response('{"error":"Bad dates"}', {status: 400, headers: cors});
    try { return new Response(JSON.stringify({lines: await production(from, to)}), {headers: cors}); }
    catch (e){ return new Response(JSON.stringify({error: e.message}), {status: 400, headers: cors}); }
  }
  if (req.method !== 'POST') return json(405, {error: 'POST only'});
  let b; try { b = await req.json(); } catch { return json(400, {error: 'Bad request'}); }
  try {
    if (b.action === 'config') return json(200, {publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null, ready: !!(process.env.STRIPE_PUBLISHABLE_KEY && process.env.ORDER_BOT_EMAIL)});
    if (b.action === 'start') return json(200, await start(b));
    if (b.action === 'counts'){ // how many are left of each limited item for a pickup day (no customer details)
      await signIn(); const date = String(b.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, {error: 'Bad date'});
      const [M, sold] = [await loadMenu(), await soldOn(date)]; const left = {};
      for (const it of M.items){ const lim = limitFor(it, date, M.limits); if (lim !== null) left[it.id] = Math.max(0, lim - (sold[it.id] || 0)); }
      return json(200, {left});
    }
    if (b.action === 'finish') return json(200, await finish(String(b.paymentIntent || '')));
    return json(400, {error: 'Unknown action'});
  } catch (e){ console.error(e); return json(400, {error: e.message}); }
};
