// Text sign-ups and test texts.
//   POST {action:'subscribe', name, phone, lists:['weekly',...], agree:true}   anyone (the /texts/ sign-up page)
//   POST {action:'test', to, body}   signed-in Proof POS users only (Texts page → Send me a test)
//   POST {action:'status'}           signed-in: is texting set up yet?
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sendText, canText } from '../../shared/notify.mjs';
import { LISTS, phone10, CONSENT, finalText, listName, BRAND } from '../../shared/texts.mjs';

const PROJECT = 'proofpos-90500';
const app = initializeApp({apiKey: 'AIzaSyAoAZWaLAYw0rKmgpzvYj8TMAN37YSH2UY', authDomain: 'proofpos-90500.firebaseapp.com', projectId: PROJECT}, 'texts');
const db = getFirestore(app);
let signedIn = null;
const signIn = () => signedIn || (signedIn = signInWithEmailAndPassword(getAuth(app), process.env.ORDER_BOT_EMAIL, process.env.ORDER_BOT_PASSWORD).catch(e => { signedIn = null; throw e; }));
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const staffOnly = async req => { await jwtVerify((req.headers.get('authorization') || '').replace(/^Bearer /, ''), JWKS, {issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT}); };

export default async (req) => {
  if (req.method !== 'POST') return json(405, {error: 'POST only'});
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'subscribe'){
      const p = phone10(b.phone); const name = String(b.name || '').trim().slice(0, 60);
      const chosen = LISTS.map(l => l[0]).filter(id => (b.lists || []).includes(id));
      if (!p) return json(400, {error: 'Please enter a 10-digit US mobile number.', field: 'phone'});
      if (!chosen.length) return json(400, {error: 'Pick at least one list.', field: 'lists'});
      if (b.agree !== true) return json(400, {error: 'Please check the box to agree to texts.', field: 'agree'});
      await signIn();
      const ref = doc(db, 'textSubs', p); const was = (await getDoc(ref)).data();
      const lists = Object.fromEntries(LISTS.map(l => [l[0], chosen.includes(l[0])]));
      const now = Date.now();
      await setDoc(ref, {phone: p, name, lists, active: true, consentAt: now, consentText: CONSENT, consentLists: chosen, source: 'sign-up page',
        createdAt: was?.createdAt || now, updatedAt: now, stoppedAt: null}, {merge: true});
      // A welcome text, unless they just signed up for the same lists (a double tap).
      const same = was?.active && JSON.stringify(was.lists) === JSON.stringify(lists) && now - (was.updatedAt || 0) < 3600000;
      if (!same) await sendText(p, `${BRAND}: you're signed up for ${chosen.map(listName).join(', ').toLowerCase()} texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel.`);
      return json(200, {ok: true, texting: canText()});
    }
    await staffOnly(req).catch(() => { throw Object.assign(new Error('Sign in first.'), {status: 401}); });
    if (b.action === 'status') return json(200, {texting: canText()});
    if (b.action === 'test'){
      if (!canText()) return json(400, {error: 'Texting is not set up yet (Twilio keys in Netlify).'});
      const r = await sendText(b.to, finalText(b.body));
      return r.ok ? json(200, {ok: true}) : json(400, {error: r.message || 'The text did not send.'});
    }
    return json(400, {error: 'Unknown action'});
  } catch (e){ return json(e.status || 500, {error: e.message}); }
};
