// Emails the owner when staff change or cancel a special order. Only signed-in Proof POS users can call it.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ownerNotice, pickupChangedEmail } from '../../shared/notify.mjs';
const PROJECT = 'proofpos-90500';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export default async (req) => {
  try { await jwtVerify((req.headers.get('authorization') || '').replace(/^Bearer /, ''), JWKS, {issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT}); }
  catch (e){ return new Response(JSON.stringify({error: 'Sign in first.'}), {status: 401}); }
  const b = await req.json().catch(() => ({}));
  if (b.kind === 'pickup_change'){ // tells the customer their new pickup day and time
    const to = String(b.to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^\d{2}:\d{2}$/.test(b.time)) return new Response(JSON.stringify({error: 'Missing details'}), {status: 400});
    const r = await pickupChangedEmail({to, name: String(b.name || '').slice(0, 60), num: String(b.num || '').slice(0, 10), date: b.date, time: b.time});
    return new Response(JSON.stringify({ok: !!r?.ok}), {headers: {'content-type': 'application/json'}});
  }
  await ownerNotice(String(b.subject || 'Special order changed').slice(0, 150), String(b.text || '').slice(0, 4000));
  return new Response(JSON.stringify({ok: true}), {headers: {'content-type': 'application/json'}});
};
