// Admin panel: products, images, categories, orders.
//
// Every route in this file sits behind requireAdmin.

import express from 'express';
import { z } from 'zod';

import products from '../models/products.js';
import categories from '../models/categories.js';
import orders from '../models/orders.js';
import users from '../models/users.js';
import { requireAdmin } from '../lib/auth.js';
import { enforceCsrf } from '../lib/csrf.js';
import { storyBlocks, BLOCK_TYPE_NAMES } from '../lib/sanitize.js';
import { parsePounds } from '../lib/money.js';
import { singleImage, publicPathFor, removeUpload } from '../lib/uploads.js';
import { driver } from '../db/index.js';

const router = express.Router();

router.use(requireAdmin);

// Admin pages must never be cached by a shared proxy or left in the back/
// forward cache after sign-out.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  next();
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const all = await products.listAll();

    res.render('admin/dashboard.njk', {
      stats: await orders.stats(),
      recentOrders: (await orders.listAll({ limit: 8 })),
      productCount: all.length,
      publishedCount: all.filter((p) => p.is_published).length,
      placeholderCount: all.filter((p) => p.is_placeholder).length,
      userCount: await users.count(),
      dbDriver: await driver(),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const productSchema = z.object({
  name: z.string().trim().min(2, 'Give the product a name').max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and hyphens only')
    .max(120),
  subtitle: z.string().trim().max(200).optional().or(z.literal('')),
  summary: z.string().trim().max(1000).optional().or(z.literal('')),
  meta_description: z.string().trim().max(300).optional().or(z.literal('')),
  price: z.string().trim(),
  category_id: z.string().optional(),
  story_blocks: z.string().optional(),
  is_published: z.string().optional(),
  is_placeholder: z.string().optional(),
});

/** Turn the posted form into model fields, or return field errors. */
function productFieldsFrom(body) {
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) {
    const errors = {};
    for (const issue of parsed.error.issues) errors[issue.path.join('.')] = issue.message;
    return { errors };
  }

  const v = parsed.data;

  const pricePence = parsePounds(v.price);
  if (pricePence === null) {
    return { errors: { price: 'Enter a price such as 54.00' } };
  }

  let blocks = [];
  if (v.story_blocks?.trim()) {
    try {
      blocks = JSON.parse(v.story_blocks);
    } catch (err) {
      return { errors: { story_blocks: `That is not valid JSON: ${err.message}` } };
    }
    if (!Array.isArray(blocks)) {
      return { errors: { story_blocks: 'Story blocks must be a JSON array' } };
    }
  }

  return {
    fields: {
      name: v.name,
      slug: v.slug,
      subtitle: v.subtitle || null,
      summary: v.summary || null,
      meta_description: v.meta_description || null,
      price_pence: pricePence,
      category_id: v.category_id ? Number(v.category_id) : null,
      // Sanitised here, on the way in, so the database only ever holds
      // content that is safe to render.
      story_blocks: storyBlocks(blocks),
      is_published: v.is_published === 'on',
      is_placeholder: v.is_placeholder === 'on',
    },
  };
}

async function productFormLocals() {
  return { categories: await categories.list(), blockTypes: BLOCK_TYPE_NAMES };
}

router.get('/products', async (req, res, next) => {
  try {
    res.render('admin/products.njk', { products: await products.listAll() });
  } catch (err) {
    next(err);
  }
});

router.get('/products/new', async (req, res, next) => {
  try {
    res.render('admin/product-form.njk', {
      ...(await productFormLocals()),
      product: null,
      values: { is_placeholder: 'on' },
      errors: {},
    });
  } catch (err) {
    next(err);
  }
});

router.post('/products/new', async (req, res, next) => {
  try {
    const { fields, errors } = productFieldsFrom(req.body);

    if (errors) {
      return res.status(400).render('admin/product-form.njk', {
        ...(await productFormLocals()),
        product: null,
        values: req.body,
        errors,
      });
    }

    if (await products.slugExists(fields.slug)) {
      return res.status(409).render('admin/product-form.njk', {
        ...(await productFormLocals()),
        product: null,
        values: req.body,
        errors: { slug: 'Another product already uses that URL slug' },
      });
    }

    const created = await products.create(fields);
    req.session.flash = { kind: 'ok', message: `Created "${created.name}".` };
    res.redirect(`/admin/products/${created.id}`);
  } catch (err) {
    next(err);
  }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    const product = await products.getById(Number(req.params.id));
    if (!product) return next();

    res.render('admin/product-form.njk', {
      ...(await productFormLocals()),
      product,
      values: {
        ...product,
        price: (product.price_pence / 100).toFixed(2),
        story_blocks: JSON.stringify(product.story_blocks, null, 2),
        is_published: product.is_published ? 'on' : '',
        is_placeholder: product.is_placeholder ? 'on' : '',
      },
      errors: {},
    });
  } catch (err) {
    next(err);
  }
});

