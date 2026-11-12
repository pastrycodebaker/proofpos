// Runs every 10 minutes: takes the money on held card payments the tablets haven't captured yet.
// Normally the KDS captures when an order is bumped or cleared; this catches orders nobody bumped (after 6 hours) and
// any capture a tablet missed (offline). Card holds last at least two days, so nothing expires first.
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';
import { readyToCapture, captureHolds } from '../../shared/holds.mjs';

const app = initializeApp({apiKey: 'AIzaSyAoAZWaLAYw0rKmgpzvYj8TMAN37YSH2UY', authDomain: 'proofpos-90500.firebaseapp.com', projectId: 'proofpos-90500'}, 'holds');
const db = getFirestore(app);
const SIX_HOURS = 6 * 3600 * 1000;

async function stripe(method, path, body){
  const r = await fetch('https://api.stripe.com/v1/' + path, {method, headers: {authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded'}, body: body ? new URLSearchParams(body).toString() : undefined});
  const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || 'Stripe error'); return data;
}
const PAY = {async capture(id){
  const pi = await stripe('GET', 'payment_intents/' + id);
  if (pi.status === 'succeeded') return {amount: pi.amount_received / 100};
  if (pi.status !== 'requires_capture') return {};
  const target = pi.metadata?.capture_amount ? Number(pi.metadata.capture_amount) : pi.amount_capturable;
  if (target <= 0){ await stripe('POST', `payment_intents/${id}/cancel`); return {amount: 0}; }
  const c = await stripe('POST', `payment_intents/${id}/capture`, {amount_to_capture: String(Math.min(target, pi.amount_capturable))});
  return {amount: c.amount_received / 100};
}};

export default async () => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.ORDER_BOT_EMAIL) return new Response('not set up');
  await signInWithEmailAndPassword(getAuth(app), process.env.ORDER_BOT_EMAIL, process.env.ORDER_BOT_PASSWORD);
  const snap = await getDocs(query(collection(db, 'orders'), where('cardHold', '==', true)));
  let n = 0;
  for (const d of snap.docs){
    const o = d.data();
    if (!readyToCapture(o) && Date.now() - (o.paidAt || o.createdAtMs || 0) < SIX_HOURS) continue;
    try { await captureHolds(o, PAY, f => updateDoc(doc(db, 'orders', d.id), f)); n++; } catch (e){ console.error(d.id, e.message); }
  }
  return new Response('captured ' + n);
};
export const config = {schedule: '*/10 * * * *'};
