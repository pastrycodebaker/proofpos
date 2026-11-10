# Builds data/seed-menu.json from Toast exports (product mix Sep 30–Oct 31, modifier selections Oct 11–Nov 7).
import csv, json, re, collections

PM = 'pm/All levels.csv'
OUT = '/home/claude/proofpos/data/seed-menu.json'
slug = lambda s: re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
SRC = 'Toast, Oct 2026'

# ---------- Modifier groups (shared) ----------
def opt(name, price=0, **kw):
    o = {'name': name, 'pricing': 'flat', 'price': price, 'bySize': {}, 'counts': [], 'subs': [], 'hideOnline': False}
    o.update(kw); return o
PRICE_COLS = ['hot 8 oz', 'hot 12 oz', 'hot 16 oz', 'iced 16 oz', 'iced 20 oz']
def sized(name, price):  # priced by temperature and size; every column starts at today's Toast price
    return opt(name, price, pricing='bySize', bySize={c: price for c in PRICE_COLS})
G = [
  {'id': 'toasting', 'name': 'Toasting', 'min': 0, 'max': 1, 'default': 'Toasted', 'options': [opt('Toasted'), opt('Lightly toasted'), opt('Double toasted'), opt('Not toasted')]},
  {'id': 'bread', 'name': 'Bread', 'min': 1, 'max': 1, 'options': [opt('Bagel'), opt('Sourdough'), opt('Brioche roll'), opt('Croissant', 3.25), opt('GF bagel', 1.75), opt('GF hash brown', 1.25), opt('No bread, in a box', 0.5)]},
  {'id': 'bagel-flavors', 'name': 'Bagel flavors', 'min': 0, 'max': 99, 'options': [opt('Plain'), opt('Everything'), opt('Rosemary salt'), opt('Sesame'), opt('Jalapeno cheddar', 0.25), opt('Salt'), opt('Cinnamon raisin', 0.25), opt('Poppy'), opt('Cinnamon sugar')]},
  {'id': 'egg', 'name': 'Egg', 'min': 0, 'max': 3, 'options': [opt('Egg', 1.35), opt('Scrambled egg', 1.5), opt('Egg white', 1.6), opt('Double egg', 2.5)]},
  {'id': 'protein', 'name': 'Protein', 'min': 0, 'max': 9, 'options': [opt('Bacon', 2.15), opt('Sausage', 2.15), opt('Impossible sausage', 4.5), opt('Turkey', 4.5), opt('Ham', 4.5), opt('Italian meat combo', 7.55), opt('Tofu kan', 4.5)]},
  {'id': 'cheese', 'name': 'Cheese', 'min': 0, 'max': 9, 'options': [opt('Cheddar', 1.1), opt('American', 1.1), opt('Swiss', 1.1), opt('Pepper jack', 1.1), opt('Pimento cheese', 2.75)]},
  {'id': 'produce', 'name': 'Produce', 'min': 0, 'max': 9, 'options': [opt('Avocado', 1.1), opt('Hash brown', 1.6), opt('Tomato', 1.35), opt('Greens mix', 1.9), opt('Red onions', 0.65), opt('Red onion parsley salad', 1.1), opt('Jalapenos', 0.55), opt('Roasted red peppers', 1.6)]},
  {'id': 'sauce', 'name': 'Sauce', 'min': 0, 'max': 9, 'options': [opt('Chipotle mayo', 0.8), opt('Mayo', 0.55), opt('Calabrian mayo', 0.8), opt('Calabrian pepper', 0.8), opt('Onion jam', 1.1), opt('Zhoug', 2.75), opt('Hot sauce', 0.8), opt('Ketchup', 0.2), opt('Mustard', 0.2), opt('Maple syrup', 1.1), opt('Salt and pepper')]},
  {'id': 'spreads', 'name': 'Spreads', 'min': 0, 'max': 9, 'options': [opt('Plain cream cheese', 1.9), opt('Scallion cream cheese', 2.45), opt('Roasted garlic cream cheese', 2.45), opt('Butter', 0.7), opt('Vegan butter', 1.1), opt('Raspberry jam', 1.35), opt('Honey', 1.0), opt('Cream cheese on the side', 2.7)]},
  {'id': 'kitchen-requests', 'name': 'Kitchen requests', 'min': 0, 'max': 9, 'options': [opt('Crispy meat'), opt('Do not cut in half'), opt('Nothing on it, just sliced and toasted'), opt('Cold cheese and meat'), opt('Extra crispy hash brown')]},
  {'id': 'allergy', 'name': 'Allergy', 'min': 0, 'max': 9, 'options': [opt('Gluten allergy'), opt('Dairy allergy'), opt('Egg allergy'), opt('Tree nut allergy')]},
  # Drinks
  {'id': 'milk', 'name': 'Milk', 'min': 0, 'max': 1, 'default': 'Whole', 'options': [sized('Whole', 0), sized('Oat', 1.1), sized('Almond', 1.1), sized('Half & half', 0), opt('Just water (matcha)')]},
  {'id': 'syrup', 'name': 'Syrups', 'min': 0, 'max': 9, 'options': [sized('Vanilla', 0.3), sized('Caramel', 0.3), sized('Simple', 0.3), sized('Pumpkin', 0.75), sized('Brown sugar bourbon', 0.75), sized('Honey ginger', 0.75), sized('Maple', 1.1), sized('Honey', 1.1)]},
  {'id': 'espresso', 'name': 'Espresso', 'min': 0, 'max': 9, 'options': [opt('Decaf'), opt('Add double shot', 2.25)]},
  {'id': 'cold-foam', 'name': 'Cold foam', 'min': 0, 'max': 2, 'options': [opt('Salted maple foam', 1.5), opt('Pumpkin spice foam', 1.5)]},
  {'id': 'creamer', 'name': 'Creamer', 'min': 0, 'max': 1, 'options': [opt('Whole milk'), opt('Half & half'), opt('Oat milk', 0.3), opt('Almond milk', 0.3)]},
  {'id': 'cup', 'name': 'Cup', 'min': 0, 'max': 1, 'default': 'To go cup', 'options': [opt('To go cup', 0.3), opt('For here', 0, hideOnline=True), opt('House mug', 0, hideOnline=True), opt('Customer cup', -0.3, hideOnline=True)]},
  {'id': 'drink-requests', 'name': 'Drink requests', 'min': 0, 'max': 9, 'options': [opt('Light ice'), opt('Extra hot'), opt('Leave room'), opt('Light on syrup'), opt('Add cinnamon'), opt('Wet foam'), opt('Aerocano')]},
  {'id': 'tea', 'name': 'Tea', 'min': 1, 'max': 1, 'options': [opt('English breakfast'), opt('Earl grey'), opt('Black assam'), opt('Green'), opt('Decaf green'), opt('Mint'), opt('Lemon ginger'), opt('Peach ginger'), opt('Chamomile citrus')]},
  {'id': 'tea-extras', 'name': 'Tea extras', 'min': 0, 'max': 9, 'options': [opt('Lemon juice', 0.1), opt('Extra tea bag', 0.6), opt('Steamed milk', 0.5)]},
  {'id': 'roast', 'name': 'Roast', 'min': 0, 'max': 1, 'options': [opt("Baker's Brew (medium)"), opt('Trailblazer (dark)')]},
  {'id': 'kombucha', 'name': 'Kombucha flavor', 'min': 1, 'max': 1, 'options': [opt('Jasmine'), opt('Magnolia')]},
  {'id': 'harney', 'name': 'Harney & Sons flavor', 'min': 1, 'max': 1, 'options': [opt('Apple'), opt('Green with ginkgo'), opt('Blood orange'), opt('Hibiscus'), opt('Black'), opt('Cranberry')]},
  {'id': 'yerba', 'name': 'Yerba flavor', 'min': 1, 'max': 1, 'options': [opt('Enlighten Mint'), opt('Bluephoria')]},
  {'id': 'soda', 'name': 'Soda flavor', 'min': 1, 'max': 1, 'options': [opt('Blueberry'), opt('Clementine'), opt('Cola'), opt('Ginger ale'), opt('Black cherry'), opt('Strawberry kiwi')]},
  {'id': 'donut', 'name': 'Donut flavor', 'min': 1, 'max': 1, 'options': [opt('Vanilla glazed', 3.0), opt('Chocolate glazed', 3.0), opt('Vanilla filled', 3.5), opt('Chocolate filled', 3.5), opt('Raspberry filled', 3.5), opt('Special filled', 3.5)]},
  {'id': 'slicing', 'name': 'Slicing', 'min': 0, 'max': 1, 'options': [opt('Sliced', 0.5)]},
  {'id': 'loaf', 'name': 'Loaf', 'min': 1, 'max': 1, 'options': [opt('Unsliced boule'), opt('Sliced sandwich loaf')]},
  {'id': 'loaf-slice', 'name': 'Sliced?', 'min': 1, 'max': 1, 'options': [opt('Not sliced'), opt('Sliced')]},
  {'id': 'day-old-bread', 'name': 'Day old bread', 'min': 1, 'max': 1, 'options': [opt('House or rye sourdough'), opt('Hard red wheat', 1.0)]},
  {'id': 'peaks', 'name': 'Peaks roast', 'min': 1, 'max': 1, 'options': [opt("Baker's Brew", 2.0), opt('Trailblazer'), opt('Mountain Climber')]},
]
GROUPS = {g['id']: g for g in G}
for g in G: g['review'] = {'source': SRC, 'note': None}
GROUPS['milk']['review']['note'] = 'Oat and almond are $1.10 at every size in Toast. Set the 20 oz and hot/iced prices you want.'
GROUPS['syrup']['review']['note'] = 'Syrup prices are the same at every size in Toast. Set the size prices you want.'
def find_opt(name):
    n = name.lower()
    for gid in ['egg', 'protein', 'cheese', 'produce', 'sauce', 'spreads']:
        for o in GROUPS[gid]['options']:
            if o['name'].lower() == n: return gid, o['name']
    raise KeyError(name)
