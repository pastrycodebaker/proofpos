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
