// Sign-ups (texts and email, one profile per person) and test texts.
//   POST {action:'subscribe', name, phone, email, picks:['weekly_text','newsletter_email',...], agree:true}   anyone (the /texts/ sign-up page)
//   POST {action:'test', to, body}   signed-in Proof POS users only (Texts page → Send me a test)
//   POST {action:'status'}           signed-in: is texting set up yet?
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sendText, canText } from '../../shared/notify.mjs';
import { LISTS, phone10, cleanEmail, emailId, subKey, CONSENT, finalText, listName, BRAND } from '../../shared/texts.mjs';

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
      const p = phone10(b.phone), em = cleanEmail(b.email), name = String(b.name || '').trim().slice(0, 60);
      const valid = new Set(LISTS.flatMap(([id, , , chs]) => chs.map(ch => subKey(id, ch))));
      const picks = (b.picks || []).filter(k => valid.has(k));
      const wantsText = picks.some(k => k.endsWith('_text')), wantsEmail = picks.some(k => k.endsWith('_email'));
      if (!picks.length) return json(400, {error: 'Pick at least one list.', field: 'lists'});
      if (wantsText && !p) return json(400, {error: 'Please enter a 10-digit US mobile number for texts.', field: 'phone'});
      if (wantsEmail && !em) return json(400, {error: 'Please enter your email address for emails.', field: 'email'});
      if (b.agree !== true) return json(400, {error: 'Please check the box to agree.', field: 'agree'});
      await signIn();
      // One profile per person: the rewards record by phone; email-only people get e_<email> until they add a phone.
      const byEmail = em ? (await getDocs(query(collection(db, 'customers'), where('email', '==', em)))).docs : [];
      let ref = p ? doc(db, 'customers', p) : (byEmail.find(d => !d.id.startsWith('e_')) || byEmail[0])?.ref || doc(db, 'customers', emailId(em));
      const was = (await getDoc(ref)).data() || {};
      let merged = {...was};
      for (const d of byEmail) if (d.id !== ref.id && d.id.startsWith('e_')){ // fold an email-only profile into the phone one
        const o = d.data(); merged = {...o, ...merged, subs: {...(o.subs || {}), ...(merged.subs || {})}, consent: {...(o.consent || {}), ...(merged.consent || {})}, createdAt: Math.min(o.createdAt || Date.now(), merged.createdAt || Date.now())};
        await deleteDoc(d.ref);
      }
      const now = Date.now(), subs = {...(merged.subs || {})};
      // The boxes they saw on this sign-up set those lists exactly, for the ways they gave us (a phone for texts, an email for emails).
      for (const [id, , , chs] of LISTS) for (const ch of chs) if ((ch === 'text' && p) || (ch === 'email' && em)) subs[subKey(id, ch)] = picks.includes(subKey(id, ch));
      const consent = {...(merged.consent || {})};
      if (wantsText) consent.text = {at: now, wording: CONSENT, picks: picks.filter(k => k.endsWith('_text')), source: 'sign-up page'};
      if (wantsEmail) consent.email = {at: now, wording: CONSENT, picks: picks.filter(k => k.endsWith('_email')), source: 'sign-up page'};
      // Only the sign-up fields are written (merge), so points from a register sale at the same moment aren't lost.
      await setDoc(ref, {...(merged.name && !name ? {name: merged.name} : {}), ...(merged.email && !em ? {email: merged.email} : {}), ...(name ? {name} : {}), ...(p ? {phone: p} : {}), ...(em ? {email: em} : {}), subs, consent,
        ...(wantsText ? {textOk: true, stoppedAt: null} : {}), ...(wantsEmail ? {emailOk: true} : {}), createdAt: merged.createdAt || now, updatedAt: now}, {merge: true});
      // A welcome text for new text sign-ups (not on a double tap).
      const textLists = LISTS.filter(([id]) => subs[subKey(id, 'text')]).map(([, n]) => n.toLowerCase());
      const before = JSON.stringify(Object.keys(was.subs || {}).filter(k => was.subs[k] && k.endsWith('_text')).sort()), after = JSON.stringify(picks.filter(k => k.endsWith('_text')).sort());
      if (wantsText && (before !== after || was.textOk === false)) await sendText(p, `${BRAND}: you're signed up for ${textLists.join(', ')} texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel.`);
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
