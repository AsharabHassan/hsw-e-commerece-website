// Documentation and configuration consistency.
//
// These are cheap tests that catch the failure mode where a variable is added
// to config.js and nobody tells the person doing the deployment.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { formatPence, parsePounds, penceToInput, sumLines } from '../lib/money.js';

test('money', async (t) => {
  await t.test('formats pence as GBP', () => {
    assert.equal(formatPence(5400), '£54.00');
    assert.equal(formatPence(0), '£0.00');
    assert.equal(formatPence(5), '£0.05');
    assert.equal(formatPence(105405), '£1,054.05');
  });

  await t.test('survives rubbish input rather than printing NaN at a customer', () => {
    assert.equal(formatPence(undefined), '£0.00');
    assert.equal(formatPence(null), '£0.00');
    assert.equal(formatPence('banana'), '£0.00');
  });

  await t.test('parses pounds into integer pence', () => {
    assert.equal(parsePounds('54'), 5400);
    assert.equal(parsePounds('54.5'), 5450);
    assert.equal(parsePounds('54.50'), 5450);
    assert.equal(parsePounds('£54.50'), 5450);
    assert.equal(parsePounds('1,054.05'), 105405);
    assert.equal(parsePounds(' 9.99 '), 999);
  });

  await t.test('rejects what is not a price', () => {
    assert.equal(parsePounds('about fifty'), null);
    assert.equal(parsePounds('54.999'), null, 'more precision than a penny is not a price');
    assert.equal(parsePounds('-10'), null);
    assert.equal(parsePounds(''), null);
    assert.equal(parsePounds(null), null);
  });

  await t.test('round-trips through the admin form', () => {
    for (const pence of [0, 5, 999, 5400, 105405]) {
      assert.equal(parsePounds(penceToInput(pence)), pence, `${pence} did not round-trip`);
    }
  });

  await t.test('sums lines without floating point', () => {
    const total = sumLines([
      { unit_price_pence: 1010, qty: 3 },
      { unit_price_pence: 2020, qty: 1 },
    ]);
    assert.equal(total, 5050);
    assert.ok(Number.isInteger(total));
  });
});

test('deployment documentation', async (t) => {
  await t.test('.env.example documents every variable config.js reads', async () => {
    const [example, source] = await Promise.all([
      readFile('.env.example', 'utf8'),
      readFile('config.js', 'utf8'),
    ]);

    // Every KEY inside the zod schema in config.js.
    const declared = [...source.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
    assert.ok(declared.length >= 8, 'the schema was parsed');

    for (const key of declared) {
      assert.ok(example.includes(key), `.env.example does not mention ${key}`);
    }
  });

  await t.test('the deployment guide covers the steps that are easy to miss', async () => {
    const guide = await readFile('deploy/DEPLOY.md', 'utf8');

    for (const topic of [
      'openssl rand -hex 32',   // session secret
      'npm run migrate',        // schema
      'whsec_',                 // webhook signing secret
      'certbot',                // TLS
      'ufw',                    // firewall
      'pg_dump',                // backups
      'X-Forwarded-Proto',      // the secure-cookie trap
    ]) {
      assert.ok(guide.includes(topic), `DEPLOY.md does not mention ${topic}`);
    }
  });

  await t.test('nginx forwards the proto header the session cookie depends on', async () => {
    const conf = await readFile('deploy/nginx.conf.example', 'utf8');
    assert.match(conf, /X-Forwarded-Proto\s+\$scheme/);
    assert.match(conf, /client_max_body_size\s+6m/, 'uploads need headroom over the 5MB app limit');
  });

  await t.test('robots.txt still blocks indexing while placeholders exist', async () => {
    const robots = await readFile('robots.txt', 'utf8');
    assert.match(robots, /Disallow: \//);
  });
});

test('brand assets survived the extraction from index.html', async (t) => {
  const css = await readFile('public/css/hsw.css', 'utf8');

  await t.test('every brand token is present', () => {
    for (const token of [
      '#FFFFFF', '#F8F8F8', '#1A1A1A', '#4A4A4A', '#E5E5E5', '#D4AF37',
      '#050505', '#0A0A0A', '#9CA3AF',
    ]) {
      assert.ok(css.includes(token), `missing brand token ${token}`);
    }
  });

  await t.test('the display and UI typefaces are unchanged', () => {
    assert.match(css, /Playfair Display/);
    assert.match(css, /Montserrat/);
  });

  await t.test('the dark theme still keys off the .dark class', () => {
    assert.match(css, /\.dark\s*\{/);
  });

  await t.test('the theme script writes the documented localStorage key', async () => {
    const js = await readFile('public/js/theme.js', 'utf8');
    assert.match(js, /hsw-theme/);
  });

  await t.test('the layout keeps the anti-flash bootstrap inline', async () => {
    const layout = await readFile('views/layout.njk', 'utf8');
    assert.match(layout, /hsw-theme/, 'the pre-paint theme script must be inline, not deferred');
  });
});

test('static assets are cache-busted', async (t) => {
  const { getApp, request } = await import('./helpers/app.js');
  const app = await getApp();

  await t.test('stylesheets carry a version query', async () => {
    const res = await request(app).get('/');
    assert.match(res.text, /\/css\/hsw\.css\?v=[a-f0-9]{10}/);
    assert.match(res.text, /\/css\/shop\.css\?v=[a-f0-9]{10}/);
    assert.match(res.text, /\/js\/theme\.js\?v=[a-f0-9]{10}/);
  });

  await t.test('the version is a content hash, so it only moves when the CSS does', async () => {
    const a = (await request(app).get('/')).text.match(/shop\.css\?v=([a-f0-9]+)/)[1];
    const b = (await request(app).get('/shop')).text.match(/shop\.css\?v=([a-f0-9]+)/)[1];
    assert.equal(a, b, 'the same build serves the same version');
  });
});
