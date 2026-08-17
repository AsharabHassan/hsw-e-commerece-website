// Seed data.
//
// Idempotent: safe to run repeatedly. Products are matched by slug and updated
// rather than duplicated.
//
// EVERY seeded product is flagged is_placeholder = true. That renders a
// visible "not for sale" notice and blocks add-to-basket. Nothing here is real
// product data — the prices are round numbers chosen to look like prices, and
// the copy is written to be replaced. The one exception is the Urolithin A
// Complex page, whose copy is carried over verbatim from the original
// single-page build, TBD markers and all. Those TBDs are deliberate: the mg
// amounts, the NAD+ precursor identity and the capsule format are genuinely
// unresolved, and inventing them would be worse than showing the gap.

import { migrate } from './migrate.js';
import { query, close } from './index.js';

import products from '../models/products.js';
import categories from '../models/categories.js';
import users from '../models/users.js';
import { storyBlocks } from '../lib/sanitize.js';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORIES = [
  {
    slug: 'supplements',
    name: 'Supplements',
    blurb: 'Clinic-formulated capsules with the per-compound split published in full.',
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
// The Urolithin A Complex page, expressed as story blocks
// ---------------------------------------------------------------------------

const UROLITHIN_BLOCKS = [
  {
    type: 'split',
    anchor: 'paradox',
    eyebrow: '01 — The Problem',
    heading: 'You Can\'t Just <span class="gold">Eat Pomegranates</span>',
    media: 'seedfield',
    mediaLabel:
      'Thirty seed shapes, ten of them filled, showing that roughly one in three people can convert pomegranate compounds into Urolithin A',
    mediaCaption:
      '<strong>Around 1 in 3 people</strong> carry the gut bacteria needed — the rest convert little or none',
    paragraphs: [
      'Pomegranates, walnuts and berries contain ellagitannins. They are not Urolithin A. Your gut bacteria have to convert them — and research published in <em>Nature Metabolism</em> found that only a minority of people host the microbial species that can do it.',
      "Everyone else eats the fruit and produces very little of the molecule. This formula skips the conversion step and delivers Urolithin A directly, so the result doesn't depend on which bacteria you happen to carry.",
    ],
  },

  {
    type: 'steps',
    anchor: 'sequence',
    alt: true,
    eyebrow: '02 — The Sequence',
    heading: 'Clear Out. <span class="gold">Rebuild. Run.</span>',
    intro:
      'Mitochondria have a lifecycle. Most formulas act on one point in it. These five compounds are grouped by where they act.',
    items: [
      {
        n: '01',
        title: 'Clear',
        sub: 'Urolithin A',
        body: 'Studied for its role in mitophagy — the process by which cells identify worn-out mitochondria and break them down for recycling. It is the most clinically investigated compound in this category.',
      },
      {
        n: '02',
        title: 'Rebuild',
        sub: 'PQQ',
        body: 'A redox cofactor studied in connection with mitochondrial biogenesis — the formation of new mitochondria. Where Urolithin A is researched for clearance, PQQ is researched for what replaces it.',
      },
      {
        n: '03',
        title: 'Run',
        sub: 'NAD+ Precursor · CoQ10',
        body: 'CoQ10 is a component of the electron transport chain. NAD+ is the coenzyme that chain depends on, and cellular levels are known to decline with age. Both are involved in normal energy-yielding metabolism.',
      },
      {
        n: '04',
        title: 'Signal',
        sub: 'Trans-Resveratrol',
        body: 'A polyphenol studied for its interaction with the sirtuin family of proteins — which require NAD+ to function. Included here in the trans- isomer, the form used in published research.',
      },
    ],
  },

  {
    type: 'facts',
    anchor: 'facts',
    eyebrow: '03 — Full Disclosure',
    heading: 'Every Milligram, <span class="gold">Printed</span>',
    paragraphs: [
      "Plenty of formulas print one large number on the front and a proprietary blend on the back. You get the total, not the split, so you can't tell whether the headline ingredient is 500mg or 50mg.",
      '<strong>1000mg is the weight of the whole complex.</strong> Here is how that 1000mg divides across the five compounds — the same panel that&#39;s printed on the bottle.',
    ],
    footnoteLabel: 'Worth comparing against',
    footnote:
      'Published human trials on Urolithin A have used 250–1000mg of that compound on its own. Whichever brand you buy, check the per-compound figure rather than the front-of-pack total.',
    panelTitle: 'Supplement Facts',
    serving: '2 capsules',
    servingsPerContainer: '60',
    totalRow: { name: 'Urolithin A Complex', amount: '1000 mg' },
    rows: [
      { name: 'Urolithin A', amount: 'TBD mg', tbd: true },
      { name: 'NAD+ precursor — name it', amount: 'TBD mg', tbd: true, nameTbd: true },
      { name: 'Trans-resveratrol', amount: 'TBD mg', tbd: true },
      { name: 'Coenzyme Q10 (form?)', amount: 'TBD mg', tbd: true, nameTbd: true },
      { name: 'PQQ (pyrroloquinoline quinone)', amount: 'TBD mg', tbd: true },
    ],
    footnotes: [
      { label: 'Other ingredients', value: 'TBD', tbd: true },
      { label: 'Capsule shell', value: 'TBD — confirm softgel vs vegetarian', tbd: true },
      { label: 'Allergens', value: 'TBD', tbd: true },
    ],
  },

  {
    type: 'gallery',
    alt: true,
    eyebrow: '04 — Getting It Right',
    heading: 'Take It <span class="gold">With Fat</span>',
    paragraphs: [
      "Two of the five compounds in this formula — CoQ10 and trans-resveratrol — are fat-soluble. Taken with water on an empty stomach, a meaningful share of what you've paid for passes through unabsorbed.",
      "Take two capsules with a meal that contains fat. Eggs, avocado, olive oil, oily fish, full-fat yoghurt or nuts are all sufficient. It doesn't need to be a large meal — it needs to contain fat.",
    ],
    callout: {
      title: 'Simplest routine',
      body: "Two capsules with breakfast, if breakfast contains fat. If it doesn't, take them with your main meal instead. Consistency matters more than the time of day.",
    },
    slots: [
      { label: 'Slot 01', caption: 'Bottle · front' },
      { label: 'Slot 02', caption: 'Label · rear' },
      { label: 'Slot 03', caption: 'Capsules in hand' },
      { label: 'Slot 04', caption: 'Clinic lifestyle' },
    ],
  },

  {
    type: 'faq',
    anchor: 'questions',
    eyebrow: '05 — Questions',
    heading: 'Before <span class="gold">You Buy</span>',
    items: [
      {
        q: 'Is the 1000mg all Urolithin A?',
        a: [
          'No — and any brand that lets you assume so is being slippery. 1000mg is the combined weight of all five compounds. The exact split is printed in the Supplement Facts panel above and on the bottle itself.',
          "Published human trials on Urolithin A have used doses in the 250–1000mg range for that compound alone. Compare the per-compound figure, not the front-of-pack number, whenever you're assessing any product in this category.",
        ],
      },
      {
        q: 'Why five compounds instead of one?',
        a: [
          'Because they act at different points in the mitochondrial lifecycle: clearance, formation, and energy-yielding metabolism. Buying them separately means five bottles, five dosing schedules and five markups.',
          "Worth being straight with you: the individual compounds each have their own research base, but large long-term human trials on this specific five-compound combination don't yet exist. Anyone claiming otherwise is overselling.",
        ],
      },
      {
        q: 'How long until I notice anything?',
        a: [
          'Trials on the individual compounds typically run over weeks to months rather than days. Treat this as something you take consistently over a period, not something you assess after a week.',
          'The 120-capsule bottle is a 60-day supply at two capsules daily, which is a reasonable first period to judge it over.',
        ],
      },
      {
        q: 'Can I take this with my medication?',
        a: [
          'Ask your GP or pharmacist first, particularly if you take anticoagulants or statins, or if you are pregnant or breastfeeding. This applies to CoQ10 and resveratrol specifically, both of which have documented interactions worth checking.',
          'If you are a patient at the clinic, raise it at your next consultation and we will review it against your current treatment plan.',
        ],
      },
      {
        q: 'Is it third-party tested?',
        a: [
          'TBD — add the testing laboratory, what is tested for (identity, potency, heavy metals, microbial), and a link to the current batch certificate of analysis.',
          'If you have batch COAs, publish them. In this category it is the single most persuasive thing you can show a sceptical buyer.',
        ],
      },
      {
        q: "What's your returns policy?",
        a: [
          'TBD — state the returns window and whether opened bottles are covered. Under UK consumer law you must give a 14-day cancellation period for online orders; many supplement brands offer longer.',
        ],
      },
    ],
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
    slug: 'urolithin-a-complex',
    name: 'Urolithin A Complex',
    subtitle:
      "Your gut probably can't make Urolithin A from food. This is the molecule itself — with the four compounds that work alongside it, at doses we publish in full.",
    summary: '120 Capsules · 60-Day Supply',
    category: 'supplements',
    price_pence: 5400,
    meta_description:
      'A 1000mg five-compound mitochondrial complex — Urolithin A, NAD+ precursor, trans-resveratrol, CoQ10 and PQQ. Full dose disclosure. From the Harley Street Wellness clinic.',
    story_blocks: UROLITHIN_BLOCKS,
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
      await products.update(rows[0].id, fields);
    } else {
      await products.create(fields);
    }
  }
  log(`Products: ${PRODUCTS.length} (all flagged as placeholders)`);

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
