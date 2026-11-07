# Proof POS

Flour & Salt's own point of sale and kitchen display system, built to replace Toast. Sister app to Proof Box, with payments through Stripe.

The full spec lives in the "Flour & Salt POS + KDS Spec" doc. This repo holds the code.

## What's here now

| Path | What it is |
| --- | --- |
| `prototype/kds.html` | Working KDS prototype with fake orders: Espresso bar, Kitchen 1, Kitchen 2 and Runner screens, item bumps, rush, recall, edit, timers, color coding and live production counts. Open it in any browser. No backend yet; data stays in that browser. |
| `data/menu.json` | 127 menu items built from the Toast Product Mix (Sep 30 to Oct 31, 2026), with group, October quantity sold, a first guess at station routing, and kiosk/online visibility. |

### menu.json needs a hand review

- `price` is blank on purpose. Toast's average price includes modifier upcharges and discounts, so it isn't the base price. Real prices get entered by hand.
- `station` is a guess by menu: Sandwiches go to kitchen, Coffee Bar and Alcohol to espresso, everything else is grab-and-go for the runner.
- `modifierGroups` and `counts` (production counts like eggs or shots) are empty. The Toast export had no modifier data.
- Alcohol items are hidden from kiosk and online.

## Stripe plan

| Piece | Stripe product | How |
| --- | --- | --- |
| Register and kiosk card payments | Terminal (S700 smart readers) | PaymentIntents with `payment_method_types: ['card_present']`, server-driven reader integration. Collect the card first, check whether it's credit or debit, add the credit card surcharge if credit, then confirm. |
| Online ordering | Checkout Sessions + Payment Element | Confirmation Tokens let us see the card type before charging, which the surcharge needs. |
| Phone orders | Checkout Session link texted to the customer | Cheaper than keyed-in cards and keeps card numbers out of staff hands. |
| Firing online and phone orders to the KDS | Webhooks (required) | An order only goes to the kitchen once Stripe's webhook confirms payment, never from the "thank you" page. Signatures are always verified. |
| Catering, Colgate and wholesale bills | Invoicing | Usable from the Stripe Dashboard right away; connect to the POS later. |
| Sales tax | Our own tax categories, probably not Stripe Tax | One location in one tax jurisdiction. Stripe Tax is built for selling across many jurisdictions. Tax categories per item to be confirmed with Andrew. |

Latest Stripe API version per Stripe's guide: `2026-10-28.endive`. Node SDK 23.

### Keys and security

- Build in a Stripe **sandbox**, not the account's live mode.
- Use a **restricted API key** (`rk_test_...`) with only the permissions the POS needs, not the full secret key.
- Keys **never** go in this repo or in chat. The key goes in Firebase's secret storage (`firebase functions:secrets:set STRIPE_KEY`) and only the server code reads it.
- Firebase Functions need the Blaze (pay-as-you-go) plan to call Stripe.
- The publishable key (`pk_test_...`) is safe to put in front-end code.

## Next steps

1. Review the prototype on a tablet and note what to change.
2. Set real prices, modifiers, station routing and production counts in the menu.
3. Stripe: create a sandbox and a restricted key, store it in Firebase secrets.
4. Move tickets from the prototype's local storage into Firebase so every screen shares them.
5. Register screen with Stripe Terminal in test mode, using a simulated reader.

## Menu editor

`admin/menu.html` — sign in with a Firebase Authentication user. Add `?demo` to the URL to try it without signing in (nothing is saved).

- Items: name, category, station, where it shows (register, kiosk, online), alcohol, 86, price, modifier groups, production counts.
- Drinks use a hot/iced × size grid instead of separate items per size. Blank cells mean that version isn't sold. The credit card price shows under each.
- Modifier groups: each option is a flat price or priced by size, and can add to a production count.
- Spreadsheet: every item in one editable table, with a price column for single-price items and a column per size (Hot 12 oz, Iced 20 oz…). Filter by category, search, or show only items missing a price; Enter jumps down the column. Tick rows to move category, set station, add or remove a modifier group, show/hide on register/kiosk/online, change prices (+0.25 or 5%), 86, duplicate or delete. Nothing saves until "Save changes". "Modifier prices" switches to every add-on, flat or by size. Download CSV / Upload CSV round-trips the menu through Google Sheets or Excel (matches rows by id, then name; new names become new items).
- Duplicate button on each item page.
- Settings: sizes, credit card surcharge rate, category order, and the starter menu (`data/seed-menu.json`).
- Data lives in Firestore under `menu/main` (settings), `menu/main/items`, `menu/main/modifierGroups`.