SANDWICH_GROUPS = ['toasting', 'bread', 'bagel-flavors', 'egg', 'protein', 'cheese', 'produce', 'sauce', 'spreads', 'kitchen-requests', 'allergy']
INCLUDED = {
  'The Colgate': ['egg', 'avocado', 'chipotle mayo', 'bacon', 'american', 'tomato'],
  'The Chipotle Potato': ['chipotle mayo', 'scrambled egg', 'pepper jack', 'hash brown', 'jalapenos'],
  'Maple New Day': ['maple syrup', 'butter', 'cheddar', 'egg', 'bacon'],
  'The Big Al': ['egg', 'roasted garlic cream cheese', 'onion jam', 'hash brown', 'sausage'],
  'Flosa Club': ['turkey', 'greens mix', 'tomato', 'bacon', 'red onions', 'pimento cheese'],
  'The Works': ['turkey', 'greens mix', 'swiss', 'red onions', 'calabrian mayo', 'tomato'],
  'Pimento Mori': ['pimento cheese', 'red onion parsley salad', 'avocado', 'tomato', 'greens mix', 'jalapenos'],
  'Joshua': ['red onions', 'chipotle mayo', 'scrambled egg', 'onion jam', 'ham', 'tomato', 'jalapenos'],
  'The Hamilton': ['greens mix', 'swiss', 'tomato', 'zhoug', 'red onion parsley salad', 'ham'],
  'BLT': ['tomato', 'mayo', 'bacon', 'greens mix'],
  'Tofu Kan': ['avocado', 'tomato', 'greens mix', 'cheddar', 'chipotle mayo', 'tofu kan'],
  'In The Know': ['bacon', 'scallion cream cheese'],
  'The Freddy': ['sausage', 'american', 'hash brown', 'mayo', 'double egg'],
  'The Zimmer': ['sausage', 'onion jam', 'mayo', 'tomato', 'scrambled egg', 'swiss'],
  'The Brittany': ['turkey', 'cheddar', 'red onions', 'tomato', 'greens mix'],
  'Say Uncle': ['sausage', 'pepper jack', 'jalapenos', 'calabrian pepper', 'egg'],
}
BAGEL_BASE = 1.90  # bagel price; Colgate $9.75 = $1.90 + its six ingredients

