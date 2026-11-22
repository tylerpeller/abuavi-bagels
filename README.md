# Abu Avi Bagels: drop ordering

A small ordering site for weekly bagel drops. Buyers pick flavours from the menu (up to the per-order max), add a name and phone, and the order button unlocks the moment the drop opens. The owner plans drops and tracks orders from `/admin`. Each drop closes on its own when it sells out.

## How it holds up under a rush

- **One Durable Object (`DropGatekeeper`) owns every drop and order.** It handles requests one at a time, and each capacity check runs synchronously right before its insert. That makes overselling impossible, even with a thousand phones tapping at the same second.
- **Late carts are gated server-side.** An order sent after the tray empties gets `sold_out`. An order that asks for more than what's left gets `only_left`, and the page offers the remainder in one tap.
- **Retries are safe.** Every order carries an idempotency key, so a flaky connection that resends never double-orders.
- **One active order per phone per drop.** There's also a honeypot field and a per-IP rate limit.
- **The live count is pushed over WebSocket** (hibernation API), with polling as a fallback. Cancellations put bagels back on the tray for everyone watching.
- **Countdowns use the server clock**, so a phone with the wrong time can't unlock early. An order sent a hair early waits and resends itself automatically.

## Run it

```bash
npm install
npm run build:web
npx wrangler dev          # http://localhost:8787, admin at /admin
```

For UI work with hot reload, run `npx wrangler dev` and `npm run dev:web` side by side.

## Deploy (Cloudflare Workers Builds)

`wrangler.toml` has a `[build]` step, so the default deploy command `npx wrangler deploy` builds the page first. No custom build command is needed.

Set these secrets on the worker:

| Secret | Needed | What it does |
|---|---|---|
| `ADMIN_TOKEN` | yes | Passcode for `/admin` |
| `RESEND_API_KEY` | no | Turns on confirmation emails |
| `EMAIL_FROM` | no | Sender, e.g. `Abu Avi Bagels <orders@your-domain>` (domain verified in Resend) |

## Owner guide

1. Go to `/admin`, enter the passcode, then **New drop**. Fill in the pickup day, time and spot, when orders open, and how many bagels. Repeat settings carry over from the last drop.
2. **Menu** holds the flavours every drop sells. Set a flavour's add-on price (Jalapeño Cheddar +3), cap it per drop, or switch it off.
3. Inside a drop, **To bake** shows how many of each flavour to make.
4. **Copy post text** gives the Instagram/WhatsApp announcement with the link.
5. During pickup, tap **Paid** and **Picked up** on each order. Tap a phone number to open WhatsApp.
6. **Close orders now** stops a drop early. **Add order** covers DMs and phone orders, and it can go over the cap.
7. **Download CSV** exports the order list.

## Code

```
src/index.ts      Worker: admin auth, routes /api/* to the shop object, serves the page
src/shop.ts       DropGatekeeper: drops, orders, capacity, live updates
src/email.ts      optional Resend confirmation
web/src/shop      order page, live tray, pickup ticket
web/src/admin     drop control
```

## Later

- WhatsApp confirmations need the WhatsApp Business Cloud API (a business number with a verified sender). The send would sit beside `email.ts`.
