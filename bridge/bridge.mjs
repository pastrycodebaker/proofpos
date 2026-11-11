// Proof POS print bridge. Runs on an always-on computer at the cafe (a laptop to test, then a Raspberry Pi).
// It watches Proof POS for new orders and print requests, and sends them to the network printers set up
// in the menu editor's Printers page. Start it with start-bridge (Mac/Windows) or `node bridge.mjs`.
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline/promises';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, query, where, onSnapshot, updateDoc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { ticket, stickers, receipt, testPage } from './escpos.mjs';

const firebaseConfig = {apiKey: 'AIzaSyAoAZWaLAYw0rKmgpzvYj8TMAN37YSH2UY', authDomain: 'proofpos-90500.firebaseapp.com', projectId: 'proofpos-90500'};
const CONFIG = new URL('./config.json', import.meta.url);
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ---------- Sign in (asked once, then saved on this computer) ----------
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch {}
if (!cfg.email || !cfg.password){
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  console.log('Proof POS print bridge: sign in with the shop account (saved on this computer only).');
  cfg.email = (await rl.question('Email: ')).trim(); cfg.password = (await rl.question('Password: ')).trim(); rl.close();
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), {mode: 0o600});
}
const app = initializeApp(firebaseConfig);
try { await signInWithEmailAndPassword(getAuth(app), cfg.email, cfg.password); }
catch (e){ console.error('Sign in failed. Delete config.json next to this file and start again.', e.code || e.message); process.exit(1); }
const db = getFirestore(app);
log('Signed in. Watching for orders and print requests…');

// ---------- Printers (set up in the menu editor → Printers) ----------
let PRINTERS = [], SHOP = {};
onSnapshot(doc(db, 'settings', 'printers'), s => { const d = s.exists() ? s.data() : {}; PRINTERS = d.printers || []; SHOP = d.shop || {}; log(`${PRINTERS.length} printer(s): ${PRINTERS.map(p => `${p.name} (${p.ip})`).join(', ') || 'none yet'}`); });

function send(printer, bytes){
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({host: printer.ip, port: Number(printer.port || 9100)});
    const fail = e => { sock.destroy(); reject(e); };
    sock.setTimeout(8000, () => fail(new Error(`No answer from ${printer.name} at ${printer.ip}`)));
    sock.on('error', fail);
    sock.on('connect', () => sock.end(bytes, () => resolve()));
  });
}
// One printer at a time, in order, so tickets never interleave.
const queues = new Map();
function enqueue(printer, bytes){
  const prev = queues.get(printer.id) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => { for (let i = 0; i < 3; i++){ try { return await send(printer, bytes); } catch (e){ if (i === 2) throw e; await new Promise(r => setTimeout(r, 1500)); } } });
  queues.set(printer.id, next); return next;
}

// ---------- New orders: kitchen tickets and drink stickers print by themselves ----------
const started = Date.now();
const since = started - 10 * 60000; // after a restart, catch up on the last 10 minutes only
const linesOf = o => Object.values(o.lines || {}).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
let ORDERS = [];
async function printNew(){
  const now = Date.now();
  for (const o of ORDERS){
    if (o.status === 'void' || (o.fireAtMs || o.createdAtMs) > now) continue; // scheduled orders print when they fire
    for (const p of PRINTERS.filter(p => p.kind === 'tickets' || p.kind === 'stickers')){
      const done = (o.printed || {})[p.id] || {};
      const lines = linesOf(o).filter(l => !l.removed && !(o.special && l.packAs && !l.fromCafe) && !done[l.lid] && (p.stations || []).includes(l.station || 'none'));
      if (!lines.length) continue;
      const mark = Object.fromEntries(lines.map(l => [`printed.${p.id}.${l.lid}`, true]));
      o.printed = {...(o.printed || {}), [p.id]: {...done, ...Object.fromEntries(lines.map(l => [l.lid, true]))}}; // claim first so nothing prints twice
      try { await updateDoc(doc(db, 'orders', o.id), mark); } catch (e){ log('Could not mark order', o.num, e.message); }
      const bytes = p.kind === 'stickers' ? stickers(o, lines, p) : ticket(o, lines, p);
      enqueue(p, bytes).then(() => log(`Printed ${p.kind} for #${o.num} on ${p.name}`)).catch(e => log('PRINT FAILED', p.name, e.message));
    }
  }
}
// Two feeds: orders rung up since start, and pre-orders (placed days ago) that fire from now on.
const feeds = {made: [], fires: []};
const merge = () => { const m = new Map(); for (const o of [...feeds.made, ...feeds.fires]) m.set(o.id, o); ORDERS = [...m.values()]; printNew(); };
onSnapshot(query(collection(db, 'orders'), where('createdAtMs', '>=', since)), s => { feeds.made = s.docs.map(d => ({id: d.id, ...d.data()})); merge(); });
onSnapshot(query(collection(db, 'orders'), where('fireAtMs', '>=', since)), s => { feeds.fires = s.docs.map(d => ({id: d.id, ...d.data()})); merge(); });
setInterval(printNew, 30000); // scheduled orders

// ---------- Print requests: receipts, reprints and test prints ----------
onSnapshot(query(collection(db, 'printJobs'), where('status', '==', 'queued')), s => {
  for (const ch of s.docChanges()){
    if (ch.type !== 'added') continue;
    handleJob(ch.doc.id, ch.doc.data());
  }
});
async function handleJob(id, job){
  const ref = doc(db, 'printJobs', id);
  try {
    await updateDoc(ref, {status: 'printing'});
    const pick = kind => PRINTERS.find(p => p.id === job.printerId) || PRINTERS.find(p => p.kind === kind);
    let printer, bytes;
    if (job.kind === 'test'){ printer = pick('receipts'); bytes = testPage(printer); }
    else {
      const o = await getDoc(doc(db, 'orders', job.orderId)); if (!o.exists()) throw new Error('Order not found');
      const order = {id: o.id, ...o.data()};
      if (job.kind === 'receipt'){ printer = pick('receipts'); bytes = receipt(order, printer, SHOP); }
      else { printer = pick('tickets'); bytes = (printer.kind === 'stickers' ? stickers : ticket)(order, linesOf(order).filter(l => !l.removed && (!printer.stations || printer.stations.includes(l.station || 'none'))), printer); }
    }
    if (!printer) throw new Error('No printer set up for this');
    await enqueue(printer, bytes);
    await updateDoc(ref, {status: 'printed', printedAt: Date.now(), printer: printer.name});
    log(`Printed ${job.kind} on ${printer.name}`);
  } catch (e){ log('PRINT FAILED', job.kind, e.message); await updateDoc(ref, {status: 'error', error: e.message}).catch(() => {}); }
}

// ---------- Heartbeat: the Printers page shows whether the bridge is running ----------
async function beat(){ try { await setDoc(doc(db, 'menu', 'status'), {bridgeSeenAt: Date.now(), bridgeHost: os.hostname()}, {merge: true}); } catch (e){ log('Heartbeat failed', e.message); } }
beat(); setInterval(beat, 60000);
process.on('unhandledRejection', e => log('Error', e?.message || e));
