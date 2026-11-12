// Builds ESC/POS bytes for network receipt printers (Toast TP200, Epson TM-L90 and similar).
const ESC = 0x1b, GS = 0x1d;
// The printers use code page 437: keep to plain characters.
// Cash drawer kick through the printer's drawer port: ESC p <pin> <on> <off>. Pin 0 (connector pin 2) or 1 (pin 5); on/off are pulse times in 2 ms steps.
export const drawerKick = (pin = 0, on = 0x19, off = 0xFA) => Buffer.from([ESC, 0x40, ESC, 0x70, pin & 1, on & 0xff, off & 0xff]);
const clean = s => String(s ?? '').replace(/[×✕]/g, 'x').replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/•/g, '*').replace(/…/g, '...').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e\n]/g, '');
export class Doc {
  constructor(cols = 48){ this.cols = cols; this.parts = [Buffer.from([ESC, 0x40])]; }
  raw(...b){ this.parts.push(Buffer.from(b)); return this; }
  align(a){ return this.raw(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0); }
  bold(on){ return this.raw(ESC, 0x45, on ? 1 : 0); }
  invert(on){ return this.raw(0x1D, 0x42, on ? 1 : 0); }  // white text on black, for allergies
  size(w = 1, h = 1){ return this.raw(GS, 0x21, ((w - 1) << 4) | (h - 1)); }
  text(s){ this.parts.push(Buffer.from(clean(s) + '\r\n', 'latin1')); return this; }  // CR LF, tested on the Toast TP200
  // Long text wraps at the paper width (halved for double-width text).
  wrap(s, indent = 0, w = 1){ const width = Math.floor(this.cols / w) - indent; const words = clean(s).split(' '); let line = '';
    for (const word of words){ if ((line + ' ' + word).trim().length > width){ this.text(' '.repeat(indent) + line.trim()); line = word; } else line += ' ' + word; }
    if (line.trim()) this.text(' '.repeat(indent) + line.trim()); return this; }
  pair(left, right, w = 1){ const width = Math.floor(this.cols / w); left = clean(left); right = clean(right); const room = width - right.length - 1;
    if (left.length > room){ this.text(left); return this.text(' '.repeat(Math.max(0, width - right.length)) + right); }
    return this.text(left + ' '.repeat(width - left.length - right.length) + right); }
  rule(ch = '-'){ return this.text(ch.repeat(this.cols)); }
  feed(n = 1){ return this.raw(ESC, 0x64, n); }
  cut(){ return this.feed(3).raw(GS, 0x56, 66, 0); }
  bytes(){ return Buffer.concat(this.parts); }
}
const money = n => (n < 0 ? '-$' : '$') + Math.abs(Number(n) || 0).toFixed(2);
const time = ms => new Date(ms).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
const modLine = m => [m.pre && m.pre !== 'No' ? m.pre : '', (m.q || 1) > 1 ? m.q + 'x' : '', m.o, m.sub ? '(' + m.sub + ')' : ''].filter(Boolean).join(' ');
// What the kitchen needs to see: changes only (No tomato, extras), plus the bread pick.
const shownMods = l => [...(l.noMods || []).map(x => 'NO ' + x.o), ...(l.mods || []).filter(m => m.inc || !m.def).map(modLine)]; // kitchen tickets list every ingredient
// Receipts list what was charged, so a priced default (the to-go cup) stays on.
const receiptMods = l => [...(l.noMods || []).map(x => 'NO ' + x.o), ...(l.mods || []).filter(m => !m.inc || m.pre || (m.q || 1) > 1 || m.sub).map(modLine)];
const sourceName = s => ({register: 'Register', kiosk: 'Kiosk', online: 'Online', hotplate: 'Hotplate', phone: 'Phone'})[s] || 'Register';
function groupLines(lines){ const out = []; for (const l of lines){ const k = JSON.stringify([l.name, l.version, l.mods, l.noMods, l.price, l.allergy || null]); const g = out.find(x => x.k === k); if (g) g.n++; else out.push({k, l, n: 1}); } return out; }

