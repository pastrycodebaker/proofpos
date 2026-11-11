// Emails the owner when staff change or cancel a special order. Only signed-in Proof POS users can call it.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ownerNotice } from '../../shared/notify.mjs';
const PROJECT = 'proofpos-90500';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export default async (req) => {
  try { await jwtVerify((req.headers.get('authorization') || '').replace(/^Bearer /, ''), JWKS, {issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT}); }
  catch (e){ return new Response(JSON.stringify({error: 'Sign in first.'}), {status: 401}); }
  const b = await req.json().catch(() => ({}));
  await ownerNotice(String(b.subject || 'Special order changed').slice(0, 150), String(b.text || '').slice(0, 4000));
  return new Response(JSON.stringify({ok: true}), {headers: {'content-type': 'application/json'}});
};
