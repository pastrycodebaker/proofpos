// Runs every 5 minutes: texts pre-order customers about 15 minutes before their pickup time.
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';
import { nyDate } from '../../shared/online.mjs';
import { pickupReminder, canText } from '../../shared/notify.mjs';

const app = initializeApp({apiKey: 'AIzaSyAoAZWaLAYw0rKmgpzvYj8TMAN37YSH2UY', authDomain: 'proofpos-90500.firebaseapp.com', projectId: 'proofpos-90500'}, 'reminders');
const db = getFirestore(app);

export default async () => {
  if (!canText() || !process.env.ORDER_BOT_EMAIL) return new Response('texting not set up');
  await signInWithEmailAndPassword(getAuth(app), process.env.ORDER_BOT_EMAIL, process.env.ORDER_BOT_PASSWORD);
  const now = Date.now(); const snap = await getDocs(query(collection(db, 'orders'), where('pickupDate', '==', nyDate(now))));
  let sent = 0;
  for (const d of snap.docs){
    const o = d.data();
    if (!o.special || o.status !== 'paid' || o.cancelled || !o.smsOptIn || o.reminderSent || o.pickedUp || !o.phone || !o.readyAt) continue;
    const mins = (o.readyAt - now) / 60000;
    if (mins > 20 || mins < 0) continue;  // about 15 minutes before (checked every 5 minutes)
    await updateDoc(doc(db, 'orders', d.id), {reminderSent: true});
    await pickupReminder(o); sent++;
  }
  return new Response('sent ' + sent);
};
export const config = {schedule: '*/5 * * * *'};
