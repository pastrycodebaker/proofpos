// Runs every 10 minutes: queues the Sunday pre-order reminder, then sends any texts that are due, in batches.
// Does nothing until Twilio is set up (TWILIO_* keys in Netlify).
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, query, where } from 'firebase/firestore';
import { sendText, canText } from '../../shared/notify.mjs';
import { finalText, textSettings } from '../../shared/texts.mjs';
import { nyDate, nyTime, weekday, addDays, timeLabel, onlineSettings, preorderDays } from '../../shared/online.mjs';

const app = initializeApp({apiKey: 'AIzaSyAoAZWaLAYw0rKmgpzvYj8TMAN37YSH2UY', authDomain: 'proofpos-90500.firebaseapp.com', projectId: 'proofpos-90500'}, 'text-sender');
const db = getFirestore(app);
const PER_RUN = 70; // Netlify gives a scheduled run about 30 seconds; the rest go out on the next run.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "tomorrow (Monday) at 1pm"
function deadlineText(online, today){
  const d = onlineSettings(online).deadline;
  if (!d.weekly) return 'soon';
  let date = today; for (let i = 0; i < 7 && weekday(date) !== d.weekday; i++) date = addDays(date, 1);
  const day = date === addDays(today, 1) ? `tomorrow (${DAYS[d.weekday]})` : date === today ? 'today' : DAYS[d.weekday];
  return `${day} at ${timeLabel(d.time).replace(' ', '').toLowerCase()}`;
}

async function queueWeekly(now){
  const sref = doc(db, 'settings', 'texts'); const raw = (await getDoc(sref)).data() || {}; const s = textSettings(raw);
  // (deadlineText reads the menu's online ordering settings, so a changed deadline shows up in the text by itself)
  const today = nyDate(now);
  if (!s.weeklyOn || weekday(today) !== 0 || nyTime(now) < s.weeklyTime || s.lastWeekly === today || s.skipDate === today) return;
  const menu = (await getDoc(doc(db, 'menu', 'main'))).data() || {};
  await setDoc(sref, {lastWeekly: today}, {merge: true});
  if (!(preorderDays(menu, now).open || []).length) return; // closed for the week: no reminder
  const body = s.weeklyText.replace('{deadline}', deadlineText(menu, today));
  await addDoc(collection(db, 'textBlasts'), {list: 'weekly', body, status: 'queued', sendAt: now, createdAt: now, kind: 'weekly', sent: 0, failed: 0, by: 'automatic'});
}

async function sendDue(now){
  const due = (await getDocs(query(collection(db, 'textBlasts'), where('status', 'in', ['queued', 'sending'])))).docs.filter(d => (d.data().sendAt || 0) <= now);
  let budget = PER_RUN;
  for (const d of due){
    if (budget <= 0) break;
    const bl = d.data(); const text = finalText(bl.body);
    const subs = (await getDocs(query(collection(db, 'textSubs'), where('active', '==', true), where(`lists.${bl.list}`, '==', true)))).docs.map(x => x.data()).sort((a, b) => a.phone.localeCompare(b.phone));
    const todo = subs.filter(x => !bl.cursor || x.phone > bl.cursor).slice(0, budget);
    let sent = bl.sent || 0, failed = bl.failed || 0, cursor = bl.cursor || '';
    await updateDoc(d.ref, {status: 'sending', total: subs.length, startedAt: bl.startedAt || now});
    for (const x of todo){
      const r = await sendText(x.phone, text); budget--; cursor = x.phone;
      if (r.ok) sent++; else { failed++; if (r.code === 21610) await updateDoc(doc(db, 'textSubs', x.phone), {active: false, stoppedAt: now}); }
    }
    const done = !subs.some(x => x.phone > cursor);
    await updateDoc(d.ref, {sent, failed, cursor, ...(done ? {status: 'sent', sentAt: Date.now()} : {})});
  }
}

export default async () => {
  if (!canText() || !process.env.ORDER_BOT_EMAIL) return new Response('texting not set up');
  await signInWithEmailAndPassword(getAuth(app), process.env.ORDER_BOT_EMAIL, process.env.ORDER_BOT_PASSWORD);
  const now = Date.now();
  await queueWeekly(now);
  await sendDue(now);
  return new Response('ok');
};
export const config = {schedule: '*/10 * * * *'};
