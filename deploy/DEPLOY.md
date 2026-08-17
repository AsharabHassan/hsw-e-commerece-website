# Deploying to a DigitalOcean droplet

Ubuntu 24.04 LTS, from a fresh droplet to a live shop.

Run everything as a normal user with `sudo`, not as root. Commands prefixed
`#` are illustrative output, not something to type.

---

## 0. What you need before you start

- A droplet (1GB RAM is enough; 2GB is comfortable while Postgres and Node
  share the box)
- A domain or subdomain with an **A record** pointing at the droplet's IP
- Your Stripe account (test keys are fine to start)
- An SSH keypair — see below

### SSH key

An ed25519 keypair for this droplet already exists at `~/.ssh/hsw_store`.
The public half is `~/.ssh/hsw_store.pub`:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMVUj7rAKYsqDZpVET+HY1GIZbwaM0hs9vpflFnDxhRA hsw-store-droplet-2026-08-17
```

Fingerprint: `SHA256:ysXn132eLUlYZwJh2FN4TQBwnff3SIniC4JRrWQHsHw`

**Add it to DigitalOcean before creating the droplet** — Settings → Security →
Add SSH Key, or the "SSH Keys" panel on the droplet creation page. Attaching it
at creation time means root password authentication is never enabled in the
first place.

`~/.ssh/config` has entries for it. Once the droplet exists, replace
`REPLACE_WITH_DROPLET_IP` in that file with its IP address, then:

```bash
ssh hsw-store-root      # for section 1 only, before the hsw user exists
ssh hsw-store           # everything after that
```

The private key has **no passphrase**, which is the usual arrangement for a
deploy key. To add one:

```bash
ssh-keygen -p -f ~/.ssh/hsw_store
```

Never copy the private key (`~/.ssh/hsw_store`, the file with no `.pub`)
anywhere. Only the `.pub` half goes to DigitalOcean.

---

## 1. Create a user and lock the box down

```bash
# as root, first login only
adduser hsw
usermod -aG sudo hsw
rsync --archive --chown=hsw:hsw ~/.ssh /home/hsw

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

Log out and back in as `hsw` (`ssh hsw-store`). Everything below is run as
`hsw`.

Disable password logins while you are here — it is the single highest-value
thing on this page. Do it only once you have confirmed key-based login works,
or you will lock yourself out:

```bash
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

---

## 2. Node 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version    # v24.x
```

---

## 3. Postgres

```bash
sudo apt-get install -y postgresql postgresql-contrib

sudo -u postgres psql <<'SQL'
CREATE ROLE hsw WITH LOGIN PASSWORD 'CHANGE-THIS-TO-SOMETHING-LONG';
CREATE DATABASE hsw OWNER hsw;
SQL
```

Confirm Postgres is listening on localhost only. It should be by default, and
it must stay that way — the database has no business being reachable from the
internet:

```bash
sudo ss -lntp | grep 5432
# LISTEN 0 244 127.0.0.1:5432 ...
```

If it shows `0.0.0.0:5432`, edit `listen_addresses = 'localhost'` in
`/etc/postgresql/16/main/postgresql.conf` and restart.

---

## 4. The application

```bash
sudo mkdir -p /srv/hsw
sudo chown hsw:hsw /srv/hsw
git clone YOUR_REPO_URL /srv/hsw
cd /srv/hsw

npm ci --omit=dev
```

### Environment

```bash
cp .env.example .env
nano .env
```

Set at minimum:

```ini
NODE_ENV=production
PORT=3000
BASE_URL=https://shop.yourdomain.co.uk
DATABASE_URL=postgres://hsw:THE-PASSWORD-YOU-CHOSE@127.0.0.1:5432/hsw
SESSION_SECRET=          # paste the output of: openssl rand -hex 32
```

Generate the session secret with:

```bash
openssl rand -hex 32
```

Lock the file down — it holds your database password and, shortly, your Stripe
secret key:

```bash
chmod 600 .env
```

The application refuses to start in production without `SESSION_SECRET` and
`DATABASE_URL`, and it says which one is missing. That is deliberate: a shop
that boots with a default session secret is a shop whose sessions can be
forged.

### Schema and seed data

```bash
npm run migrate

ADMIN_EMAIL=you@yourdomain.co.uk ADMIN_PASSWORD='a long password' npm run seed
```

The seed creates ten example products, **all flagged as placeholders**. They
are visible in the shop but cannot be added to a basket, and each shows a gold
"not for sale" notice. Replace them through the admin panel and untick
"Placeholder" once the real copy, price and compliance checks are done.

If you would rather start from nothing, skip `npm run seed` and add products
by hand — but then create your admin user explicitly:

```bash
node -e "import('./models/users.js').then(async m => {
  await m.default.create({ email: 'you@yourdomain.co.uk', password: 'a long password', name: 'Admin', is_admin: true });
  process.exit(0);
})"
```

---

## 5. PM2

```bash
sudo npm install -g pm2

# PM2 writes logs here; it will not create the directory itself.
sudo mkdir -p /var/log/hsw
sudo chown hsw:hsw /var/log/hsw

pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup systemd      # then run the command it prints, with sudo
```

Check it:

```bash
pm2 status
pm2 logs hsw --lines 50
curl -I http://127.0.0.1:3000/
```

---

## 6. nginx and TLS

```bash
sudo apt-get install -y nginx
sudo cp /srv/hsw/deploy/nginx.conf.example /etc/nginx/sites-available/hsw
sudo nano /etc/nginx/sites-available/hsw     # replace shop.yourdomain.co.uk

sudo ln -s /etc/nginx/sites-available/hsw /etc/nginx/sites-enabled/hsw
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Then certificates:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d shop.yourdomain.co.uk
```

Certbot edits the config in place to add the certificate paths and the
HTTP-to-HTTPS redirect, and installs a renewal timer. Check it:

```bash
sudo certbot renew --dry-run
```

---

## 7. Stripe

Until this step, checkout shows a clear "payments are not configured" page.
Customers can browse and build a basket; they simply cannot pay.

1. In the Stripe dashboard, go to **Developers → API keys** and copy the
   secret and publishable keys. Start with the **test** keys.
2. Go to **Developers → Webhooks → Add endpoint**.
   - URL: `https://shop.yourdomain.co.uk/webhooks/stripe`
   - Events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`,
     `checkout.session.expired`
3. Copy the **signing secret** (it starts `whsec_`).

Add all three to `.env`:

```ini
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Restart, then test with a real test-mode purchase using card `4242 4242 4242
4242`, any future expiry, any CVC:

```bash
pm2 reload hsw
```

The order should appear in `/admin/orders` as **pending**, then flip to
**paid** within a second or two when the webhook lands. If it stays pending,
the webhook is not arriving — check **Developers → Webhooks → your endpoint**
in Stripe for the delivery attempts and their responses, and check
`pm2 logs hsw`.

**Nothing marks an order paid except that webhook.** Not the redirect back
from Stripe, and not the admin panel. That is the whole point of it.

When you are ready for real money, swap in the live keys, create a **separate
live-mode webhook endpoint** (test and live endpoints have different signing
secrets), and reload.

---

## 8. Going live

Before you take real payments:

- [ ] Replace every placeholder product, or unpublish it
- [ ] Untick "Placeholder" only on products whose price and copy are real
- [ ] Fill in every `TBD` in `/terms`, `/privacy` and `/shipping-returns` —
      company number, registered address, VAT number, carrier, returns address
- [ ] Resolve the three blockers in the root `README.md`: per-ingredient mg
      amounts, the NR-vs-NMN question, and FSA novel-food status
- [ ] Replace `robots.txt` with the "AT LAUNCH" block inside it
- [ ] Swap Stripe test keys for live keys and add the live webhook endpoint

---

## 9. Updating

```bash
cd /srv/hsw
git pull
npm ci --omit=dev
npm run migrate
pm2 reload hsw
```

`npm run migrate` is safe to run every time; it applies only what has not run
before, and prints "Database is up to date" when there is nothing to do.

---

## 10. Backups

Nothing here backs up your database. Set this up on day one, not after the
first incident:

```bash
sudo -u postgres crontab -e
```

```cron
0 3 * * * pg_dump -Fc hsw > /var/backups/hsw-$(date +\%F).dump && find /var/backups -name 'hsw-*.dump' -mtime +14 -delete
```

Uploaded product images live in `/srv/hsw/public/uploads` and are **not** in
git. Include that directory in whatever off-box backup you use, or the images
are gone with the droplet.

DigitalOcean's own droplet snapshots are the simplest belt-and-braces option
on top of this.

---

## Troubleshooting

**502 Bad Gateway** — node is not running. `pm2 status`, then `pm2 logs hsw`.

**"Invalid configuration — refusing to start"** — a required environment
variable is missing or malformed. The message names it.

**Sessions do not persist / you are logged out immediately** — `secure`
cookies are set in production, so the site must be served over HTTPS and nginx
must forward `X-Forwarded-Proto`. The supplied nginx config does this.

**Orders stay pending forever** — the webhook is not reaching you, or the
signing secret is wrong. Stripe's dashboard shows every delivery attempt and
the response it got.

**"relation does not exist"** — migrations have not run. `npm run migrate`.

**Uploads fail on large images** — nginx's `client_max_body_size` must be at
least as large as the 5MB application limit. The supplied config sets 6m.