# ---------- Drinks: one item, priced by temperature and size ----------
V = lambda t, s, p: {'temp': t, 'size': s, 'price': p}
DRINKS = [  # name, section, versions, groups, reroute, note
  ('Latte', 'Popular drinks', [V('hot', '16 oz', 6.75), V('iced', '16 oz', 5.95), V('iced', '20 oz', 6.30)], ['milk', 'syrup', 'espresso', 'cold-foam', 'cup', 'drink-requests'], 'none', 'Hot price is from the website; Toast sales suggest it may be lower. Check it.'),
  ('Chai', 'Popular drinks', [V('hot', '16 oz', 5.75), V('iced', '16 oz', 5.95), V('iced', '20 oz', 6.20)], ['milk', 'syrup', 'espresso', 'cold-foam', 'cup', 'drink-requests'], 'iced', 'Hot price from the website.'),
  ('Matcha', 'Popular drinks', [V('hot', '16 oz', 4.50), V('iced', '16 oz', 4.30)], ['milk', 'syrup', 'cold-foam', 'cup', 'drink-requests'], 'none', 'Prices from the website.'),
  ('Mocha', 'Popular drinks', [V('hot', '16 oz', 7.30), V('iced', '16 oz', 5.95)], ['milk', 'syrup', 'espresso', 'cold-foam', 'cup', 'drink-requests'], 'none', 'In Toast, oat adds $0.55 hot but $1.60 iced. Set the milk prices you want.'),
  ('Cold Brew', 'Popular drinks', [V('iced', '16 oz', 5.25), V('iced', '20 oz', 5.75)], ['creamer', 'syrup', 'cold-foam', 'espresso', 'cup', 'drink-requests'], 'all', None),
  ('Drip Coffee', 'All other drinks', [V('hot', '8 oz', 2.00), V('hot', '12 oz', 2.80), V('hot', '16 oz', 3.25), V('hot', 'Refill', 1.70)], ['roast', 'creamer', 'syrup', 'cup', 'drink-requests'], 'none', None),
  ('Honeybee Iced Coffee', 'All other drinks', [V('iced', '16 oz', 4.30), V('iced', '20 oz', 4.60)], ['creamer', 'syrup', 'cold-foam', 'espresso', 'cup', 'drink-requests'], 'all', None),
  ('Americano', 'All other drinks', [V('hot', '16 oz', 3.80), V('iced', '16 oz', 4.60)], ['espresso', 'creamer', 'syrup', 'cold-foam', 'cup', 'drink-requests'], 'none', 'Prices from the website.'),
  ('Red Eye', 'All other drinks', [V('hot', '16 oz', 5.95), V('iced', '16 oz', 8.20), V('iced', '20 oz', 8.70)], ['creamer', 'syrup', 'cold-foam', 'cup', 'drink-requests'], 'none', None),
  ('Cappuccino', 'All other drinks', [V('hot', '12 oz', 5.10)], ['milk', 'syrup', 'espresso', 'cold-foam', 'cup', 'drink-requests'], 'none', 'Price and size from the website.'),
  ('Cortado', 'All other drinks', [V('hot', '', 4.60)], ['milk', 'syrup', 'espresso', 'cup'], 'none', None),
  ('Macchiato', 'All other drinks', [V('hot', '', 4.30)], ['milk', 'syrup', 'espresso', 'cup'], 'none', None),
  ('Espresso', 'All other drinks', [V('hot', 'Double', 3.50)], ['espresso', 'cup'], 'none', None),
  ('Chaider', 'All other drinks', [V('hot', '16 oz', 6.75), V('iced', '16 oz', 6.20), V('iced', '20 oz', 6.50)], ['espresso', 'cold-foam', 'cup', 'drink-requests'], 'none', None),
  ('Salted Maple Matcha', 'All other drinks', [V('hot', '16 oz', 4.75), V('iced', '16 oz', 5.80)], ['milk', 'espresso', 'cold-foam', 'syrup', 'cup', 'drink-requests'], 'none', None),
  ('London Fog / Mist', 'All other drinks', [V('hot', '16 oz', 4.30), V('iced', '16 oz', 4.30), V('iced', '20 oz', 4.60)], ['milk', 'syrup', 'cold-foam', 'cup', 'drink-requests'], 'none', 'Fog is hot, Mist is iced.'),
  ('Tea', 'All other drinks', [V('hot', '16 oz', 1.60), V('iced', '16 oz', 2.15), V('iced', '20 oz', 2.40)], ['tea', 'tea-extras', 'syrup', 'creamer', 'cold-foam', 'cup'], 'iced', 'Hot price from the website.'),
  ('Hot Chocolate', 'All other drinks', [V('hot', '16 oz', 3.80)], ['milk', 'espresso', 'syrup', 'cold-foam', 'cup', 'drink-requests'], 'none', 'In Toast, oat hot chocolate is $4.30 (+$0.50), not +$1.10.'),
  ('Chocolate Chai', 'All other drinks', [V('hot', '16 oz', 6.20), V('iced', '20 oz', 6.20)], ['cup'], 'none', None),
  ('Cider', 'All other drinks', [V('hot', '12 oz', 6.00), V('iced', '16 oz', 6.00)], ['cold-foam', 'cup'], 'none', None),
  ('Cafe Au Lait', 'All other drinks', [V('hot', '12 oz', 3.50), V('hot', '16 oz', 4.30)], ['milk', 'roast', 'syrup', 'cup'], 'none', None),
  ('Florentine / The Brooks', 'All other drinks', [V('hot', '12 oz', 4.60), V('hot', '16 oz', 5.40)], ['milk', 'roast', 'cup'], 'none', None),
  ('Lemonade', 'All other drinks', [V('iced', '', 3.80)], ['syrup', 'cup'], 'all', None),
  ('Matcha Lemonade', 'All other drinks', [V('iced', '', 4.90)], ['cup'], 'none', 'Estimated from Toast sales.'),
  ("Doctor's Orders", 'All other drinks', [V('hot', '', 5.00)], ['cup'], 'none', 'Estimated from Toast sales.'),
  ('Steamer', 'All other drinks', [V('hot', '', 2.50)], ['milk', 'syrup', 'cup'], 'none', 'Estimated from Toast sales.'),
  ('Kombucha on Tap', 'All other drinks', [V('iced', '', 8.75)], ['kombucha', 'cup'], 'all', 'Estimated from Toast sales ($8.11 before tax).'),
  ('Whole Milk 8 oz', 'All other drinks', [V('', '', 2.45)], ['cup'], 'none', 'Estimated from Toast sales.'),
  ('Ice Water 16 oz', 'All other drinks', [V('iced', '', 0.75)], [], 'none', 'Estimated from Toast sales.'),
]

