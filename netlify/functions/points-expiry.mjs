// Runs hourly, but does its work once a day (from 10am New York): emails a warning to members whose points
// expire within the warning window, then expires points for anyone past their date.
// Policy: settings/rewards (Orders and reports → Rewards). Run results: settings/rewardsRun.
// A run stops after about 20 seconds (Netlify's limit is about 30) and the next hourly run picks up where it left off.
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, query, where, runTransaction } from 'firebase/firestore';
import { sendEmail, canEmail } from '../../shared/notify.mjs';
import { nyDate, nyTime } from '../../shared/online.mjs';
import { expirySettings, needsWarning, isExpired, ruleDate, warningEmail } from '../../shared/rewards.mjs';

const app = initializeApp({apiKey: 'AIzaSyAoAZWaLAYw0rKmgpzvYj8TMAN37YSH2UY', authDomain: 'proofpos-90500.firebaseapp.com', projectId: 'proofpos-90500'}, 'points-expiry');
const db = getFirestore(app);

export default async () => {
  if (!process.env.ORDER_BOT_EMAIL) return new Response('not set up');
  const start = Date.now(), outOfTime = () => Date.now() - start > 20000;
  const today = nyDate(start);
  if (nyTime(start) < '10:00') return new Response('before 10am');
  await signInWithEmailAndPassword(getAuth(app), process.env.ORDER_BOT_EMAIL, process.env.ORDER_BOT_PASSWORD);
  const s = expirySettings((await getDoc(doc(db, 'settings', 'rewards'))).data());
  const rref = doc(db, 'settings', 'rewardsRun'); const run0 = (await getDoc(rref)).data() || {};
  if (!s.on || run0.doneFor === today) return new Response('nothing to do');
  const run = run0.date === today ? run0 : {date: today, warned: 0, expired: 0, points: 0};

  const members = (await getDocs(query(collection(db, 'customers'), where('points', '>', 0)))).docs.map(d => ({id: d.id, ...d.data()})).filter(c => !c.id.startsWith('e_'));

  // 1. Warnings, soonest date first, up to the daily cap (Resend's free plan allows 100 emails a day, shared with order emails).
  //    Anyone with an email keeps their points until their warning has had its full notice period, so a backlog never costs anyone.
  const due = members.filter(c => needsWarning(c, s, today)).sort((a, b) => ruleDate(a, s).localeCompare(ruleDate(b, s)));
  let sentNow = 0, warnStopped = false;
  if (canEmail()) for (const c of due){
    if (outOfTime()){ warnStopped = true; break; }
    if (run.warned >= s.dailyEmails) break;
    const date = ruleDate(c, s), e = warningEmail(c, date, s.months);
    const r = await sendEmail(c.email, e.subject, e.html, e.text);
    sentNow++;
    if (r.ok){ run.warned++; await updateDoc(doc(db, 'customers', c.id), {expiryWarnedFor: date, expiryWarnedAt: Date.now()}); }
    else { const fails = (c.warnFails || 0) + 1; await updateDoc(doc(db, 'customers', c.id), {warnFails: fails, ...(fails >= 3 ? {rewardEmailBad: true} : {})}); } // after 3 tries, their points expire on the normal date
  }

  // 2. Expire. Re-checked inside a transaction so a purchase happening right now always wins.
  let finished = true;
  for (const c of members.filter(c => isExpired(c, s, today))){
    if (outOfTime()){ finished = false; break; }
    const ref = doc(db, 'customers', c.id);
    const gone = await runTransaction(db, async tx => {
      const cur = (await tx.get(ref)).data() || {};
      if (!isExpired(cur, s, today)) return 0;
      tx.update(ref, {points: 0, expiredPoints: cur.points, pointsExpiredAt: Date.now()});
      return cur.points;
    }).catch(err => { console.error('expire failed', c.id, err.message); return 0; });
    if (gone){ run.expired++; run.points += gone; await addDoc(collection(db, 'events'), {type: 'points_expire', phone: c.id, points: -gone, at: Date.now(), staff: 'automatic'}).catch(() => {}); }
  }

  const waiting = canEmail() ? due.length - sentNow : 0; // left for tomorrow (daily cap) or the next run
  const doneFor = finished && !warnStopped ? today : run0.doneFor || '';
  await setDoc(rref, {...run, waiting, doneFor, at: Date.now()});
  return new Response(`warned ${run.warned}, expired ${run.expired} (${run.points} points)`);
};

export const config = {schedule: '0 * * * *'};
