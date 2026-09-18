// Apply db/content/urolithin-a.js to an existing database.
//
//   node db/update-urolithin.js
//
// The seed never touches a product that already exists, so this is how the
// label-accurate copy and photography reach the live shop. It rewrites the
// copy and replaces the image list. It does NOT touch the price, the
// published flag, the placeholder flag or the category — those belong to
// whoever runs the shop, via the admin panel.
//
// Safe to re-run. Old image rows are removed; their files on disk are left
// alone, so nothing an admin uploaded is deleted.

import { migrate } from './migrate.js';
import { withTransaction, close } from './index.js';
import { storyBlocks } from '../lib/sanitize.js';
import { UROLITHIN_SLUG, UROLITHIN_FIELDS, UROLITHIN_IMAGES } from './content/urolithin-a.js';

export async function updateUrolithin({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;

  return withTransaction(async (db) => {
    const { rows } = await db.query('select id, price_pence from products where slug = $1', [UROLITHIN_SLUG]);
    if (rows.length === 0) {
      throw new Error(`No product with slug "${UROLITHIN_SLUG}" — run the seed instead.`);
    }
    const { id, price_pence } = rows[0];
    const { name, subtitle, summary, meta_description } = UROLITHIN_FIELDS;

    await db.query(
      `update products
          set name = $1, subtitle = $2, summary = $3, meta_description = $4,
              story_blocks = $5::jsonb, updated_at = now()
        where id = $6`,
      [name, subtitle, summary, meta_description, JSON.stringify(storyBlocks(UROLITHIN_FIELDS.story_blocks)), id],
    );

    await db.query('delete from product_images where product_id = $1', [id]);
    for (const [sort, image] of UROLITHIN_IMAGES.entries()) {
      await db.query(
        'insert into product_images (product_id, path, alt, sort) values ($1, $2, $3, $4)',
        [id, image.path, image.alt, sort],
      );
    }

    log(`Updated product ${id} (${UROLITHIN_SLUG}): copy rewritten, ${UROLITHIN_IMAGES.length} images.`);
    log(`Price left unchanged at ${price_pence} pence.`);
    return id;
  });
}

if (process.argv[1]?.endsWith('update-urolithin.js')) {
  try {
    await migrate();
    await updateUrolithin();
    await close();
  } catch (err) {
    console.error('Update failed:', err);
    process.exitCode = 1;
    await close();
  }
}
