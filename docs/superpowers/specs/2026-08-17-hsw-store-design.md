# Harley Street Wellness — e-commerce store

**Date:** 2026-08-17
**Status:** Approved
**Supersedes:** the single static `index.html` product page

---

## 1. Purpose

Turn a single static product page into a working e-commerce store with a
database, cart, real card checkout, customer accounts and an admin panel —
self-hosted on a DigitalOcean droplet.

### Success criteria

1. A visitor can browse a catalogue, add items to a basket, and pay by card.
2. An order is recorded in Postgres and marked paid only by a verified Stripe
   webhook.
3. The operator can create, edit, publish and unpublish products, upload
   product images, and view orders — without editing code.
4. The existing Urolithin A page renders from the database, visually
   unchanged.
5. Deployment to a fresh Ubuntu droplet is a documented, repeatable procedure.

### Out of scope for v1

Explicitly excluded, not deferred-and-half-built:

- Transactional email (order confirmations, shipping notices)
- Discount and promo codes
- Stock / inventory tracking
- Product reviews, wishlists, search
- Subscriptions or recurring billing
- IV drip appointment booking
- Multi-currency (GBP only)

---

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 24 | Already installed; long support |
| Server | Express 5 | Smallest thing that does the job |
| Templates | Nunjucks | Existing HTML ports near-verbatim; no build step |
| Database | Postgres 16 | Relational data, JSONB for story blocks |
| DB driver | `pg` (prod) / `@electric-sql/pglite` (dev+test) | See section 3.1 |
| Payments | Stripe Checkout (hosted) + webhooks | Card data never touches the droplet |
| Sessions | `express-session` + custom Postgres store | Works on both drivers |
| Validation | `zod` | One schema per POST body |
| Passwords | `bcrypt` | Standard |
| Uploads | `multer` to disk, served by nginx | Droplet has persistent disk |
| Process | PM2 | Restart on crash, restart on boot |
| TLS / proxy | nginx + certbot | Standard |
| Tests | `node:test` + `supertest` | Built in, no framework |

No build step. No ORM. No client-side framework. Updating in production is
`git pull && npm ci && npm run migrate && pm2 reload hsw`.

`vercel.json` is deleted — its security headers move into `helmet` and the
nginx config.

### 2.1 Rejected alternatives

- **Next.js + Prisma** — would require porting 900 lines of hand-written HTML
  into JSX and adds a build step to every deploy. The design is the most
  valuable existing asset; a near-verbatim template port risks it least.
- **PHP + MySQL** — cheaper to host but more of the cart/checkout would be
  written from scratch.

---

## 3. Architecture

```
Internet
  |
  +- nginx :443            TLS (certbot), static /public, security headers,
       |                   client_max_body_size for uploads
       +- PM2 -> node :3000  Express app
            +- Postgres :5432   bound to 127.0.0.1 only
```

### 3.1 The two-driver database layer

The development machine has neither Postgres nor Docker. Rather than make a
local Postgres install a prerequisite, `db/index.js` exposes a single
interface:

```js
query(text, params)  // -> { rows }
withTransaction(fn)  // -> fn(client)
```

backed by either driver:

- `DATABASE_URL` set: `pg.Pool` against real Postgres (production, staging)
- otherwise: `@electric-sql/pglite` persisted to `.data/pglite` (dev, test)

PGlite *is* Postgres compiled to WebAssembly, so SQL, types and JSONB
behaviour match. The same numbered `.sql` migrations run against both. This
keeps `npm test` and `npm run dev` working with zero external services while
production runs a normal Postgres server.

Consequence: no `connect-pg-simple`. The session store is a small custom
`express-session` Store written against `query()`, so it works on both
drivers.

### 3.2 Layout

```
server.js                 entry: config, middleware, mount routes, listen
config.js                 env parsing + validation, fails fast on bad config
db/
  index.js                driver selection, query(), withTransaction()
  migrate.js              runs db/migrations/*.sql in order, tracked in schema_migrations
  migrations/*.sql        numbered, forward-only
  seed.js                 placeholder catalogue + admin user
lib/
  session-store.js        express-session Store over query()
  csrf.js                 double-submit token middleware
  money.js                pence <-> display formatting
  cart.js                 cart read/write/total, always re-prices from DB
  auth.js                 requireUser / requireAdmin / hashing
  stripe.js               client factory, checkout session, webhook verify
  validate.js             zod helper -> 400 with field errors
  sanitize.js             inline-HTML allow-list for story blocks
models/
  products.js  orders.js  users.js  categories.js
routes/
  shop.js  cart.js  checkout.js  webhook.js  account.js  admin.js  legal.js
views/
  layout.njk  partials/  shop/  account/  admin/  legal/
public/
  css/hsw.css             extracted from index.html, tokens untouched
  js/                     theme toggle, seedfield animation, accordion
  uploads/                product images (gitignored)
test/
  *.test.js               integration tests via supertest
deploy/
  nginx.conf.example  ecosystem.config.js  DEPLOY.md
```

