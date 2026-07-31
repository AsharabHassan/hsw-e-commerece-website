# Urolithin A Complex — product page

Single-page product listing for **Harley Street Wellness**, built on the
brand system from `harleystreetmedicalwellness.co.uk`.

Zero dependencies. No build step. `index.html` is the whole site.

---

## Run locally

Open `index.html` directly in a browser, or serve it:

```bash
npx http-server -p 8080 -c-1
```

## Deploy

Vercel auto-detects this as a static site — no framework preset, no build command,
output directory is the repo root.

```bash
npx vercel          # preview deployment
npx vercel --prod   # production
```

Or connect the GitHub repo in the Vercel dashboard; every push to `main` ships.

`vercel.json` sets security headers (CSP, HSTS, nosniff, frame options),
`cleanUrls`, and long-lived caching for static assets.

---

## ⚠️ Not ready to sell

Three blockers, none of them design work:

| # | Blocker | Why it matters |
|---|---|---|
| 1 | **Per-ingredient mg amounts** | The Supplement Facts panel is the centrepiece of the page and currently reads `TBD` five times. |
| 2 | **NAD+ precursor identity (NR vs NMN)** | If it is NMN, this may not be lawfully sellable in the UK. NR carries a pre-Brexit EU authorisation; NMN does not. |
| 3 | **FSA novel-food status** | Urolithin A and PQQ both need checking against the GB novel foods register before launch. |

Plus: the basket button is a stub. It is not wired to a checkout provider.

### Placeholders

Every unresolved value is visibly highlighted in gold on the page. Search for
`TBD` and `data-tbd` in `index.html`.

- Per-ingredient mg amounts
- NAD+ precursor name
- Capsule format — **unverified**; listings say *softgels*, which are typically
  gelatin. Do not publish "vegetarian capsule" without confirming.
- Price (currently £54.00)
- Third-party testing / batch COA
- Registered address in the footer
- Product photography — four slots marked `.shot`
- `og:image` (1200×630) and the canonical URL in `<head>`

### `robots.txt` blocks all indexing

Deliberate, so placeholder content does not get indexed under the clinic's name.
**Delete or replace it at launch** — instructions are in the file.

---

## Claims policy

All copy is written as description of *published research findings*, not as health
claims made for the product.

Because this sells under a medical clinic's name, the bar is **higher, not lower** —
the ASA and MHRA treat claims made under clinical authority more strictly. Before
adding any benefit claim ("boosts energy", "antioxidant protection", "anti-ageing"),
check the GB Nutrition & Health Claims Register.

---

## Brand tokens

Lifted from the live clinic stylesheet.

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

Dark theme uses the same `.dark` class convention as the main site, so it drops in
without translation. Preference persists to `localStorage` under `hsw-theme`.