router.post('/products/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const product = await products.getById(id);
    if (!product) return next();

    const { fields, errors } = productFieldsFrom(req.body);

    if (errors) {
      return res.status(400).render('admin/product-form.njk', {
        ...(await productFormLocals()),
        product,
        values: req.body,
        errors,
      });
    }

    if (await products.slugExists(fields.slug, id)) {
      return res.status(409).render('admin/product-form.njk', {
        ...(await productFormLocals()),
        product,
        values: req.body,
        errors: { slug: 'Another product already uses that URL slug' },
      });
    }

    await products.update(id, fields);
    req.session.flash = { kind: 'ok', message: 'Saved.' };
    res.redirect(`/admin/products/${id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/products/:id/delete', async (req, res, next) => {
  try {
    const product = await products.getById(Number(req.params.id));
    if (!product) return next();

    for (const image of product.images ?? []) removeUpload(image.path);
    await products.remove(product.id);

    req.session.flash = { kind: 'ok', message: `Deleted "${product.name}".` };
    res.redirect('/admin/products');
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Product images
// ---------------------------------------------------------------------------

/**
 * CSRF for the one multipart route.
 *
 * The global middleware cannot check a multipart body because multer has not
 * parsed it yet, so the check happens here instead — and because multer has
 * already written the file by this point, a failed check deletes it rather
 * than leaving an unreferenced upload on disk.
 */
function discardUploadIfCsrfFails(req, res, next) {
  enforceCsrf(req, res, () => next());

  // enforceCsrf renders and returns without calling next() when it rejects;
  // headersSent is how we know that happened.
  if (res.headersSent && req.file) removeUpload(publicPathFor(req.file));
}

router.post(
  '/products/:id/images',

  // multer has to run first, because a multipart body is not parsed until it
  // does — which is also why the global CSRF middleware skipped this request.
  (req, res, next) =>
    singleImage(req, res, (err) => {
      if (!err) return next();
      // A rejected upload sends the operator back to the form with an
      // explanation. res.status() before res.redirect() would be ignored, so
      // it is not set: this is a 302, and the message carries the reason.
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'That image is larger than 5MB' : err.message;
      req.session.flash = { kind: 'error', message };
      res.redirect(`/admin/products/${req.params.id}`);
    }),

  // Now the token is readable. A file that arrived without a valid token is
  // deleted rather than left sitting on disk.
  discardUploadIfCsrfFails,

  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const product = await products.getById(id);
      if (!product) return next();

      if (!req.file) {
        req.session.flash = { kind: 'error', message: 'Choose an image file first.' };
        return res.redirect(`/admin/products/${id}`);
      }

      await products.addImage(id, {
        path: publicPathFor(req.file),
        alt: String(req.body.alt ?? '').trim().slice(0, 200),
        sort: (product.images?.length ?? 0) + 1,
      });

      req.session.flash = { kind: 'ok', message: 'Image uploaded.' };
      res.redirect(`/admin/products/${id}`);
    } catch (err) {
      next(err);
    }
  },
);

router.post('/products/:id/images/:imageId/delete', async (req, res, next) => {
  try {
    const image = await products.getImage(Number(req.params.imageId));
    if (image) {
      removeUpload(image.path);
      await products.removeImage(image.id);
    }
    res.redirect(`/admin/products/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and hyphens only')
    .max(80),
  blurb: z.string().trim().max(300).optional().or(z.literal('')),
  sort: z.coerce.number().int().min(0).max(999).default(0),
});