## Live KDS

`kds/index.html` — sign in once per screen; it stays signed in. Pick the station (Espresso bar, Kitchen 1, Kitchen 2, Runner); each screen remembers its choice. Add `?demo` to try it without signing in.

- Reads the real menu from the menu editor: stations, sizes (shown as "Iced 20 oz Latte"), modifiers and production counts.
- Tickets live in Firestore `orders/{id}`, shared by every screen. Each item is stored under `lines.<id>` and updated field by field, so bumps work offline (they sync when wifi returns) and two stations never overwrite each other.
- Order numbers count up from 101 each day (`counters/orders-YYYY-MM-DD`). An order rung in while offline gets a temporary number starting with T.
- Timing color thresholds are shared in `settings/kds`.
- "Test register" rings in orders from the real menu until the real register is built.
- Completed items show a gray check (no strikethrough). Modifiers stack one per line, in the order set on the item in the menu editor.
- "Show done" shows tickets finished in the last 30 minutes, each with a "Bring back" button; tap again to hide them.
- "86" lets any station 86 an item or bring it back. It comes off the register, kiosk and online right away (`menu/main/items/{id}.eightySixed`).
- "Weekend reroute" (shared, `settings/kds.reroute`) sends drinks marked in the menu editor (all versions or iced only) to the runner instead of the espresso bar, with a banner on the espresso and runner screens. It applies to orders rung in while it's on.

### Added Nov 2

- **Online ordering switch** on every KDS (`menu/status.onlinePaused`, readable by the future online ordering page). A red banner shows on all screens while it's off.
- **86'd items stay ringable** on the test register: grayed out with "86'd", still addable.
- **Modifier multiples**: tap an add-on again for 2×, 3×; "−" takes one away. Tickets show "2× Bacon" and production counts multiply.
- **Hotplate (paid)** order source for special orders.
- **Scheduled orders**: "Schedule for later" on the test register. The order waits in Upcoming (header button) and appears on the KDS at its time, marked "Scheduled". Orders are now queried by `fireAtMs`.
- **Counted inventory**: set a count on the KDS 86 screen or in the menu editor (`stockCount`). Each order takes from it, edits put it back, and the item 86s itself at zero. Entering a new count above zero brings it back.

## Register

`register/index.html` — full-screen register in Toast's Open View style, with less on screen. Sign the register in once with the shop account; staff then sign in with their code (Settings → Register sign-in) and it locks after the idle time. Add `?demo` to try it without signing in (code 1234).

- Order on the left, categories and items on the right. 86'd items are grayed out but can still be rung.
- Tapping an item opens all of its choices at once. Size/temperature is the first column on drinks. Required groups show a red ✕ until picked; "Add to order" stays off until they are.
- Tap a modifier again for 2×, "−" for one less. "Light, extra…" on a picked modifier offers pre-mods (No, Light, Extra, On the side) and styles (over easy…), so they only appear when needed.
- Modifier counts (bagel flavors, breads) show on the buttons, drop with each order, and gray out at zero (`menu/modStock`).
- Orders made only of items from the "no name needed" categories (Settings; default Bagels, Pastries and bread, Retail, Bulk Bagels and More) skip the name prompt.
- Stay sends what's rung so far to the KDS and keeps the order open. Pay asks for the name, then cash (quick-cash buttons, change due), card (test mode until Stripe), Gate Card, Chamber Gift Card or Hotplate. Split across methods by entering an amount first.
- ⋮: tax exempt (Colgate), schedule, open item, no sale (logged), void (before payment), discounts from Settings.
- Press and hold any item or modifier to edit its stock: In stock, Out of stock, or set a count (it goes out of stock by itself at zero).
- Cup group: To go cup +$0.30 pre-selected; Customer cup and For here are hidden on kiosk and online.