const allergyText = a => [...(a.tags || []), a.note].filter(Boolean).join(', ').toUpperCase();
export function ticket(order, lines, printer){
  const d = new Doc(printer.cols || 48);
  d.align('center').size(2, 2).bold(true).text(`#${order.num ?? ''} ${order.name || ''}`.trim()).bold(false).size();
  d.text(`${sourceName(order.source)} - ${time(order.fireAtMs || order.createdAtMs)}${order.rush ? '  ** RUSH **' : ''}`);
  if (order.pickupTime && order.readyAt) d.size(1, 2).bold(true).text('PICKUP ' + time(order.readyAt)).bold(false).size();
  else if (order.scheduled) d.text('Scheduled for ' + time(order.fireAtMs));
  d.align('left').rule();
  for (const {l, n} of groupLines(lines)){
    d.size(1, 2).bold(true).wrap(`${n > 1 ? n + 'x ' : ''}${[l.version, l.name].filter(Boolean).join(' ')}`).bold(false).size();
    if (l.countNote) d.wrap(l.countNote, 3);
    for (const m of shownMods(l)) d.wrap('- ' + m, 3);
    if (l.allergy) d.invert(true).bold(true).wrap(' ALLERGY: ' + allergyText(l.allergy) + ' ', 3).bold(false).invert(false);
  }
  return d.rule().align('center').text(printer.name || '').cut().bytes();
}
// One sticker per item, e.g. for each drink at the espresso bar.
export function stickers(order, lines, printer){
  const d = new Doc(printer.cols || 48); const all = lines.length;
  lines.forEach((l, i) => {
    d.align('left').size(2, 2).bold(true).wrap(order.name || '#' + (order.num ?? ''), 0, 2).bold(false).size();
    d.size(1, 2).bold(true).wrap([l.version, l.name].filter(Boolean).join(' ')).bold(false).size();
    for (const m of shownMods(l)) d.wrap('- ' + m, 2);
    if (l.allergy) d.invert(true).bold(true).wrap(' ALLERGY: ' + allergyText(l.allergy) + ' ', 2).bold(false).invert(false);
    d.text(`#${order.num ?? ''}  ${i + 1} of ${all}  ${time(order.createdAtMs)}`).cut();
  });
  return d.bytes();
}
export function receipt(order, printer, shop = {}){
  const d = new Doc(printer.cols || 48);
  const lines = Object.values(order.lines || {}).sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).filter(l => !l.removed);
  const t = order.totals || {}; const pays = order.payments || [];
  d.align('center').size(2, 2).bold(true).text(shop.name || 'Flour & Salt').bold(false).size();
  for (const x of shop.lines || ['37 Lebanon Street, Hamilton, NY']) d.text(x);
  d.text(new Date(order.paidAt || order.createdAtMs).toLocaleString('en-US')).bold(true).text(`Order #${order.num ?? ''}${order.name ? ' - ' + order.name : ''}`).bold(false).align('left').rule();
  for (const {l, n} of groupLines(lines)){ d.pair(`${n > 1 ? n + 'x ' : ''}${[l.version, l.name].filter(Boolean).join(' ')}`, money(l.price * n)); for (const m of receiptMods(l)) d.wrap(m, 3); }
  d.rule().pair('Subtotal', money(t.sub));
  if (t.disc) d.pair('Discount' + (order.discount ? ' (' + order.discount.name + ')' : ''), money(-t.disc));
  if (order.taxExempt) d.pair('Tax exempt (tax removed)', money(-(t.inTax || 0))); else d.pair('Includes sales tax', money(t.tax || 0));
  const tips = pays.reduce((s, p) => s + Number(p.tip || 0), 0), sur = pays.reduce((s, p) => s + Number(p.surcharge || 0), 0);
  if (tips) d.pair('Tip', money(tips));
  if (sur) d.pair('Credit card surcharge', money(sur));
  d.bold(true).pair('Total', money(Number(t.total || 0) + tips + sur)).bold(false);
  for (const p of pays) d.pair(p.label || p.method, money(p.charged ?? (Number(p.amount || 0) + Number(p.tip || 0) + Number(p.surcharge || 0))));
  if (sur) d.wrap('A credit card surcharge applies to credit cards only, not debit cards or cash.');
  return d.align('center').feed(1).text('Thank you!').text('Come for the bagel, stay for the line').cut().bytes();
}
export function testPage(printer){
  return new Doc(printer.cols || 48).align('center').size(2, 2).bold(true).text('Proof POS').bold(false).size().text('Test print').text(printer.name || '').text(`${printer.ip}:${printer.port || 9100}`).text(new Date().toLocaleString('en-US')).rule().align('left').pair('Left', 'Right').text('If you can read this, printing works.').cut().bytes();
}