router.get('/categories', async (req, res, next) => {
  try {
    res.render('admin/categories.njk', {
      categories: await categories.listWithPublishedCounts(),
      values: {},
      errors: {},
    });
  } catch (err) {
    next(err);
  }
});

router.post('/categories', async (req, res, next) => {
  try {
    const parsed = categorySchema.safeParse(req.body);

    if (!parsed.success) {
      const errors = {};
      for (const issue of parsed.error.issues) errors[issue.path.join('.')] = issue.message;
      return res.status(400).render('admin/categories.njk', {
        categories: await categories.listWithPublishedCounts(),
        values: req.body,
        errors,
      });
    }

    await categories.create({ ...parsed.data, blurb: parsed.data.blurb || null });
    req.session.flash = { kind: 'ok', message: 'Category added.' };
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
});

router.post('/categories/:id/delete', async (req, res, next) => {
  try {
    await categories.remove(Number(req.params.id));
    req.session.flash = { kind: 'ok', message: 'Category deleted. Its products were kept.' };
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

router.get('/orders', async (req, res, next) => {
  try {
    const status = orders.STATUSES.includes(req.query.status) ? req.query.status : null;
    res.render('admin/orders.njk', {
      orders: await orders.listAll({ status }),
      statuses: orders.STATUSES,
      activeStatus: status,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await orders.getById(Number(req.params.id));
    if (!order) return next();
    res.render('admin/order.njk', { order, statuses: orders.STATUSES });
  } catch (err) {
    next(err);
  }
});

/**
 * Confirm cash was collected on a COD order.
 *
 * The one place a human may declare an order paid — and only because a cash
 * order has no Stripe record to disagree with. markCashCollected() guards on
 * payment_method in SQL, so this cannot touch a card order even if the id in
 * the URL belongs to one.
 */
router.post('/orders/:id/cash-collected', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const order = await orders.getById(id);
    if (!order) return next();

    if (order.payment_method !== 'cod') {
      req.session.flash = {
        kind: 'error',
        message: 'That is a card order. Its payment status comes from Stripe, not from here.',
      };
      return res.redirect(`/admin/orders/${id}`);
    }

    const marked = await orders.markCashCollected(id);
    req.session.flash = marked
      ? { kind: 'ok', message: `Cash received — order marked paid.` }
      : { kind: 'error', message: 'That order was not awaiting cash.' };

    res.redirect(`/admin/orders/${id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:id/status', async (req, res, next) => {
  try {
    const status = String(req.body.status ?? '');

    if (!orders.STATUSES.includes(status)) {
      req.session.flash = { kind: 'error', message: 'That is not a valid order status.' };
      return res.redirect(`/admin/orders/${req.params.id}`);
    }

    // Payment state is owned by the Stripe webhook. Letting an operator mark
    // an order paid by hand would mean the shop's records could disagree with
    // Stripe's, which is exactly the disagreement you cannot afford.
    if (status === 'paid') {
      const order = await orders.getById(Number(req.params.id));
      req.session.flash = {
        kind: 'error',
        message:
          order?.payment_method === 'cod'
            ? 'Use the "Cash Received" button above to mark a cash order paid.'
            : 'Payment status is set by Stripe, not by hand. Refund or cancel in Stripe instead.',
      };
      return res.redirect(`/admin/orders/${req.params.id}`);
    }

    await orders.setStatus(Number(req.params.id), status);
    req.session.flash = { kind: 'ok', message: `Order marked ${status}.` };
    res.redirect(`/admin/orders/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

export default router;