# ---------- Everything else from the product mix ----------
pm = [r for r in csv.DictReader(open(PM)) if r['Item, open item'] and not r['Modifiers, special requests']]
SKIP_MENUS = {'Bulk Bagels and More', 'Gift card', 'Open items'}  # kiosk copies, gift cards and open items
SKIP_ITEMS = {'Build Your Own Sandwich'} | {x for x in INCLUDED}  # built below
DRINK_NAMES = {'Cold Brew', 'Iced Latte', 'Hot Latte', 'Iced Matcha', 'Hot Matcha', 'Hot Mocha', 'Iced Mocha', 'Iced Chai', 'Hot Chai', 'Drip Coffee', 'Honeybee Iced Coffee', 'Espresso Shot', 'Cappuccino', 'Macchiato', 'Cortado', 'Cafe Au Lait', 'Hot Chocolate', 'Hot Tea', 'Iced Tea', 'London Fog', 'London Mist', 'Lemonade', 'Kombucha on Tap', 'Steamer', "Doctor's Orders", 'Hot Americano', 'Iced Americano', 'Hot Red Eye', 'Iced Red Eye', 'Salted Maple Matcha', 'Chaider', 'Cider', 'F&S Kiosk Drip Coffee Mug', 'F&S Kiosk Drip To-Go', 'Matcha Lemonade', '16 oz Hot Chocolate Chai', 'Iced Chocolate Chai', 'Florentine / "The Brooks"', 'Whole Milk 8 oz', 'Ice Water 16 oz'}
CAT = {'Sandwiches': 'Sandwiches', 'Coffee Bar': 'Coffee Bar', 'Pastries + Breads': 'Pastries + Breads', 'Bulk Bagels': 'Bulk Bagels', 'Retail': 'Retail', 'Alcohol': 'Alcohol'}
SECTION = {'Sandwiches': 'Sandwiches', 'Sides': 'Sides', 'Cheat Codes/10 Yr Anniv': 'Cheat Codes', 'Pastries': 'Pastries', 'Breads': 'Breads', 'Bulk Bagels': 'Bagels', 'Beverages/Parfaits': 'Drinks and parfaits', 'Spreads': 'Spreads', 'Other Packaged Food Items': 'Packaged food', 'Merch': 'Merch', 'Beer': 'Beer', 'Wine': 'Wine', 'Cocktails': 'Cocktails'}
STATION = {'Sandwiches': 'kitchen', 'Coffee Bar': 'espresso'}
EXTRA = {  # name: (groups, base price override, note)
  'Donut': (['donut'], 1.50, 'Base estimated from Toast sales; the flavor adds $3.00 or $3.50.'),
  'House Sourdough': (['loaf'], None, None), 'Red Wheat Sourdough': (['loaf-slice'], None, None),
  'Day Old Bread': (['day-old-bread'], 5.00, None), 'Harney & Sons': (['harney'], 3.50, None),
  'Yerba Mate': (['yerba'], 5.95, None), 'Bai': (['soda'], 3.25, None), 'Adirondack Soda': (['soda'], 1.90, None),
  'Peaks Coffee': (['peaks'], 16.00, None),
}
DAYS = {'House Sourdough': [3, 4, 5, 6], 'Red Wheat Sourdough': [5, 6], 'Donut': [5, 6], 'Brioche Sandwich Rolls, half dozen': [3, 5]}
r05 = lambda x: round(round(x * 20) / 20, 2)
items, seen = [], set()
order = collections.Counter()
def add(it):
    if it['id'] in seen: return
    seen.add(it['id']); order[it['category'] + '|' + (it.get('section') or '')] += 1; it['sortOrder'] = order[it['category'] + '|' + (it.get('section') or '')]; items.append(it)
