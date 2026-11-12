// Card holds: register and kiosk card payments are authorized at the tap and captured (the money taken)
// when the order is bumped or cleared on the KDS. Until then, edits raise or lower the hold instead of refunding.
const live = l => !l.removed;
const kdsLines = o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})).filter(l => live(l) && l.station && l.station !== 'none');
export const heldPayments = o => (o.payments || []).filter(p => p.method === 'card' && p.held && p.paymentIntent);
// Ready to take the money: cleared on the runner, voided, or every kitchen and bar item bumped (orders with none: right away).
export function readyToCapture(o){
  if (!heldPayments(o).length) return false;
  if (o.cleared || o.status === 'void') return true;
  return kdsLines(o).every(l => l.done);
}
// Captures every held card payment on the order. update(fields) saves the order.
export async function captureHolds(o, PAY, update){
  const pays = structuredClone(o.payments || []); let changed = false;
  for (const p of pays) if (p.method === 'card' && p.held && p.paymentIntent){
    const r = await PAY.capture(p.paymentIntent);
    p.held = false; p.capturedAt = Date.now(); if (r && typeof r.amount === 'number') p.charged = r.amount; changed = true;
  }
  if (changed) await update({payments: pays, cardHold: false});
}
