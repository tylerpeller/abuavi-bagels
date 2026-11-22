# Brand: Abu Avi Bagels

Instagram @abuavibagels, 1,354 followers. WhatsApp group ~400.
Source: profile screenshot, Sep 2026. Colours sampled directly from the image.

## Bio (verbatim)
    Artisan bagels 🥯
    Hand-rolled. Cold-proofed. Fresh in Tel Aviv ☀️
    Turn on notifications for weekly drops!

## Logo
Circular badge. Cream interior, black outer ring with dotted inner border.
Arched "ABU AVI BAGELS" across the top, rounded slab/serif, all caps.
Centre: bearded man in white chef's hat and white tee, bagel in one hand, brown
"I ❤️ NY" paper bag in the other. Flat vector, black linework, warm fill.

NEEDED FROM HIM: the source file. A circular badge at favicon size needs vector.
If raster only, it works as a header mark at 48px+; build a simplified bagel-only
glyph for the favicon.

## Palette (sampled from his own images)

| Role | Hex |
|---|---|
| Surface / paper | #FAF6EF |
| Card / raised | #FFFDFA |
| Ink | #1C1815 |
| Primary (brand) | #B3793A |
| Crust mid | #AD7143 |
| Gold accent | #D8B157 |
| Deep brown (CTA fill) | #6B3F1D |
| Slate (sold out / disabled) | #586D6F |

Cream surface, ink text, deep brown for the primary CTA (gold on cream fails contrast
for buttons), gold for badges and the live "N left" pill, slate for sold-out and
disabled states. Slate is the only cool tone in his entire feed, which makes it the
natural "unavailable" colour.

## Type
- Display: heavy condensed sans, all caps, tight tracking. His ORDERS NOW OPEN
  graphics use white caps with a hard dark drop shadow on an arch. Keep the weight
  and the caps for headers; do not reproduce the arch or shadow in UI chrome.
- Body: clean geometric or humanist sans, generous line height.
- Numerals: tabular, for prices, counts and the live remaining badge.

## Voice
Clipped declarative fragments separated by periods. At most one emoji per line,
usually at the end. All caps for announcements. No slang.

    Hand-rolled. Cold-proofed. Fresh in Tel Aviv ☀️

HE ALREADY HAS AN ANNOUNCEMENT TEMPLATE. USE HIS:

    ORDERS NOW OPEN
    SEP 7 - 9
    LINK IN BIO

Short, factual, confident. Not "Your order has been successfully confirmed!"

## Language: ENGLISH ONLY
Bio, every graphic, and the logo's "I ❤️ NY" bag are English. Anglo-in-Tel-Aviv
brand, English-reading audience. Build i18n scaffolding and keep RTL planned, but
ship English only until he asks for Hebrew.

## Photography
Overhead and close three-quarter. Bagels on cooling racks, plates, piled in trays.
Natural light, warm tones, home-kitchen backgrounds.

GAP: his existing shots are batch shots (many bagels). A product grid needs one clean
hero per variety, same surface, same light. Half an hour of his time. This is what
makes the grid look deliberate rather than scraped.

## Content he already has
- An FAQ post, pinned in the grid. Port that copy verbatim. Do not write new FAQ text.
- Drop announcement graphics. The share card should match their look.

## Menu — NEEDED FROM HIM
| Name | Price ₪ | Notes |
|---|---|---|
| | | |
Chocolate chip confirmed from the grid. Sesame, poppy, everything visible in batch
shots but not confirmed as named SKUs.

---

## Implementation notes (this build)

- `web/src/theme.css` defines the full palette above as CSS custom properties
  (`--surface`, `--card`, `--ink`, `--primary`, `--crust`, `--gold`, `--cta`,
  `--slate`) plus the display/body font stack, so the whole app reads from one
  source of truth. Dark mode was not part of the spec and isn't implemented —
  the surface is cream by design, matching his feed.
- Display type uses Archivo Black (a heavy grotesque, all-caps via CSS
  `text-transform`) as a stand-in for his exact drop-shadow arch lettering,
  which is a hand-built graphic effect, not a font — see the note under Type
  above about not reproducing the arch/shadow in UI chrome.
- `web/src/components/Logo.tsx` is a simplified placeholder glyph (concentric
  circles + dotted ring), not the real badge — swap it the moment he sends a
  vector source. It's used at header size (40px) everywhere; no favicon has
  been generated from it since the real mark is still needed.
- English only, no i18n scaffolding built yet (the spec says to plan for RTL
  but ship English-only — scaffolding was deprioritized in favor of the
  ordering flow itself; revisit if/when he asks for Hebrew).
- `db/seed.sql` ships a **placeholder menu** (Plain, Sesame, Everything, Poppy,
  Chocolate Chip) with placeholder prices — replace via the admin menu manager
  once he sends real names/prices.
- FAQ copy in `web/src/components/Faq.tsx` is explicitly placeholder text, not
  his real pinned post — the component's header comment flags this; port his
  actual copy in verbatim before shipping.
- No product photography exists yet, so the menu grid falls back to a solid
  gold/crust gradient tile per item (`.photo-fallback` in `app.css`) until his
  hero shots land — upload through the admin menu manager's photo field, which
  stores to R2 and serves from `/photos/:key`.
