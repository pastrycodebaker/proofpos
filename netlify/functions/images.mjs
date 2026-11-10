// Menu photos, stored in Netlify Blobs (nothing to set up). Anyone can view; only signed-in Proof POS users can upload.
// The menu editor shrinks each photo to a small WebP before uploading, so files stay around 50-150 KB.
import { getStore } from '@netlify/blobs';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PROJECT = 'proofpos-90500';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const TYPES = {'image/webp': 1, 'image/jpeg': 1, 'image/png': 1};

export default async (req) => {
  const store = getStore('menu-images');
  const url = new URL(req.url);
  const key = (url.searchParams.get('id') || url.pathname.split('/').pop() || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (req.method === 'GET'){
    if (!key) return new Response('Not found', {status: 404});
    const r = await store.getWithMetadata(key, {type: 'arrayBuffer'});
    if (!r) return new Response('Not found', {status: 404});
    // Each upload gets a new id, so the browser can keep a photo for a year.
    return new Response(r.data, {headers: {'content-type': r.metadata?.type || 'image/webp', 'cache-control': 'public, max-age=31536000, immutable'}});
  }
  if (req.method !== 'POST') return new Response('Method not allowed', {status: 405});
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    await jwtVerify(token, JWKS, {issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT});
  } catch (e){ return json(401, {error: 'Sign in to Proof POS first.'}); }
  const type = req.headers.get('content-type') || '';
  if (!TYPES[type]) return json(400, {error: 'Please upload a photo (JPEG, PNG or WebP).'});
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 1.5 * 1024 * 1024) return json(400, {error: 'That photo is too large.'});
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await store.set(id, buf, {metadata: {type}});
  return json(200, {url: '/img/' + id});
};
