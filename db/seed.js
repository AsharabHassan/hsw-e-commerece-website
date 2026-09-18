// Seed data.
//
// Idempotent: safe to run repeatedly. Products are matched by slug and updated
// rather than duplicated.
//
// EVERY seeded product is flagged is_placeholder = true. That renders a
// visible "not for sale" notice and blocks add-to-basket. Nothing here is real
// product data — the prices are round numbers chosen to look like prices, and
// the copy is written to be replaced. The one exception is the Urolithin A
// Complex, whose copy and photography live in ./content/urolithin-a.js and
// are transcribed from the finished bottle.

import { migrate } from './migrate.js';
import { query, close } from './index.js';

import products from '../models/products.js';
import categories from '../models/categories.js';
import users from '../models/users.js';
import { storyBlocks } from '../lib/sanitize.js';
import { UROLITHIN_FIELDS, UROLITHIN_IMAGES } from './content/urolithin-a.js';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORIES = [
  {
    slug: 'supplements',
    name: 'Supplements',
    blurb: 'Clinic-formulated supplements, with the full label published.',
    sort: 1,
  },
  {
    slug: 'iv-therapy',
    name: 'IV Therapy',
    blurb: 'Infusion protocols administered at the Harley Street clinic.',
    sort: 2,
  },
  {
    slug: 'testing',
    name: 'Testing',
    blurb: 'Blood panels and diagnostics, reviewed by a clinician.',
    sort: 3,
  },
];

// ---------------------------------------------------------------------------
// Methylene Blue
//
// This product needs more care than anything else in the catalogue, and the
// page says so rather than glossing over it.
//
//   1. Methylthioninium chloride is a LICENSED MEDICINE in the UK, given
//      intravenously for methaemoglobinaemia. A product sold for ingestion
//      under a clinic's name is at obvious risk of being treated as an
//      unlicensed medicinal product by function.
//   2. It is a potent reversible MAO-A inhibitor. Combined with an SSRI,
//      SNRI or MAOI it can precipitate serotonin syndrome, which has been
//      fatal. This is not a theoretical interaction.
//   3. It causes haemolysis in G6PD deficiency.
//   4. Laboratory-grade and industrial-grade methylene blue are dyes, not
//      products for ingestion, and can carry heavy-metal contamination.
//
// None of that is a reason to leave the listing vague. It is a reason to put
// the questions on the page where the operator cannot miss them.
// ---------------------------------------------------------------------------

