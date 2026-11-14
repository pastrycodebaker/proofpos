// "Pause online ordering" chooser used on the register and every KDS screen.
import { onlinePausedNow, nyDate, nyMs, nyTime, addDays } from './online.mjs';

export { onlinePausedNow };
const clock = ms => new Date(ms).toLocaleTimeString('en-US', {timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit'});

// "OFF", "OFF · back on 2:45 PM"
export function pauseLabel(status = {}, now = Date.now()){
  if (!onlinePausedNow(status, now)) return 'on';
  const u = Number(status.onlinePausedUntil || 0);
  return !u ? 'OFF' : nyTime(u) === '00:00' ? 'OFF for today' : `OFF · back on ${clock(u)}`;
}

// Tapping the button: if paused, turn back on right away. If on, ask how long. Resolves with the status change to save, or null.
export function choosePause(status = {}, who = ''){
  const now = Date.now();
  if (onlinePausedNow(status, now)) return Promise.resolve({onlinePaused: false, onlinePausedUntil: 0, changedAt: now, changedBy: who});
  return new Promise(resolve => {
    const endOfDay = nyMs(addDays(nyDate(now), 1), '00:00');
    const opts = [['15 minutes', now + 15 * 60000], ['30 minutes', now + 30 * 60000], ['1 hour', now + 60 * 60000], ['Rest of today', endOfDay], ['Until someone turns it back on', 0]];
    const box = document.createElement('div');
    box.setAttribute('style', 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;font:18px Helvetica,Arial,sans-serif');
    box.innerHTML = `<div style="background:#fff;color:#222;border-radius:14px;padding:22px;width:min(420px,92vw)"><div style="font-size:22px;font-weight:700;margin-bottom:6px">Pause online ordering</div>
      <div style="color:#666;font-size:15px;margin-bottom:14px">New online orders for today stop. Pre-orders for later days still come in.</div>
      ${opts.map(([t, v], i) => `<button data-i="${i}" style="display:block;width:100%;padding:14px;margin:0 0 8px;font-size:18px;border-radius:10px;border:1px solid #ccc;background:#f7f5f2;text-align:left">${t}${v ? `<span style="float:right;color:#888">${nyTime(v) === '00:00' ? 'back on tomorrow' : 'until ' + clock(v)}</span>` : ''}</button>`).join('')}
      <button data-x style="display:block;width:100%;padding:12px;font-size:17px;border:0;background:none;color:#666">Cancel</button></div>`;
    const done = v => { box.remove(); resolve(v); };
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b && e.target !== box) return;
      if (!b || b.hasAttribute('data-x')) return done(null);
      done({onlinePaused: true, onlinePausedUntil: opts[+b.dataset.i][1], changedAt: Date.now(), changedBy: who});
    });
    document.body.appendChild(box);
  });
}
