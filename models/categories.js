// Product categories. Small enough that the whole model fits on one screen.

import { query } from '../db/index.js';

const WRITABLE = new Set(['slug', 'name', 'blurb', 'sort']);

function columnsAndValues(fields) {
  const cols = [];
  const vals = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!WRITABLE.has(key)) throw new Error(`Refusing to write unknown category column: ${key}`);
    cols.push(key);
    vals.push(value);
  }
  return { cols, vals };
}

const categories = {
  async list() {
    const { rows } = await query('select * from categories order by sort, name');
    return rows;
  },

  async getBySlug(slug) {
    const { rows } = await query('select * from categories where slug = $1', [slug]);
    return rows[0] ?? null;
  },

  async getById(id) {
    const { rows } = await query('select * from categories where id = $1', [id]);
    return rows[0] ?? null;
  },

  async create(fields) {
    const { cols, vals } = columnsAndValues(fields);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const { rows } = await query(
      `insert into categories (${cols.join(', ')}) values (${placeholders.join(', ')}) returning *`,
      vals,
    );
    return rows[0];
  },

  async update(id, fields) {
    const { cols, vals } = columnsAndValues(fields);
    if (cols.length === 0) return this.getById(id);
    const assignments = cols.map((col, i) => `${col} = $${i + 1}`);
    const { rows } = await query(
      `update categories set ${assignments.join(', ')} where id = $${cols.length + 1} returning *`,
      [...vals, id],
    );
    return rows[0] ?? null;
  },

  /** Products keep existing; their category_id is set to null by the FK rule. */
  async remove(id) {
    await query('delete from categories where id = $1', [id]);
  },

  /** Categories that actually have something published in them. */
  async listWithPublishedCounts() {
    const { rows } = await query(`
      select c.*, count(p.id) filter (where p.is_published) ::int as product_count
        from categories c
        left join products p on p.category_id = c.id
       group by c.id
       order by c.sort, c.name
    `);
    return rows;
  },
};

export default categories;
