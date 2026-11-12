// Card payments for the register and kiosk, through the Netlify function that talks to Stripe Terminal.
// Each tablet remembers which reader it uses (localStorage 'proof.reader').
export function createPayments({demo = false, getToken}){
  async function api(action, body = {}){
    if (demo) return demoApi(action, body);
    const token = await getToken();
    const r = await fetch('/.netlify/functions/stripe', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + token}, body: JSON.stringify({...body, action})});
    const data = await r.json().catch(() => ({error: 'No answer from the payment server.'}));
    if (!r.ok) throw new Error(data.error || 'Payment server error');
    return data;
  }
  let setupCache = null;
  async function reader(){
    if (!setupCache) setupCache = await api('setup');
    let id = null; try { id = localStorage.getItem('proof.reader'); } catch (e) {}
    const r = setupCache.readers.find(x => x.id === id) || setupCache.readers[0];
    if (!r) throw new Error('No card reader is set up yet. Register one in Stripe under Terminal.');
    return {...r, testMode: setupCache.testMode};
  }
  // amount in dollars, before any credit surcharge. onUpdate({stage, message, simulated}).
  // Resolves {amount, base, tip, surcharge, funding, brand, last4, paymentIntent} in dollars, or throws (message 'Canceled' when canceled).
  function cardPayment({amount, tipOnReader = false, surcharge = false, source = 'register', description = '', onUpdate = () => {}}){
    let canceled = false, rd = null, pi = null;
    const ctl = {
      async simulate(card, tipCents){ if (rd && pi) await api('simulate', {reader: rd.id, card, tip: tipCents}); },
      async cancel(){ canceled = true; if (rd) await api('cancel', {reader: rd.id, paymentIntent: pi}).catch(() => {}); },
    };
    ctl.done = (async () => {
      rd = await reader();
      onUpdate({stage: 'starting', message: 'Sending to the card reader…', simulated: rd.simulated || rd.testMode});
      pi = (await api('start', {reader: rd.id, amount: Math.round(amount * 100), tipOnReader, surcharge, source, description})).paymentIntent;
      onUpdate({stage: 'waiting', message: tipOnReader ? 'Customer: pick a tip, then tap, insert or swipe.' : 'Customer: tap, insert or swipe your card.', simulated: rd.simulated || rd.testMode});
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let result = null, confirmed = false;
      for (let i = 0; i < 300; i++){
        if (canceled) throw new Error('Canceled');
        await sleep(1000);
        const s = await api('status', {reader: rd.id, paymentIntent: pi});
        if (s.pi && (s.pi.status === 'succeeded' || s.pi.status === 'requires_capture')) break;
        if (!confirmed && s.collected){
          onUpdate({stage: 'processing', message: 'Approving…', simulated: false});
          result = await api('confirm', {reader: rd.id, paymentIntent: pi}); confirmed = true; continue;
        }
        if (s.actionStatus === 'failed'){ throw new Error(s.failure || s.pi?.error || 'The card did not go through. Try again or use another card.'); }
      }
      if (!result) throw new Error('The reader timed out. Try again.');
      const c = v => Math.round(v) / 100;
      return {paymentIntent: pi, amount: c(result.amount), base: c(result.base), tip: c(result.tip), surcharge: c(result.surcharge), funding: result.funding, brand: result.brand, last4: result.last4, held: !!result.held};
    })();
    return ctl;
  }
  async function emailReceipt(paymentIntent, email){ return api('email_receipt', {paymentIntent, email}); }
  async function refund(paymentIntent, amount, staff){ return api('refund', {paymentIntent, amount: amount ? Math.round(amount * 100) : undefined, staff}); }
  async function capture(paymentIntent){ return api('capture', {paymentIntent}); }
  // base: dollars of items on this card after an edit. Resolves {ok, held, amount, surcharge, refunded, reason} in dollars.
  async function adjust(paymentIntent, base, staff){ return api('adjust', {paymentIntent, base: Math.round(base * 100), staff}); }
  return {cardPayment, refund, reader, emailReceipt, capture, adjust};
}

// Demo mode: no server; a pretend reader that works the same way.
let demoState = {};
async function demoApi(action, b){
  if (action === 'setup') return {testMode: true, readers: [{id: 'demo_reader', label: 'Demo reader', simulated: true}]};
  if (action === 'start'){ demoState = {amount: b.amount, surcharge: !!b.surcharge, collected: false, done: false}; return {paymentIntent: 'pi_demo_' + Date.now()}; }
  if (action === 'simulate'){ if (b.card === 'decline'){ demoState.failed = true; return {}; } demoState.collected = true; demoState.funding = b.card === 'debit' ? 'debit' : 'credit'; demoState.tip = b.tip || 0; return {}; }
  if (action === 'status') return {collected: demoState.collected, actionStatus: demoState.failed ? 'failed' : null, failure: demoState.failed ? 'Card declined (demo)' : null, pi: {status: demoState.done ? 'succeeded' : 'requires_payment_method'}};
  if (action === 'confirm'){ const base = demoState.amount + demoState.tip; const s = demoState.surcharge && demoState.funding === 'credit' ? Math.min(Math.round(base * 0.03), Math.round(base * 0.027) + 5) : 0; demoState.done = true; return {held: true, amount: base + s, base: demoState.amount, tip: demoState.tip, surcharge: s, funding: demoState.funding, brand: 'visa', last4: demoState.funding === 'debit' ? '5556' : '4242'}; }
  if (action === 'cancel') return {ok: true};
  if (action === 'email_receipt') return {ok: true, testMode: true};
  if (action === 'refund') return {id: 're_demo', amount: b.amount, status: 'succeeded'};
  if (action === 'capture') return {status: 'succeeded'};
  if (action === 'adjust') return {ok: true, held: true, amount: b.base / 100, surcharge: 0};
  throw new Error('demo: ' + action);
}
