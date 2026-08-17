# Harley Street Wellness — store

An e-commerce store with a Postgres database, basket, Stripe checkout,
customer accounts and an admin panel. Self-hosted on a DigitalOcean droplet.

Server-rendered. No build step, no ORM, no client-side framework.

---

## Run it locally

```bash
npm install
npm run migrate
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long password' npm run seed
npm run dev
```

Then open <http://localhost:3000>. The admin panel is at `/admin`.

You do **not** need to install Postgres to develop. With no `DATABASE_URL`
set, the app runs on [PGlite](https://pglite.dev) — Postgres compiled to
WebAssembly — persisted to `.data/pglite`. The same SQL and the same
migrations run against a real Postgres server in production.

```bash
npm test          # 169 tests, no external services required
```

---

## Deploying

See **[`deploy/DEPLOY.md`](deploy/DEPLOY.md)** for a fresh Ubuntu 24.04 droplet
end to end: user, firewall, Node, Postgres, environment, PM2, nginx, certbot,
Stripe webhook, and backups.

Updating an existing droplet:

```bash
cd /srv/hsw && git pull && npm ci --omit=dev && npm run migrate && pm2 reload hsw
```

---

## How it fits together

```
Internet
  │
  └─ nginx :443            TLS, static files, security headers
       │
       └─ PM2 → node :3000  Express 5 + Nunjucks
            │
            └─ Postgres :5432   bound to 127.0.0.1 only
```

```
server.js       entry point; app.js holds everything of substance
config.js       env parsing and validation, fails fast on bad config
db/             two-driver query layer, migrations, seed data
lib/            cart, auth, csrf, money, sanitize, stripe, uploads, sessions
models/         all SQL lives here; routes never write queries inline
routes/         one module per URL family
views/          Nunjucks templates; layout.njk carries the site chrome
public/         css, js, uploaded images
test/           integration tests via supertest
deploy/         DEPLOY.md, nginx config, PM2 config
```

### Three things worth knowing

**Money is integer pence, everywhere.** No floats reach the database, the
templates, or Stripe. Pounds are parsed at the admin form boundary and
formatted at the template boundary; in between, everything is an integer.

**The basket holds product IDs and quantities, and nothing else.** Every
price, name and total is recomputed from the database on every request. A
customer who edits their session or the form cannot change what they are
charged, because the price they submit is never read.

**An order becomes `paid` only via a signature-verified Stripe webhook.** The
redirect back from Stripe renders a page and sets no state — a customer who
lands on the success URL before the webhook arrives sees "processing", not
"paid". The admin panel deliberately cannot set "paid" either, so this shop's
records and Stripe's can never disagree about who has been charged.

### Story blocks

Product pages are not fixed templates. Each product carries an ordered JSONB
array of typed content blocks — `split`, `steps`, `facts`, `gallery`, `faq`,
`prose` — rendered by one template. That is how the original bespoke Urolithin
A page (seed-field animation, Supplement Facts panel, FAQ accordion) survives
as database content you can edit, rather than as HTML you have to open an
editor to change.

Blocks are edited as JSON in the admin panel and **sanitised on save**: an
allow-list of `em`, `strong`, `br`, `span class="gold"` and links survives;
everything else is escaped.

---

## ⚠️ Not ready to sell

Three blockers, none of them engineering work:

| # | Blocker | Why it matters |
|---|---|---|
| 1 | **Per-ingredient mg amounts** | The Supplement Facts panel is the centrepiece of the Urolithin A page and still reads `TBD` five times. |
| 2 | **NAD+ precursor identity (NR vs NMN)** | If it is NMN, this may not be lawfully sellable in the UK. NR carries a pre-Brexit EU authorisation; NMN does not. |
| 3 | **FSA novel-food status** | Urolithin A and PQQ both need checking against the GB novel foods register before launch. |

Two safeguards are built into the code so none of this can go live by
accident:

- **Every seeded product is flagged `is_placeholder`**, which renders a visible
  gold "not for sale" notice, blocks add-to-basket, omits the product from
  `sitemap.xml`, and publishes no `offers` in its structured data. Clear the
  flag per product in the admin panel once the real details are in.
- **`robots.txt` blocks all indexing.** Deliberate — replace it with the "AT
  LAUNCH" block inside the file when you are ready.

### Still marked TBD

- Per-ingredient mg amounts, and the NAD+ precursor's name
- Capsule format — **unverified**; listings say *softgels*, which are typically
  gelatin. Do not publish "vegetarian capsule" without confirming.
- Third-party testing and batch COA
- Company number, registered address, VAT number, carrier, returns address
  (in `/terms`, `/privacy`, `/shipping-returns`)
- Product photography — the gallery block falls back to labelled empty slots

---

## Claims policy

All copy is written as description of *published research findings*, not as
health claims made for the product.

Because this sells under a medical clinic's name, the bar is **higher, not
lower** — the ASA and MHRA treat claims made under clinical authority more
strictly. Before adding any benefit claim ("boosts energy", "antioxidant
protection", "anti-ageing"), check the GB Nutrition & Health Claims Register.

---

## Brand tokens

Extracted verbatim from the original `index.html` into `public/css/hsw.css`.

| Token | Light | Dark |
|---|---|---|
| Background | `#FFFFFF` | `#050505` |
| Background alt | `#F8F8F8` | `#0A0A0A` |
| Text primary | `#1A1A1A` | `#FFFFFF` |
| Text secondary | `#4A4A4A` | `#9CA3AF` |
| Border | `#E5E5E5` | `rgba(255,255,255,.10)` |
| Gold accent | `#D4AF37` | `#D4AF37` |

**Display:** Playfair Display 400 · **UI/body:** Montserrat 300–600
**Buttons:** 0px radius, 16px/32px padding, 600 weight, 1.6px letter-spacing

Dark theme uses the same `.dark` class convention as the main clinic site, so
it drops in without translation. The preference persists to `localStorage`
under `hsw-theme`, and the switch runs before first paint so there is no flash.

`public/css/shop.css` adds the components the single-page build never needed —
product grid, basket, forms, order tables, admin — written in the same idiom
and introducing no new tokens.

---

## Design and implementation notes

- [`docs/superpowers/specs/2026-08-17-hsw-store-design.md`](docs/superpowers/specs/2026-08-17-hsw-store-design.md)
- [`docs/superpowers/plans/2026-08-17-hsw-store.md`](docs/superpowers/plans/2026-08-17-hsw-store.md)