const METHYLENE_BLUE_BLOCKS = [
  {
    type: 'prose',
    eyebrow: '01 — What It Is',
    heading: 'A Dye That <span class="gold">Carries Electrons</span>',
    paragraphs: [
      'Methylene blue is the common name for <em>methylthioninium chloride</em>. It was first synthesised as a textile dye in 1876 and became the first fully synthetic compound used as a medicine.',
      'Its research interest here is narrow and specific: in the mitochondrial electron transport chain, it can accept and donate electrons directly, which is why it has been studied as an alternative electron carrier when the normal chain is impaired. That is a different mechanism from anything else in this range.',
      '<strong>It is also a licensed medicine.</strong> In the UK, methylthioninium chloride is authorised as a prescription-only injection for methaemoglobinaemia. Anything sold here is a different thing sold for a different purpose, and the distinction matters — see the questions below.',
    ],
  },

  {
    type: 'steps',
    alt: true,
    eyebrow: '02 — Before Anything Else',
    heading: 'Three Things That <span class="gold">Rule People Out</span>',
    intro:
      'This compound has real contraindications. They are listed before the product detail rather than after it, because for some people the answer is simply no.',
    items: [
      {
        n: '01',
        title: 'Serotonergic medication',
        sub: 'SSRIs · SNRIs · MAOIs · triptans',
        body: 'Methylene blue is a potent reversible inhibitor of monoamine oxidase A. Taken alongside a serotonergic drug it can precipitate serotonin syndrome, which is a medical emergency and has been fatal. If you take an antidepressant of any kind, do not take this without speaking to the prescriber first.',
      },
      {
        n: '02',
        title: 'G6PD deficiency',
        sub: 'Glucose-6-phosphate dehydrogenase',
        body: 'In people with G6PD deficiency, methylene blue can cause haemolysis — the destruction of red blood cells. G6PD deficiency is common in some populations and is frequently undiagnosed. Testing is a simple blood test.',
      },
      {
        n: '03',
        title: 'Pregnancy and breastfeeding',
        sub: 'Not suitable',
        body: 'Methylthioninium chloride is not considered suitable during pregnancy. Do not take this if you are pregnant, trying to conceive, or breastfeeding.',
      },
    ],
  },

  {
    type: 'facts',
    eyebrow: '03 — Full Disclosure',
    heading: 'Grade Is <span class="gold">The Whole Question</span>',
    paragraphs: [
      'There is a large difference between pharmaceutical-grade methylthioninium chloride and the laboratory or industrial dye sold under the same common name. The dye grades are not manufactured for ingestion and can carry heavy-metal contamination.',
      '<strong>The only figure that matters on this label is purity, and who certified it.</strong> Any seller who will not show you a certificate of analysis for the batch in your hand is asking you to take their word for it.',
    ],
    footnoteLabel: 'Worth comparing against',
    footnote:
      'Published human research on methylene blue outside its licensed indication has generally used low doses, and dose-response is not straightforward — some effects reported at low doses reverse at higher ones. Check the per-serving figure against the literature, not against the front of the bottle.',
    panelTitle: 'Supplement Facts',
    serving: 'TBD',
    servingsPerContainer: 'TBD',
    totalRow: { name: 'Methylthioninium chloride', amount: 'TBD mg', tbd: true },
    rows: [
      { name: 'Grade — USP / pharmaceutical?', amount: 'TBD', tbd: true, nameTbd: true },
      { name: 'Assay purity', amount: 'TBD %', tbd: true, nameTbd: true },
      { name: 'Heavy metals — tested to what limit?', amount: 'TBD', tbd: true, nameTbd: true },
      { name: 'Delivery format — capsule, tablet or solution?', amount: 'TBD', tbd: true, nameTbd: true },
    ],
    footnotes: [
      { label: 'Other ingredients', value: 'TBD', tbd: true },
      { label: 'Certificate of analysis', value: 'TBD — publish the batch COA', tbd: true },
      { label: 'Manufacturer', value: 'TBD', tbd: true },
    ],
  },

  {
    type: 'gallery',
    alt: true,
    eyebrow: '04 — Practical Notes',
    heading: 'It Will Turn Your <span class="gold">Urine Blue</span>',
    paragraphs: [
      'This is expected and harmless. Methylene blue is a dye, it is excreted renally, and blue-green urine is the visible consequence. It can also stain the mouth and teeth temporarily, and will stain fabric permanently.',
      'Do not be alarmed by the colour. Do be alarmed by agitation, tremor, a racing heart, sweating or confusion — those are the early signs of serotonin syndrome, and they are a reason to stop and seek medical advice immediately.',
    ],
    callout: {
      title: 'Before you order',
      body: 'If you are a patient at the clinic, raise this at your next consultation. Given the interaction profile, this is a compound we would rather discuss with you than sell to you blind.',
    },
    slots: [
      { label: 'Slot 01', caption: 'Bottle · front' },
      { label: 'Slot 02', caption: 'Label · rear' },
      { label: 'Slot 03', caption: 'Certificate of analysis' },
      { label: 'Slot 04', caption: 'Clinic lifestyle' },
    ],
  },

  {
    type: 'faq',
    eyebrow: '05 — Questions',
    heading: 'Before <span class="gold">You Buy</span>',
    items: [
      {
        q: 'Is it legal to sell methylene blue in the UK?',
        a: [
          'TBD — this is the question that must be answered before this product is published. Methylthioninium chloride holds a UK marketing authorisation as a prescription-only medicine. A product presented for ingestion may be treated by the MHRA as an unlicensed medicinal product, either by presentation or by function, regardless of how it is labelled.',
          'It is also not an authorised novel food in Great Britain. Take advice on both points, in writing, before this listing goes live. Selling it under a Harley Street clinic\'s name raises the regulatory bar rather than lowering it.',
        ],
      },
      {
        q: 'Can I take this with my antidepressant?',
        a: [
          'Do not, without speaking to your prescriber first. Methylene blue inhibits monoamine oxidase A. Combined with an SSRI, SNRI, MAOI, triptan, tramadol or lithium, it can cause serotonin syndrome. Cases have been fatal.',
          'This is the single most important thing on this page. It is not a precaution added for legal cover.',
        ],
      },
      {
        q: 'What grade is it, and who tested it?',
        a: [
          'TBD — state the grade, the assay purity, the laboratory, what was tested for, and publish the batch certificate of analysis.',
          'Laboratory-grade and industrial-grade methylene blue are dyes. They are not manufactured to be swallowed and may contain heavy-metal contamination. If a seller will not tell you the grade, assume the worst one.',
        ],
      },
      {
        q: 'What dose?',
        a: [
          'TBD — state the per-serving amount and the basis for choosing it.',
          'Published human research outside the licensed indication has generally used low doses. Dose-response is not linear for every reported effect, so more is not simply stronger. Do not guess, and do not scale up.',
        ],
      },
      {
        q: 'Why does it turn urine blue?',
        a: [
          'Because it is a dye and it is excreted by the kidneys. The colour is expected and harmless. It may also temporarily stain the mouth and teeth, and it stains fabric permanently.',
        ],
      },
      {
        q: 'What is your returns policy?',
        a: [
          'TBD — state the returns window and whether opened bottles are covered. Under UK consumer law you must give a 14-day cancellation period for online orders. Sealed supplements that have been opened are exempt on hygiene grounds.',
        ],
      },
    ],
  },
];