def base_item(name, category, section, price, groups=None, **kw):
    it = {'id': slug(name), 'name': name, 'description': '', 'category': category, 'section': section, 'station': STATION.get(category, 'none'),
          'visible': {'register': True, 'kiosk': True, 'online': True}, 'alcohol': category == 'Alcohol', 'eightySixed': False,
          'versions': [V('', '', price)], 'modifierGroupIds': groups or [], 'counts': [], 'reroute': 'none', 'taxable': False, 'active': True,
          'review': {'source': SRC, 'note': None}}
    it.update(kw); return it

# Sandwiches: bread + included ingredients set the price
for name, inc in INCLUDED.items():
    sec = 'Cheat Codes' if name in ('The Freddy', 'The Zimmer', 'The Brittany', 'Say Uncle') else 'Sandwiches'
    included = [dict(zip(('g', 'o'), find_opt(x)), q=1) for x in inc]
    total = BAGEL_BASE + sum(next(o['price'] for o in GROUPS[x['g']]['options'] if o['name'] == x['o']) for x in included)
    add(base_item(name, 'Sandwiches', sec, BAGEL_BASE, SANDWICH_GROUPS, included=included, taxable=True,
        required={'bread': True, 'bagel-flavors': True}, showWhen={'bagel-flavors': {'g': 'bread', 'o': 'Bagel'}},
        review={'source': SRC, 'note': f'Built from its ingredients: rings up at ${total:.2f} on a bagel. Check against your menu board.'}))
