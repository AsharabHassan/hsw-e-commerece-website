// Storefront: home, catalogue, product detail.

import express from 'express';

import config from '../config.js';
import products from '../models/products.js';
import categories from '../models/categories.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const all = await products.listPublished();

    res.render('shop/home.njk', {
      featured: all.filter((p) => !p.is_placeholder).slice(0, 3),
      products: all.slice(0, 6),
      categories: await categories.listWithPublishedCounts(),
      hasRealProducts: all.some((p) => !p.is_placeholder),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/shop', async (req, res, next) => {
  try {
    const categorySlug = typeof req.query.category === 'string' ? req.query.category : null;
    const category = categorySlug ? await categories.getBySlug(categorySlug) : null;

    if (categorySlug && !category) {
      return res.status(404).render('error.njk', {
        status: 404,
        title: 'Category not found',
        heading: 'No such category',
        message: 'That category does not exist. Browse everything instead.',
      });
    }

    res.render('shop/index.njk', {
      products: await products.listPublished({ categorySlug }),
      categories: await categories.listWithPublishedCounts(),
      category,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/shop/:slug', async (req, res, next) => {
  try {
    const product = await products.getBySlug(req.params.slug);

    // Unpublished products are indistinguishable from products that do not
    // exist. A draft must not be discoverable by guessing its slug.
    if (!product) return next();

    res.render('shop/product.njk', {
      product,
      jsonLd: productJsonLd(product),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Product structured data.
 *
 * `offers` is omitted entirely for placeholder products. Publishing a price
 * and an availability claim for something that is not for sale would put a
 * fabricated offer into Google's index under a clinic's name.
 */
function productJsonLd(product) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.meta_description || product.summary || undefined,
    url: `${config.baseUrl}/shop/${product.slug}`,
    brand: { '@type': 'Brand', name: config.storeName },
  };

  if (product.images?.length) {
    data.image = product.images.map((img) => `${config.baseUrl}${img.path}`);
  }

  if (!product.is_placeholder) {
    data.offers = {
      '@type': 'Offer',
      priceCurrency: 'GBP',
      price: (product.price_pence / 100).toFixed(2),
      availability: 'https://schema.org/InStock',
      url: `${config.baseUrl}/shop/${product.slug}`,
    };
  }

  return JSON.stringify(data);
}

export default router;
