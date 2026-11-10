// Backup for online orders: if a customer pays and closes their browser before the order is created,
// Stripe tells us here and we create it. Set up in Stripe: Developers → Webhooks → add endpoint
//   https://proofpos.netlify.app/.netlify/functions/stripe-webhook   event: payment_intent.succeeded
// then put its signing secret in Netlify as STRIPE_WEBHOOK_SECRET.
import crypto from 'node:crypto';
import { finish } from './online.mjs';

function verify(payload, header, secret){
  const parts = Object.fromEntries(String(header || '').split(',').map(x => x.split('=')));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${payload}`).digest('hex');
  const sigs = String(header).split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  return sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
export default async (req) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET; if (!secret) return new Response('Not set up', {status: 503});
  const payload = await req.text();
  if (!verify(payload, req.headers.get('stripe-signature'), secret)) return new Response('Bad signature', {status: 400});
  const evt = JSON.parse(payload);
  if (evt.type === 'payment_intent.succeeded' && evt.data?.object?.metadata?.source === 'online'){
    try { await finish(evt.data.object.id); } catch (e){ console.error(e); return new Response('Retry', {status: 500}); }
  }
  return new Response('ok');
};
