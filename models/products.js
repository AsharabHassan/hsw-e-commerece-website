// Product and product-image access. All SQL for the catalogue lives here;
// routes never write SQL inline.

import { query } from '../db/index.js';

// Columns a caller is allowed to write. Anything not on this list is rejected
// rather than silently ignored, so a typo in a route surfaces immediately and
// a hostile field name can never reach the SQL text.
const WRITABLE = new Set([
  'slug',
  'name',
  'subtitle',
  'category_id',
  'price_pence',
  'summary',
  'story_blocks',
  'meta_description',
  'is_published',
  'is_placeholder',
]);

const SELECT = `
  select p.id, p.slug, p.name, p.subtitle, p.category_id, p.price_pence,
         p.summary, p.story_blocks, p.meta_description,
         p.is_published, p.is_placeholder, p.created_at, p.updated_at,
         c.slug as category_slug, c.name as category_name
    from products p
    left join categories c on c.id = p.category_id
`;

/** JSONB comes back parsed on both drivers; guard anyway. */
function normalise(row) {
  if (!row) return null;
  let blocks = row.story_blocks;
  if (typeof blocks === 'string') {
    try {
      blocks = JSON.parse(blocks);
    } catch {
      blocks = [];
    }
  }
  return { ...row, story_blocks: Array.isArray(blocks) ? blocks : [] };
}

async function attachImages(rows) {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const { rows: images } = await query(
    `select id, product_id, path, alt, sort
       from product_images
      where product_id = any($1::int[])
      order by sort, id`,
    [ids],
  );
  const byProduct = new Map(ids.map((id) => [id, []]));
  for (const img of images) byProduct.get(img.product_id)?.push(img);
  return rows.map((r) => ({ ...r, images: byProduct.get(r.id) ?? [] }));
}

/**
 * Split a partial product into parallel column/value arrays, validating each
 * column name against the allow-list.
 */
function columnsAndValues(fields) {
  const cols = [];
  const vals = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!WRITABLE.has(key)) {
      throw new Error(`Refusing to write unknown product column: ${key}`);
    }
    cols.push(key);
    vals.push(key === 'story_blocks' ? JSON.stringify(value ?? []) : value);
  }
  return { cols, vals };
}

const products = {
  /** @returns {Promise<object>} the inserted row */
  async create(fields) {
    const { cols, vals } = columnsAndValues(fields);
    if (!cols.includes('slug') || !cols.includes('name')) {
      throw new Error('A product needs at least a slug and a name');
    }
    const placeholders = cols.map((col, i) =>
      col === 'story_blocks' ? `$${i + 1}::jsonb` : `$${i + 1}`,
    );
    const { rows } = await query(
      `insert into products (${cols.join(', ')}) values (${placeholders.join(', ')}) returning *`,
      vals,
    );
    return normalise(rows[0]);
  },

  /** Partial update. Only the keys present are written. */
  async update(id, fields) {
    const { cols, vals } = columnsAndValues(fields);
    if (cols.length === 0) return this.getById(id);

    const assignments = cols.map((col, i) =>
      col === 'story_blocks' ? `${col} = $${i + 1}::jsonb` : `${col} = $${i + 1}`,
    );
    assignments.push('updated_at = now()');

    const { rows } = await query(
      `update products set ${assignments.join(', ')} where id = $${cols.length + 1} returning *`,
      [...vals, id],
    );
    return normalise(rows[0] ?? null);
  },

  async remove(id) {
    await query('delete from products where id = $1', [id]);
  },

  /** Storefront lookup: published products only. */
  async getBySlug(slug) {
    const { rows } = await query(`${SELECT} where p.slug = $1 and p.is_published = true`, [slug]);
    const row = normalise(rows[0] ?? null);
    if (!row) return null;
    return (await attachImages([row]))[0];
  },

  /** Admin lookup: any product, published or not. */
  async getById(id) {
    const { rows } = await query(`${SELECT} where p.id = $1`, [id]);
    const row = normalise(rows[0] ?? null);
    if (!row) return null;
    return (await attachImages([row]))[0];
  },

  /** Storefront catalogue. */
  async listPublished({ categorySlug = null, limit = null } = {}) {
    const params = [];
    let sql = `${SELECT} where p.is_published = true`;
    if (categorySlug) {
      params.push(categorySlug);
      sql += ` and c.slug = $${params.length}`;
    }
    sql += ' order by c.sort nulls last, p.name';
    if (limit) {
      params.push(limit);
      sql += ` limit $${params.length}`;
    }
    const { rows } = await query(sql, params);
    return attachImages(rows.map(normalise));
  },

  /** Admin catalogue: everything, newest first. */
  async listAll() {
    const { rows } = await query(`${SELECT} order by p.created_at desc, p.id desc`);
    return attachImages(rows.map(normalise));
  },

  /**
   * The authoritative price lookup used by the basket and checkout.
   * Returns only what the database says, keyed by id.
   * @param {number[]} ids
   * @returns {Promise<Map<number, object>>}
   */
  async priceMap(ids) {
    const unique = [...new Set(ids.map(Number).filter(Number.isInteger))];
    if (unique.length === 0) return new Map();

    const { rows } = await query(
      `select id, slug, name, price_pence, is_published, is_placeholder
         from products
        where id = any($1::int[])`,
      [unique],
    );
    const withImages = await attachImages(rows);
    return new Map(withImages.map((r) => [r.id, r]));
  },

  async addImage(productId, { path, alt = '', sort = 0 }) {
    const { rows } = await query(
      `insert into product_images (product_id, path, alt, sort)
       values ($1, $2, $3, $4) returning *`,
      [productId, path, alt, sort],
    );
    return rows[0];
  },

  async getImage(imageId) {
    const { rows } = await query('select * from product_images where id = $1', [imageId]);
    return rows[0] ?? null;
  },

  async removeImage(imageId) {
    await query('delete from product_images where id = $1', [imageId]);
  },

  /** Distinct slugs already taken — used to generate a unique slug in admin. */
  async slugExists(slug, exceptId = null) {
    const { rows } = await query(
      'select 1 from products where slug = $1 and ($2::int is null or id <> $2)',
      [slug, exceptId],
    );
    return rows.length > 0;
  },
};

export default products;