Each route module owns one URL family and one concern. Models own SQL; routes
never write SQL inline.

---

## 4. Data model

All money is **integer pence**. No floats anywhere, including in JSON.

```sql
categories(id, slug UNIQUE, name, sort)

products(id, slug UNIQUE, name, subtitle, category_id FK,
         price_pence INT NOT NULL CHECK (price_pence >= 0),
         summary TEXT,
         story_blocks JSONB NOT NULL DEFAULT '[]',
         meta_description TEXT,
         is_published BOOL DEFAULT false,
         is_placeholder BOOL DEFAULT true,
         created_at, updated_at)

product_images(id, product_id FK CASCADE, path, alt, sort)

users(id, email UNIQUE, password_hash, name,
      is_admin BOOL DEFAULT false, created_at)

sessions(sid PK, sess JSONB, expire TIMESTAMPTZ)

orders(id, public_token UNIQUE,            -- unguessable, used in URLs
       user_id FK NULL,                    -- null for guest orders
       email, status,                      -- pending|paid|shipped|cancelled|refunded
       subtotal_pence, shipping_pence, total_pence,
       ship_name, ship_line1, ship_line2, ship_city, ship_postcode, ship_country,
       stripe_session_id, stripe_payment_intent,
       created_at, paid_at)

order_items(id, order_id FK CASCADE, product_id FK NULL,
            name_snapshot, unit_price_pence, qty CHECK (qty > 0))
```

Design notes:

- **`name_snapshot` / `unit_price_pence` are copied onto the order.** Editing
  a product later must never rewrite what a customer was charged.
- **`public_token`** (32 hex chars) is what appears in `/order/:token`, so
  guest customers can see their order without an account and without
  enumerable integer IDs.
- **`is_placeholder`** renders a visible gold "PLACEHOLDER — NOT FOR SALE"
  badge and blocks add-to-basket. Seeded demo products carry it until the
  operator clears it in admin. Nothing invented can be sold by accident.
- **`user_id` nullable** supports guest checkout. If a guest later registers
  with the same email, their past orders are linked on registration.

---

## 5. Story blocks

The existing Urolithin page is not a generic product page — it has a seed-field
animation, a three-step sequence, a Supplement Facts table and an FAQ
accordion. To keep it *and* make it editable, page content is stored as an
ordered JSONB array of typed blocks:

```json
[
  {"type":"split","heading":"You Can't Just Eat Pomegranates",
   "body":"...","media":"seedfield","flip":false},
  {"type":"steps","heading":"Clear Out. Rebuild. Run.",
   "items":[{"n":"01","title":"...","body":"..."}]},
  {"type":"facts","heading":"Every Milligram, Printed",
   "serving":"2 capsules","rows":[{"name":"Urolithin A","amount":"TBD mg"}],
   "footnotes":["Other ingredients: ..."]},
  {"type":"gallery","slots":[{"image":"...","caption":"..."}]},
  {"type":"faq","items":[{"q":"...","a":"..."}]}
]
```

One template per block type in `views/partials/blocks/`. One product template
renders any product. Unknown block types render nothing rather than throwing.

The Urolithin A product is seeded with the blocks that reproduce its current
page. Its bespoke SVG seed-field animation is a named `media` value, not
free-form HTML.

**Sanitisation:** block text may contain a small allow-list of inline tags
(`em`, `strong`, `br`, `span` with class `gold`, `a` with `href`) and is
sanitised on save, not on render. Everything else is escaped by Nunjucks
autoescape.

---

## 6. Checkout flow

```
1. POST /cart/add            -> cart in session: [{product_id, qty}] only
2. GET  /checkout            -> address + email form
3. POST /checkout            -> validate; re-read every price from DB;
                                INSERT order (status='pending') + order_items;
                                create Stripe Checkout Session;
                                302 to Stripe
4. Stripe -> POST /webhooks/stripe
                                verify signature against raw body;
                                on checkout.session.completed:
                                  status='paid', paid_at=now
                                idempotent: ignore if already paid
5. GET  /order/:public_token -> confirmation page, reads live status
```