## Built-from items (BLT-style pricing)
On an item, turn on the shared groups (bread, protein, produce, sauces), then tap the ingredients that come on it under "Built from". They're saved as `item.included = [{g, o, q}]`.
- Register: included ingredients start selected and add their price. Tapping one off ("No tomato") drops its price; extras add on top.
- Check and KDS: only changes show (bread pick, "No Tomato", "+ Avocado", "Light Mayo"). Lines carry `mods[].inc` and `noMods`.
- One price per ingredient: changing bacon's price reprices every sandwich built with it.

## Layout, sections, days and seasons
- Menu editor → **Layout**: drag categories (register button order), add sections per category (`settings.sections = {Category: [names]}`), drag items between section columns and reorder (`item.section`, `item.sortOrder`). Tap an item for its days (`item.days`, JS weekday numbers; null = every open day) and season (`item.active === false` hides it everywhere).
- Register shows sections as columns (items without a section go in "More"), grays items not offered today (still ringable), hides off-season items.
- Settings → "Set bake days" fills in sourdough, red wheat, donuts and brioche.

## Tax
Prices are tax-inclusive. The check shows "Includes tax" (taxable × rate ÷ (1 + rate)); tax exempt removes that amount from the total.

## KDS
Removed items never show on tickets.

## Integrations plan (Proof Box ↔ Proof POS ↔ ProofBooks) — not built yet
Proof Box lives in Firebase project `flour-and-salt-orders`; Proof POS in `proofpos-90500`. Plan: each app opens a second, read-mostly Firebase connection to the other, matched by a shared item id.
1. **Production plan → counts.** Proof Box's daily production plan writes planned quantities to POS `stockCount` (items) and `menu/modStock` (bread modifiers) for that day. Bakers confirm or adjust each morning; the register and KDS already 86 at zero.
2. **Menu ↔ recipe book.** Each POS item links to a Proof Box recipe (`item.recipeId`). Proof Box shows the live POS sale price (cash and credit) next to recipe cost, so food cost % is always current; price changes made in either place update the other.
3. **Food cost reporting.** POS sales × recipe cost per item (and per modifier ingredient for built sandwiches) → food cost by item, category and day; totals flow to ProofBooks.

## Start page, kiosk and owner sign-ins
- `/` is the start page: staff pick what the tablet is (register, kiosk, a KDS station, menu editor). "Open automatically next time" remembers it on that tablet; `/?pick` always shows the choices. Register and KDS have a "Switch screen" button.
- `/kiosk/` is the customer express line: no sandwiches or alcohol (`settings.kioskHideCategories`, default Sandwiches and Beer, wine and cocktails, plus each item's kiosk visibility), sold-out and not-today items disabled, name and tip at checkout, card in test mode until Stripe is connected. Returns to the welcome screen after 90 seconds idle. The small "Staff" button takes any staff code and goes to the start page.
- Kiosk drinks pause: "Kiosk drinks" on the register and every KDS sets `menu/status.kioskDrinksPausedUntil` to 10 minutes from now; the kiosk disables made-to-order drinks (espresso station or Coffee and drinks) until then. Bottled drinks stay on. Online ordering has its own switch.
- Owner sign-ins (menu editor → Settings): emails in `settings/owners`. Firestore rules let only owners change the menu, prices, settings, staff codes and the owner list; other signed-in tablets can ring orders, 86 and change counts. Until the list has an email, every signed-in tablet counts as an owner.
- Register shows a red banner when it's offline.

## Card payments (Stripe Terminal, server-driven)
- `netlify/functions/stripe.mjs` holds all Stripe calls; the key is the Netlify env var `STRIPE_SECRET_KEY` (restricted: PaymentIntents, Charges and Refunds, Terminal = Write). Calls must carry a Proof POS Firebase sign-in token.
- Flow: create PaymentIntent → reader collects the card (tip on the reader at the register, 18/20/22%; the kiosk asks for tip on screen) → we read credit vs debit → add 3% for credit, capped at 2.7% + 5¢ → reader confirms.
- `payments.js` is the shared client. With a test key, the first payment creates the "Flour & Salt" location and a simulated S700; the register and kiosk show "pretend the customer…" buttons. Each tablet can use a specific reader via `localStorage['proof.reader']`.
- Before going live: check Stripe's US surcharging requirements for Terminal (customer notice on the reader).