add(base_item('Build Your Own Sandwich', 'Sandwiches', 'Sandwiches', BAGEL_BASE, SANDWICH_GROUPS, taxable=True, sortOrder=0,
    required={'bread': True, 'bagel-flavors': True}, showWhen={'bagel-flavors': {'g': 'bread', 'o': 'Bagel'}},
    review={'source': SRC, 'note': 'Starts at $1.90 (the bagel) plus whatever is added. Check the starting price.'}))
items[-1]['sortOrder'] = 0
# Drinks
for name, sec, vers, groups, rr, note in DRINKS:
    add(base_item(name, 'Coffee Bar', sec, 0, groups, versions=vers, reroute=rr, taxable=True, review={'source': SRC, 'note': note}))
# Bulk bagels: one item priced by count
add(base_item('Bagels', 'Bulk Bagels', 'Bagels', 1.50, ['bagel-flavors', 'slicing'], required={'bagel-flavors': True},
    countPricing={'group': 'bagel-flavors', 'tiers': [{'qty': 6, 'name': 'Half dozen', 'price': 9.00}, {'qty': 12, 'name': 'Dozen', 'price': 18.00}]},
    review={'source': SRC, 'note': 'Replaces Single, Half Dozen and One Dozen (archived). Toast: single $1.50, half dozen $9.00, dozen $18.00. Change the dozen price if it should be a deal.'}))