**The redirect back from Stripe sets no state.** Only the signed webhook moves
an order to `paid`. A customer landing on the success URL without a completed
webhook sees "processing", not "paid".

**The cart stores only product IDs and quantities.** Prices, names and totals
are computed server-side from the database on every request. A tampered cart
cannot change a price.

Stripe runs in test mode until live keys are set in `.env`. If
`STRIPE_SECRET_KEY` is absent, checkout returns a clear "payments not
configured" page rather than a stack trace.

---

## 7. Routes

**Shop** — `GET /`, `GET /shop`, `GET /shop/:slug`, `GET /cart`,
`POST /cart/add|update|remove`, `GET|POST /checkout`, `GET /order/:token`

**Account** — `GET|POST /account/login`, `GET|POST /account/register`,
`POST /account/logout`, `GET /account`, `GET /account/orders/:id`

**Admin** (all behind `requireAdmin`) — `GET /admin`,
`GET /admin/products`, `GET|POST /admin/products/new`,
`GET|POST /admin/products/:id`, `POST /admin/products/:id/delete`,
`POST /admin/products/:id/images`, `GET /admin/orders`,
`GET /admin/orders/:id`, `POST /admin/orders/:id/status`

**Legal** — `GET /terms`, `GET /privacy`, `GET /shipping-returns`.
Required: Stripe will not activate an account without them, and UK distance
selling rules require the 14-day cancellation notice.

**Webhook** — `POST /webhooks/stripe` (raw body parser, mounted before
`express.json`)

---

## 8. Security

| Risk | Control |
|---|---|
| Price tampering | Prices re-read from DB at checkout; cart holds IDs only |
| Fake payment confirmation | Order marked paid only by signature-verified webhook |
| CSRF | Double-submit token on every state-changing POST |
| XSS | Nunjucks autoescape on; story-block HTML allow-list sanitised on save |
| SQL injection | Parameterised queries only; no string-built SQL |
| Credential stuffing | Rate limit on `/account/login` and `/admin/login` |
| Session hijacking | `httpOnly`, `secure` in prod, `sameSite=lax`, regenerate on login |
| Password storage | bcrypt, cost 12 |
| Order enumeration | `public_token`, not sequential IDs, in customer-facing URLs |
| Upload abuse | multer: image MIME allow-list, 5 MB cap, random filenames |
| Header/transport | helmet + nginx: CSP, HSTS, nosniff, frame-options |
| DB exposure | Postgres bound to 127.0.0.1, not the public interface |

Admin is a `users.is_admin` flag, not a separate table — one identity system,
one session mechanism, less to get wrong.

---

## 9. Testing

`node:test` + `supertest`, running against a throwaway PGlite database created
per test file. TDD: test first, watch it fail, then implement.

Cases that must exist:

- Cart maths: add, update, remove, quantity clamping, empty-cart checkout
- **Price tampering:** POSTing a modified price does not change the order total
- **Webhook:** a bad signature is rejected; a valid one marks the order paid;
  a replayed event does not double-apply
- Auth: admin routes reject anonymous and non-admin users
- Guest to account: registering with a guest order's email links past orders
- Product publish/unpublish: unpublished products 404 on the storefront
- Placeholder products cannot be added to the basket
- Migrations run cleanly from empty, and are idempotent on re-run

---

## 10. Deployment

`deploy/DEPLOY.md` documents a fresh Ubuntu 24.04 droplet end to end: system
user, Node via nodesource, Postgres install and role creation, clone, `.env`,
migrate, seed, PM2 with startup script, nginx site config, certbot, ufw.

`.env.example` lists every variable with a comment. `config.js` validates them
at boot and exits with a readable message on anything missing, so a
misconfigured deploy fails immediately rather than at first checkout.

---

## 11. Compliance note

The repository README documents three unresolved blockers: unknown
per-ingredient mg amounts, the NR-vs-NMN identity question (**NMN is not
lawfully sellable as a food supplement in GB**), and unverified FSA novel-food
status for Urolithin A and PQQ.

These are content and regulatory matters, not engineering ones, and they do
not block this build. Two safeguards ship in the code:

1. `robots.txt` continues to block indexing until the operator changes it.
2. Seeded products carry `is_placeholder = true`, which renders a visible
   badge and blocks purchase, until cleared in the admin panel.

Health claims remain the operator's responsibility. Selling under a Harley
Street clinic's name raises the ASA/MHRA bar rather than lowering it.
