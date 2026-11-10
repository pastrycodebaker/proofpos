// Proof POS payments: talks to Stripe Terminal for the register and kiosk.
// The Stripe key lives only here (Netlify env STRIPE_SECRET_KEY). Only signed-in Proof POS tablets can call this.
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PROJECT = 'proofpos-90500';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const SURCHARGE_RATE = 0.03;           // credit cards only
const FEE_PCT = 0.027, FEE_FIXED = 5;  // Stripe in-person fee: the surcharge never goes above it
const TIP_PERCENTS = [18, 20, 22];

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
function form(obj, prefix, out = []){
  for (const [k, v] of Object.entries(obj)){
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'object' ? form(x, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(key)}[${i}]=${encodeURIComponent(x)}`));
    else if (typeof v === 'object') form(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}
async function stripe(method, path, body){
  const r = await fetch('https://api.stripe.com/v1/' + path, {method, headers: {authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded'}, body: body ? form(body) : undefined});
  const data = await r.json();
  if (!r.ok){ const e = new Error(data.error?.message || 'Stripe error'); e.code = data.error?.code; throw e; }
  return data;
}
const surchargeFor = (amount, funding) => funding === 'credit' ? Math.min(Math.round(amount * SURCHARGE_RATE), Math.round(amount * FEE_PCT) + FEE_FIXED) : 0;

async function setup(){
  // One location for the cafe, with 18/20/22% tipping on the reader screen.
  let loc = (await stripe('GET', 'terminal/locations?limit=10')).data.find(l => l.metadata?.proofpos === 'cafe');
  if (!loc){
    let cfg = (await stripe('GET', 'terminal/configurations?limit=20')).data.find(c => c.name === 'Proof POS');
    if (!cfg) cfg = await stripe('POST', 'terminal/configurations', {name: 'Proof POS', tipping: {usd: {percentages: TIP_PERCENTS}}});
    loc = await stripe('POST', 'terminal/locations', {display_name: 'Flour & Salt', address: {line1: '37 Lebanon Street', city: 'Hamilton', state: 'NY', postal_code: '13346', country: 'US'}, configuration_overrides: cfg.id, metadata: {proofpos: 'cafe'}});
  }
  let readers = (await stripe('GET', `terminal/readers?location=${loc.id}&limit=20`)).data;
  const testMode = (process.env.STRIPE_SECRET_KEY || '').includes('_test_');
  if (!readers.length && testMode) readers = [await stripe('POST', 'terminal/readers', {registration_code: 'simulated-s700', label: 'Test reader (simulated)', location: loc.id})];
  return {testMode, location: loc.id, readers: readers.map(r => ({id: r.id, label: r.label, device: r.device_type, status: r.status, simulated: r.device_type?.includes('simulated') || r.serial_number?.includes('simulated') || /simulated/i.test(r.label || '')}))};
}

async function handle(action, b){
  switch (action){
    case 'setup': return setup();
    case 'start': {
      // amount in cents, before any credit surcharge. tipOnReader: show 18/20/22% on the reader.
      const amount = Math.round(Number(b.amount));
      if (!(amount >= 50)) throw new Error('Card payments must be at least $0.50.');
      const pi = b.paymentIntent
        ? await stripe('POST', `payment_intents/${b.paymentIntent}`, {amount})
        : await stripe('POST', 'payment_intents', {amount, currency: 'usd', allowed_payment_method_types: ['card_present'], capture_method: 'automatic', description: b.description || 'Proof POS', metadata: {source: b.source || 'register', order: b.orderRef || '', base_amount: amount, surcharge_on: b.surcharge ? '1' : '0'}});
      await stripe('POST', `terminal/readers/${b.reader}/collect_payment_method`, {payment_intent: pi.id, collect_config: {skip_tipping: b.tipOnReader ? 'false' : 'true', tipping: b.tipOnReader ? {amount_eligible: amount} : undefined}});
      return {paymentIntent: pi.id};
    }
    case 'status': {
      const reader = await stripe('GET', `terminal/readers/${b.reader}`);
      const pi = b.paymentIntent ? await stripe('GET', `payment_intents/${b.paymentIntent}?expand[]=payment_method`) : null;
      const a = reader.action || {};
      return {readerStatus: reader.status, action: a.type || null, actionStatus: a.status || null, failure: a.failure_message || null,
        // After the card is read, the reader keeps the action open and attaches the card; the PaymentIntent waits for confirmation.
        collected: !!(a.type === 'collect_payment_method' && (a.status === 'succeeded' || a.collect_payment_method?.payment_method)) || pi?.status === 'requires_confirmation',
        pi: pi && {id: pi.id, status: pi.status, amount: pi.amount, tip: pi.amount_details?.tip?.amount || 0, error: pi.last_payment_error?.message || null}};
    }
    case 'confirm': {
      // The card has been read. Add the surcharge for credit cards (capped at Stripe's fee), then charge.
      const pi = await stripe('GET', `payment_intents/${b.paymentIntent}?expand[]=payment_method`);
      const card = pi.payment_method?.card_present || {};
      const tip = pi.amount_details?.tip?.amount || 0;
      const base = pi.amount; // includes any tip picked on the reader
      const surcharge = pi.metadata?.surcharge_on === '1' ? surchargeFor(base, card.funding) : 0; // only where the surcharge is turned on
      if (surcharge) await stripe('POST', `payment_intents/${pi.id}`, {amount: base + surcharge, metadata: {surcharge, tip, funding: card.funding || ''}});
      else await stripe('POST', `payment_intents/${pi.id}`, {metadata: {surcharge: 0, tip, funding: card.funding || ''}});
      await stripe('POST', `terminal/readers/${b.reader}/confirm_payment_intent`, {payment_intent: pi.id});
      return {amount: base + surcharge, base: base - tip, tip, surcharge, funding: card.funding || null, brand: card.brand || null, last4: card.last4 || null};
    }
    case 'simulate': {
      // Test mode only: pretend a customer tapped a credit or debit card (and maybe tipped).
      const number = b.card === 'debit' ? '4000056655665556' : b.card === 'decline' ? '4000000000009995' : '4242424242424242';
      return stripe('POST', `test_helpers/terminal/readers/${b.reader}/present_payment_method`, {type: 'card_present', card_present: {number}, amount_tip: b.tip ? Math.round(b.tip) : undefined});
    }
    case 'cancel': {
      await stripe('POST', `terminal/readers/${b.reader}/cancel_action`).catch(() => {});
      if (b.paymentIntent) await stripe('POST', `payment_intents/${b.paymentIntent}/cancel`).catch(() => {});
      return {ok: true};
    }
    case 'email_receipt': {
      // Stripe emails its card receipt when an email is added to the charge. (In test mode Stripe doesn't send it; preview it in the Dashboard.)
      const pi = await stripe('GET', `payment_intents/${b.paymentIntent}`);
      if (!pi.latest_charge) throw new Error('No card charge on this payment.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) throw new Error('That email address does not look right.');
      await stripe('POST', `charges/${pi.latest_charge}`, {receipt_email: b.email});
      return {ok: true, testMode: !pi.livemode};
    }
    case 'refund': {
      const r = await stripe('POST', 'refunds', {payment_intent: b.paymentIntent, amount: b.amount ? Math.round(b.amount) : undefined, metadata: {staff: b.staff || ''}});
      return {id: r.id, amount: r.amount, status: r.status};
    }
    default: throw new Error('Unknown action');
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, {error: 'POST only'});
  if (!process.env.STRIPE_SECRET_KEY) return json(500, {error: 'The Stripe key is not set in Netlify yet.'});
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    await jwtVerify(token, JWKS, {issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT});
  } catch (e){ return json(401, {error: 'Sign in to Proof POS first.'}); }
  let body; try { body = await req.json(); } catch { return json(400, {error: 'Bad request'}); }
  try { return json(200, await handle(body.action, body)); }
  catch (e){ return json(400, {error: e.message, code: e.code || null}); }
};
