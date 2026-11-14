// Gift cards: giftCards/{number} = {number, balance, createdAt, lastUsedAt, source}; every change is a giftCardTx row.
// Balances only change inside a Firestore transaction, so two registers can't spend the same dollars.
export const cardNum = s => String(s || '').replace(/\D/g, '');
export const last4 = n => '••' + cardNum(n).slice(-4);
export const r2 = n => Math.round(n * 100) / 100;
// kind: sale | reload | redeem | refund | import | adjust.  delta > 0 adds money, < 0 spends it.
export function makeGiftStore(F, db){
  return {
    async get(num){ const s = await F.getDoc(F.doc(db, 'giftCards', cardNum(num))); return s.exists() ? s.data() : null; },
    async apply(num, delta, info = {}){
      const id = cardNum(num); if (id.length < 4) throw new Error('Enter the whole card number.');
      return F.runTransaction(db, async tx => {
        const ref = F.doc(db, 'giftCards', id); const snap = await tx.get(ref); const now = Date.now();
        const cur = snap.exists() ? Number(snap.data().balance || 0) : null;
        if (cur === null && delta < 0) throw new Error(`No gift card ${last4(id)} found.`);
        if (cur === null && !['sale', 'import', 'adjust'].includes(info.kind)) throw new Error(`No gift card ${last4(id)} found. Sell it as a new card instead.`);
        const next = r2((cur || 0) + delta);
        if (next < -0.004) throw new Error(`Only ${(cur || 0).toFixed(2)} left on ${last4(id)}.`);
        tx.set(ref, {number: id, balance: next, lastUsedAt: now, ...(cur === null ? {createdAt: now, source: info.kind} : {})}, {merge: true});
        tx.set(F.doc(F.collection(db, 'giftCardTx')), {card: id, delta: r2(delta), balance: next, at: now, ...info});
        return next;
      });
    },
    async history(num){ const s = await F.getDocs(F.query(F.collection(db, 'giftCardTx'), F.where('card', '==', cardNum(num)))); return s.docs.map(d => d.data()).sort((a, b) => b.at - a.at); },
  };
}
// The same, in memory, for ?demo.
export function demoGiftStore(){
  const cards = {'6012345678901234': {number: '6012345678901234', balance: 25, createdAt: Date.now() - 864e5 * 40, source: 'import'}}; const txs = [];
  return {
    async get(num){ return cards[cardNum(num)] ? {...cards[cardNum(num)]} : null; },
    async apply(num, delta, info = {}){ const id = cardNum(num); const c = cards[id];
      if (!c && (delta < 0 || !['sale', 'import', 'adjust'].includes(info.kind))) throw new Error(`No gift card ${last4(id)} found.`);
      const next = r2((c ? c.balance : 0) + delta); if (next < -0.004) throw new Error(`Only ${c.balance.toFixed(2)} left on ${last4(id)}.`);
      cards[id] = {...(c || {number: id, createdAt: Date.now(), source: info.kind}), balance: next, lastUsedAt: Date.now()}; txs.push({card: id, delta, balance: next, at: Date.now(), ...info}); return next; },
    async history(num){ return txs.filter(t => t.card === cardNum(num)).reverse(); },
    _all: () => Object.values(cards),
  };
}
