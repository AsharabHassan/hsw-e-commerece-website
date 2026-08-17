// XML sitemap.
//
// Lists only pages that are genuinely for sale: a placeholder product has an
// invented price and unverified copy, and does not belong in a search index
// under a clinic's name.
//
// Note that robots.txt currently blocks all crawling — see that file. This
// route is ready for the day it does not.

import express from 'express';

import config from '../config.js';
import products from '../models/products.js';

const router = express.Router();

const STATIC_PATHS = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/shop', priority: '0.9', changefreq: 'weekly' },
  { path: '/terms', priority: '0.2', changefreq: 'yearly' },
  { path: '/privacy', priority: '0.2', changefreq: 'yearly' },
  { path: '/shipping-returns', priority: '0.3', changefreq: 'yearly' },
];

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (ch) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch],
  );
}

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const live = (await products.listPublished()).filter((p) => !p.is_placeholder);

    const entries = [
      ...STATIC_PATHS.map((page) => ({
        loc: `${config.baseUrl}${page.path}`,
        priority: page.priority,
        changefreq: page.changefreq,
        lastmod: null,
      })),
      ...live.map((product) => ({
        loc: `${config.baseUrl}/shop/${product.slug}`,
        priority: '0.8',
        changefreq: 'monthly',
        lastmod: product.updated_at ? new Date(product.updated_at).toISOString().slice(0, 10) : null,
      })),
    ];

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries.map((entry) =>
        [
          '  <url>',
          `    <loc>${escapeXml(entry.loc)}</loc>`,
          entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>` : null,
          `    <changefreq>${entry.changefreq}</changefreq>`,
          `    <priority>${entry.priority}</priority>`,
          '  </url>',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
      '</urlset>',
    ].join('\n');

    res.type('application/xml').send(xml);
  } catch (err) {
    next(err);
  }
});

export default router;