/** A generic three-block page for the placeholder products. */
function genericBlocks({ what, who, how }) {
  return [
    {
      type: 'prose',
      eyebrow: 'Placeholder copy',
      heading: 'Replace This <span class="gold">Copy</span>',
      paragraphs: [
        'This is seeded placeholder text so the page has something to render. Edit this product in the admin panel and replace these blocks with the real description.',
        what,
      ],
    },
    {
      type: 'steps',
      alt: true,
      eyebrow: 'How it works',
      heading: 'Three <span class="gold">Steps</span>',
      items: [
        { n: '01', title: 'Who it is for', sub: 'Placeholder', body: who },
        { n: '02', title: 'How to take it', sub: 'Placeholder', body: how },
        {
          n: '03',
          title: 'What to expect',
          sub: 'Placeholder',
          body: 'Replace this with a factual description of what published research reports, written as a description of findings rather than as a claim made for the product.',
        },
      ],
    },
    {
      type: 'faq',
      eyebrow: 'Questions',
      heading: 'Before <span class="gold">You Buy</span>',
      items: [
        {
          q: 'Is this real product data?',
          a: [
            'No. This product is seeded placeholder content, which is why it carries a "not for sale" notice and cannot be added to a basket. Edit it in the admin panel and clear the placeholder flag once the real details are in.',
          ],
        },
        {
          q: 'What needs checking before this goes live?',
          a: [
            'The price, the ingredient amounts, the allergen and capsule information, third-party testing, and whether every ingredient is lawfully sellable as a food supplement in Great Britain.',
          ],
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const PRODUCTS = [
  {
    ...UROLITHIN_FIELDS,
    category: 'supplements',
    price_pence: 5400,
    images: UROLITHIN_IMAGES,
  },

  {
    slug: 'methylene-blue',
    name: 'Methylene Blue',
    subtitle:
      'Methylthioninium chloride. An alternative electron carrier studied for its behaviour in the mitochondrial electron transport chain.',
    summary: 'Placeholder listing — regulatory status unresolved',
    category: 'supplements',
    price_pence: 3900,
    meta_description:
      'Methylene blue (methylthioninium chloride) — pharmaceutical-grade. Placeholder listing pending regulatory review.',
    story_blocks: METHYLENE_BLUE_BLOCKS,
  },

  {
    slug: 'nad-precursor',
    name: 'NAD+ Precursor',
    subtitle: 'Placeholder listing — replace with the real formulation.',
    summary: '60 Capsules · 30-Day Supply',
    category: 'supplements',
    price_pence: 4900,
    meta_description: 'Placeholder product. Edit in the admin panel before publishing.',
    story_blocks: genericBlocks({
      what: 'Describe the precursor used and, critically, name it. NR carries a pre-Brexit EU authorisation; NMN does not, and is not lawfully sellable as a food supplement in Great Britain. This distinction must be settled before this product goes anywhere near a customer.',
      who: 'Describe who this is for, without making a health claim.',
      how: 'State the dose, the timing, and whether it should be taken with food.',
    }),
  },

  {
    slug: 'high-strength-omega-3',
    name: 'High-Strength Omega-3',
    subtitle: 'Placeholder listing — replace with the real formulation.',
    summary: '90 Softgels · 45-Day Supply',
    category: 'supplements',
    price_pence: 3200,
    story_blocks: genericBlocks({
      what: 'State the EPA and DHA content per serving, the source, and the purity testing.',
      who: 'Describe who this is for.',
      how: 'Take with a meal containing fat.',
    }),
  },

  {
    slug: 'vitamin-d3-k2',
    name: 'Vitamin D3 + K2',
    subtitle: 'Placeholder listing — replace with the real formulation.',
    summary: '90 Capsules · 90-Day Supply',
    category: 'supplements',
    price_pence: 2400,
    story_blocks: genericBlocks({
      what: 'State the IU of D3 and the microgram amount and form of K2 (MK-4 or MK-7).',
      who: 'Describe who this is for.',
      how: 'One capsule daily with food.',
    }),
  },

  {
    slug: 'magnesium-complex',
    name: 'Magnesium Complex',
    subtitle: 'Placeholder listing — replace with the real formulation.',
    summary: '120 Capsules · 60-Day Supply',
    category: 'supplements',
    price_pence: 2800,
    story_blocks: genericBlocks({
      what: 'Name each magnesium form and its elemental magnesium content — glycinate, citrate and malate are not interchangeable.',
      who: 'Describe who this is for.',
      how: 'Two capsules in the evening.',
    }),
  },

  {
    slug: 'methylated-b-complex',
    name: 'Methylated B Complex',
    subtitle: 'Placeholder listing — replace with the real formulation.',
    summary: '60 Capsules · 60-Day Supply',
    category: 'supplements',
    price_pence: 2600,
    story_blocks: genericBlocks({
      what: 'List each B vitamin, its form, its amount and its NRV percentage.',
      who: 'Describe who this is for.',
      how: 'One capsule with breakfast.',
    }),
  },

  {
    slug: 'myers-cocktail-infusion',
    name: 'Myers Cocktail Infusion',
    subtitle: 'Placeholder listing — administered at the clinic.',
    summary: 'Single Session · Approx. 45 Minutes',
    category: 'iv-therapy',
    price_pence: 22500,
    story_blocks: genericBlocks({
      what: 'Describe the infusion contents and who administers it. Note that selling a clinical service online has different regulatory requirements from selling a supplement — booking, consent and clinical screening all need designing before this can be sold.',
      who: 'Describe the screening required before a patient can book.',
      how: 'Explain what happens on the day.',
    }),
  },

  {
    slug: 'nad-infusion',
    name: 'NAD+ Infusion',
    subtitle: 'Placeholder listing — administered at the clinic.',
    summary: 'Single Session · Approx. 3 Hours',
    category: 'iv-therapy',
    price_pence: 45000,
    story_blocks: genericBlocks({
      what: 'Describe the protocol, the dose and the clinical supervision. This is a clinical service, not a retail product.',
      who: 'Describe the screening and contraindications.',
      how: 'Explain the session and aftercare.',
    }),
  },

  {
    slug: 'comprehensive-blood-panel',
    name: 'Comprehensive Blood Panel',
    subtitle: 'Placeholder listing — replace with the real panel contents.',
    summary: 'In-Clinic Draw · Results in 5 Working Days',
    category: 'testing',
    price_pence: 32500,
    story_blocks: genericBlocks({
      what: 'List every marker included in the panel, and state who reviews the results.',
      who: 'Describe who the panel is appropriate for.',
      how: 'Explain fasting requirements and how results are delivered.',
    }),
  },

  {
    slug: 'micronutrient-panel',
    name: 'Micronutrient Panel',
    subtitle: 'Placeholder listing — replace with the real panel contents.',
    summary: 'In-Clinic Draw · Results in 10 Working Days',
    category: 'testing',
    price_pence: 28000,
    story_blocks: genericBlocks({
      what: 'List the micronutrients measured and the reference ranges used.',
      who: 'Describe who the panel is appropriate for.',
      how: 'Explain how results are interpreted and by whom.',
    }),
  },
];

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * @param {{adminEmail?: string, adminPassword?: string, quiet?: boolean}} options
 */
export async function seed({ adminEmail, adminPassword, quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;

  // Categories -------------------------------------------------------------
  const categoryIds = new Map();
  for (const spec of CATEGORIES) {
    const existing = await categories.getBySlug(spec.slug);
    const row = existing
      ? await categories.update(existing.id, spec)
      : await categories.create(spec);
    categoryIds.set(spec.slug, row.id);
  }
  log(`Categories: ${CATEGORIES.length}`);

  // Products ---------------------------------------------------------------
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const spec of PRODUCTS) {
    const fields = {
      slug: spec.slug,
      name: spec.name,
      subtitle: spec.subtitle,
      summary: spec.summary,
      meta_description: spec.meta_description ?? null,
      price_pence: spec.price_pence,
      category_id: categoryIds.get(spec.category) ?? null,
      story_blocks: storyBlocks(spec.story_blocks),
      is_published: true,
      // Deliberate, and the whole point of the flag: seeded content is
      // visible so the shop can be reviewed, but cannot be bought.
      is_placeholder: true,
    };

    const { rows } = await query('select id from products where slug = $1', [spec.slug]);

    if (rows.length > 0) {
      // A product that already exists is left ALONE.
      //
      // Once the operator has edited a product in the admin panel — set the
      // real price, written the real copy, cleared the placeholder flag — a
      // re-run of the seed must not quietly undo that work. Re-seeding is
      // something people do casually during a deploy; silently reverting a
      // live catalogue to invented prices is not a recoverable mistake.
      //
      // Pass SEED_FORCE=1 to overwrite deliberately.
      if (process.env.SEED_FORCE === '1') {
        await products.update(rows[0].id, fields);
        updated += 1;
      } else {
        skipped += 1;
      }
    } else {
      const product = await products.create(fields);
      for (const [sort, image] of (spec.images ?? []).entries()) {
        await products.addImage(product.id, { ...image, sort });
      }
      created += 1;
    }
  }

  log(`Products: ${created} created, ${updated} overwritten, ${skipped} left untouched`);
  if (skipped > 0) {
    log('  (existing products were not modified — pass SEED_FORCE=1 to overwrite them)');
  }

  // Admin user -------------------------------------------------------------
  const email = adminEmail ?? process.env.ADMIN_EMAIL;
  const password = adminPassword ?? process.env.ADMIN_PASSWORD;

  if (email && password) {
    const existing = await users.findByEmail(email);
    if (existing) {
      await users.setPassword(existing.id, password);
      await users.setAdmin(existing.id, true);
      log(`Admin user updated: ${email}`);
    } else {
      await users.create({ email, password, name: 'Administrator', is_admin: true });
      log(`Admin user created: ${email}`);
    }
  } else {
    log('No admin user created. Set ADMIN_EMAIL and ADMIN_PASSWORD, or pass them to seed().');
  }
}

// `npm run seed`
if (process.argv[1]?.endsWith('seed.js')) {
  try {
    await migrate();
    await seed();
    console.log('\nSeed complete.');
    console.log('Every seeded product is a PLACEHOLDER: visible in the shop, but');
    console.log('not purchasable. Edit each one in /admin and untick "Placeholder"');
    console.log('once the real copy, price and compliance checks are in place.\n');
    await close();
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
    await close();
  }
}

export default seed;