for r in pm:
    name, menu, grp = r['Item, open item'], r['Menu'], r['Menu group']
    if menu in SKIP_MENUS or name in SKIP_ITEMS or name in DRINK_NAMES or float(r['Qty sold'] or 0) <= 0: continue
    if name in ('Single Bagel', 'Half Dozen Bagels', 'One Dozen Bagels'):
        p = {'Single Bagel': 1.50, 'Half Dozen Bagels': 9.00, 'One Dozen Bagels': 18.00}[name]
        add(base_item(name, 'Bulk Bagels', 'Bagels', p, ['bagel-flavors', 'slicing'], archived=True, review={'source': SRC, 'note': 'Archived: use the Bagels item instead.'})); continue
    cat = CAT[menu]; groups, over, note = EXTRA.get(name, ([], None, None))
    gross = float(r['Gross item amt'] or 0); tax = float(r['Tax amt'] or 0)
    taxable = cat in ('Sandwiches', 'Alcohol') or (gross > 0 and tax / gross > 0.04)
    # Toast reports taxable items before tax; your posted prices include it (Bai $3.01 in Toast = $3.25 posted).
    avg = float(r['Avg. price']); price = over if over is not None else r05(avg * 1.08 if taxable else avg)
    it = base_item(name, cat, SECTION.get(grp, grp), price, groups, taxable=taxable, review={'source': SRC, 'note': note or (f"Toast showed ${avg:.2f} before tax; this is that price with tax included." if taxable and over is None else None)})
    if name in DAYS: it['days'] = DAYS[name]
    add(it)

settings = {
  'categories': ['Sandwiches', 'Coffee Bar', 'Pastries + Breads', 'Bulk Bagels', 'Retail', 'Alcohol'],
  'sections': {'Sandwiches': ['Sandwiches', 'Cheat Codes', 'Sides'], 'Coffee Bar': ['Popular drinks', 'All other drinks'], 'Pastries + Breads': ['Pastries', 'Breads'],
               'Bulk Bagels': ['Bagels'], 'Retail': ['Drinks and parfaits', 'Spreads', 'Packaged food', 'Merch'], 'Alcohol': ['Beer', 'Wine', 'Cocktails']},
  'sizes': ['8 oz', '12 oz', '16 oz', '20 oz', 'Double', 'Refill'], 'priceCols': PRICE_COLS,
  'surchargeRate': 0.03, 'surchargeChannels': {'register': True, 'kiosk': False, 'online': False}, 'taxRate': 0.08,
  'preMods': ['No', 'Light', 'Extra', 'On the side'],
  'discounts': [{'name': 'Comp', 'type': 'percent', 'value': 100}, {'name': 'Donation', 'type': 'percent', 'value': 100}, {'name': 'Bagel token', 'type': 'amount', 'value': 1.5}, {'name': 'Pastry token', 'type': 'amount', 'value': 3.0}],
  'noNameCategories': ['Bulk Bagels', 'Pastries + Breads', 'Retail'],
  'kioskHideCategories': ['Sandwiches', 'Alcohol'],
  'favorites': ['build-your-own-sandwich', 'the-colgate', 'latte', 'the-chipotle-potato', 'maple-new-day', 'drip-coffee', 'cold-brew', 'chai'],
  'categoryColors': {'Sandwiches': '#e8a33d', 'Coffee Bar': '#8b5e3c', 'Pastries + Breads': '#d9774b', 'Bulk Bagels': '#c9a227', 'Retail': '#5b8a72', 'Alcohol': '#7a4f9a'},
}
json.dump({'_about': 'Built from Toast product mix (Sep 30–Oct 31, 2026) and modifier selections (Oct 11–Nov 7, 2026). Items marked review need a look.', 'settings': settings, 'modifierGroups': G, 'items': items}, open(OUT, 'w'), indent=1)
cats = collections.Counter(i['category'] for i in items if not i.get('archived'))
print(len(items), 'items', dict(cats), len(G), 'groups')
print('review notes:', sum(1 for i in items if i['review']['note']))
