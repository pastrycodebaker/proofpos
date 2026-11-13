// What the griddle station needs from a ticket: the bread (with toasting and slicing),
// the things it cooks (eggs, meats, hash browns) and griddle notes ("Crispy meat").
// Roles come from the menu editor (group.griddle, option.griddle, item.griddle); when unset, sensible defaults apply.
export const GRIDDLE_ROLES = {'': 'Not shown', cook: 'Cook it', bread: 'Bread, toasting, slicing', note: 'Griddle note'};

const GROUP_DEFAULT = {egg: 'cook', protein: 'cook', bread: 'bread', toasting: 'bread', slicing: 'bread', 'bagel-flavors': 'bread'};
export function groupRole(g){ return g ? (g.griddle ?? GROUP_DEFAULT[g.id] ?? '') : ''; }
export function optionRole(g, o){
  if (o && o.griddle !== undefined && o.griddle !== null) return o.griddle;
  if (o && /hash ?brown/i.test(o.name) && (!g || !/request/i.test(g.id + g.name))) return 'cook';
  if (o && g && /request/i.test(g.id) && /crisp|hash ?brown|egg|bacon|sausage|toast/i.test(o.name)) return 'note';
  return groupRole(g);
}
export function itemRole(it){
  if (!it) return '';
  if (it.griddle !== undefined && it.griddle !== null) return it.griddle;
  return /hash ?brown|side of bacon|side of sausage|side of ham|side of egg/i.test(it.name || '') ? 'cook' : '';
}
const NOT_TOASTED = /^not toasted$/i;

// One line -> {bread: [..], prep: [..], cook: [{n, q}], notes: [..]}, or null when the griddle has nothing to do.
export function griddleParts(line, item, groupById){
  const out = {bread: [], prep: [], cook: [], notes: []};
  const ir = itemRole(item);
  if (ir === 'cook'){ const cs = (item.counts || []).filter(c => c.name && Number(c.qty) > 0 && (!c.size || c.size === line.size));
    if (cs.length) for (const c of cs) out.cook.push({n: c.name, q: Number(c.qty)}); else out.cook.push({n: line.name, q: 1}); }
  if (ir === 'bread') out.bread.push(line.name);
  for (const m of line.mods || []){
    const g = groupById(m.g); const o = g && (g.options || []).find(x => x.name === m.o);
    const r = optionRole(g, o || {name: m.o}); const q = m.q || 1;
    const label = (m.pre ? m.pre + ' ' : '') + m.o + (m.sub ? ' (' + m.sub + ')' : '');
    if (m.pre === 'No') continue; // taken off the sandwich: nothing to cook
    if (r === 'cook'){
      // Production counts say what a choice really means (Double egg = Egg 2); with none set it counts as 1 of itself.
      const cs = (!m.pre && !m.sub && o && (o.counts || []).filter(c => c.name && Number(c.qty) > 0)) || [];
      // A count naming a bagel or bread ("Plain bagel 1" on a pack sandwich) goes on the bread line, not the cook list.
      if (cs.length) for (const c of cs){ const n = Number(c.qty) * q; if (/bagel$|bread$|sourdough|brioche/i.test(c.name)) out.bread.push(n > 1 ? `${n}× ${c.name}` : c.name); else out.cook.push({n: c.name, q: n}); }
      else out.cook.push({n: label, q});
    }
    // The usual (Toasted, the group's default) goes unsaid, like on every KDS ticket.
    else if (r === 'bread'){ if (g && (g.id === 'toasting' || g.id === 'slicing' || /toast|slic/i.test(g.name))){ if (!(m.def || (!m.pre && q === 1 && !m.sub && g.default === m.o))) out.prep.push(label); } else out.bread.push(q > 1 ? q + '× ' + label : label); }
    else if (r === 'note') out.notes.push(label);
  }
  // Toasting matters only on something with bread; a sandwich with no bread pick still shows its cook items.
  // Same thing twice on one line (a pack with two egg sandwiches) shows once, added up.
  const sum = {}; for (const c of out.cook) sum[c.n] = (sum[c.n] || 0) + c.q; out.cook = Object.entries(sum).map(([n, q]) => ({n, q}));
  const bsum = {}; for (const b of out.bread){ const m = /^(\d+)× (.*)$/.exec(b); const k = m ? m[2] : b; bsum[k] = (bsum[k] || 0) + (m ? Number(m[1]) : 1); } out.bread = Object.entries(bsum).map(([k, n]) => n > 1 ? `${n}× ${k}` : k);
  if (!out.bread.length && !out.cook.length) return null;
  if (!out.bread.length) out.prep = out.prep.filter(p => !NOT_TOASTED.test(p));
  return out;
}
