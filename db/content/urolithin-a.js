// The Urolithin A Complex listing.
//
// Transcribed from the finished bottle label (September 2026): 60 vegan
// softgels, 2 per serving, 30 servings, 2000mg "Urolithin A Complex" per
// serving. The label declares the complex as a blend — MCT oil, Urolithin A,
// NAD+, CoQ10, resveratrol, PQQ disodium salt — WITHOUT a per-ingredient
// split. The copy below says so plainly rather than implying a split exists.
//
// Shared by db/seed.js (fresh databases) and db/update-urolithin.js (the live
// one). The price is deliberately absent: it is set in the admin panel.

export const UROLITHIN_SLUG = 'urolithin-a-complex';

const IMG = '/img/products/urolithin-a';

/** In display order. The first is the hero shot and the shop-card image. */
export const UROLITHIN_IMAGES = [
  { path: `${IMG}/01-front.jpg`, alt: 'HSW Urolithin A with NAD+, CoQ10 and PQQ — 60 softgels, 30 servings, front of bottle' },
  { path: `${IMG}/02-supplement-facts.jpg`, alt: 'Supplement Facts panel on the side of the bottle' },
  { path: `${IMG}/03-directions-warnings.jpg`, alt: 'Suggested use and warnings on the back of the bottle' },
  { path: `${IMG}/04-three-views.jpg`, alt: 'The bottle from three sides: Supplement Facts, front label and directions' },
  { path: `${IMG}/05-lifestyle-light.jpg`, alt: 'Urolithin A bottle on a stone plinth in soft blue light' },
  { path: `${IMG}/06-lifestyle-blue.jpg`, alt: 'Urolithin A bottle on a dark blue pedestal' },
];

export const UROLITHIN_BLOCKS = [
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
      'Mitochondria have a lifecycle. Most formulas act on one point in it. The five active compounds in this complex are grouped by where they act.',
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
        sub: 'NAD+ · CoQ10',
        body: 'CoQ10 is a component of the electron transport chain. NAD+ (nicotinamide adenine dinucleotide) is the coenzyme that chain depends on, and cellular levels are known to decline with age. Both are involved in normal energy-yielding metabolism.',
      },
      {
        n: '04',
        title: 'Signal',
        sub: 'Resveratrol',
        body: 'A polyphenol studied for its interaction with the sirtuin family of proteins — which require NAD+ to function.',
      },
    ],
  },

  {
    type: 'facts',
    anchor: 'facts',
    eyebrow: '03 — The Label',
    heading: 'What\'s In <span class="gold">Each Serving</span>',
    paragraphs: [
      'One serving is <strong>two softgels</strong>, and each serving contains <strong>2000mg of the Urolithin A Complex</strong>: Urolithin A, NAD+, CoQ10, resveratrol and PQQ, carried in MCT oil.',
      'The panel here is transcribed from the bottle. The complex is declared as a single blend, so the label gives the combined weight rather than a per-ingredient split — and that combined weight includes the MCT oil carrier.',
    ],
    panelTitle: 'Supplement Facts',
    serving: '2 softgels',
    servingsPerContainer: '30',
    totalRow: { name: 'Urolithin A Complex', amount: '2000 mg' },
    rows: [
      { name: 'MCT oil', amount: '†' },
      { name: 'Urolithin A', amount: '†' },
      { name: 'NAD+ (nicotinamide adenine dinucleotide)', amount: '†' },
      { name: 'Coenzyme Q10', amount: '†' },
      { name: 'Resveratrol', amount: '†' },
      { name: 'PQQ (pyrroloquinoline quinone disodium salt)', amount: '†' },
    ],
    footnotes: [
      { label: '†', value: 'Part of the 2000mg complex. Daily value not established.' },
      { label: 'Energy', value: '10 kcal per serving' },
      { label: 'Fat', value: '1 g per serving, of which saturates 1 g' },
      { label: 'Other ingredients', value: 'Vegan softgel, lecithin, annatto (for colour)' },
    ],
  },

  {
    type: 'gallery',
    alt: true,
    eyebrow: '04 — How To Take It',
    heading: 'Two Softgels, <span class="gold">Before Meals</span>',
    paragraphs: [
      'Take two softgels a day, before a meal. CoQ10 and resveratrol are fat-soluble, which is why the complex is carried in MCT oil inside a vegan softgel rather than packed dry into a capsule.',
      'Do not exceed the recommended daily dose. One bottle holds 60 softgels — thirty servings, a month at the suggested use.',
    ],
    callout: {
      title: 'Simplest routine',
      body: 'Two softgels before breakfast. If breakfast is not a fixed point in your day, take them before your main meal instead. Consistency matters more than the time of day.',
    },
    slots: [
      { image: UROLITHIN_IMAGES[1].path, caption: UROLITHIN_IMAGES[1].alt },
      { image: UROLITHIN_IMAGES[2].path, caption: UROLITHIN_IMAGES[2].alt },
      { image: UROLITHIN_IMAGES[3].path, caption: UROLITHIN_IMAGES[3].alt },
      { image: UROLITHIN_IMAGES[4].path, caption: UROLITHIN_IMAGES[4].alt },
      { image: UROLITHIN_IMAGES[5].path, caption: UROLITHIN_IMAGES[5].alt },
    ],
  },

  {
    type: 'steps',
    anchor: 'warnings',
    eyebrow: '05 — Before You Start',
    heading: 'Who It Is <span class="gold">Not For</span>',
    intro: 'Printed on the bottle, and repeated here so you see it before you order rather than after.',
    items: [
      {
        n: '01',
        title: 'Under 18s',
        sub: 'Not for children',
        body: 'Not for use by children or anyone under 18. Keep out of reach of children.',
      },
      {
        n: '02',
        title: 'Pregnancy',
        sub: 'Pregnant or breastfeeding',
        body: 'Not for use if you are pregnant or breastfeeding.',
      },
      {
        n: '03',
        title: 'Medication',
        sub: 'Or a medical condition',
        body: 'Consult your doctor before use if you take any medication or have any medical condition.',
      },
      {
        n: '04',
        title: 'Storage',
        sub: 'Check the seal',
        body: 'Do not use if the safety seal is damaged or missing. Store in a cool, dry place after opening.',
      },
    ],
  },

  {
    type: 'faq',
    anchor: 'questions',
    eyebrow: '06 — Questions',
    heading: 'Before <span class="gold">You Buy</span>',
    items: [
      {
        q: 'Is the 2000mg all Urolithin A?',
        a: [
          'No. 2000mg is the weight of the whole complex in one two-softgel serving: Urolithin A, NAD+, CoQ10, resveratrol and PQQ, together with the MCT oil that carries them.',
          'The label declares the complex as a blend, so it does not break the 2000mg down by ingredient.',
        ],
      },
      {
        q: 'Why five compounds instead of one?',
        a: [
          'Because they act at different points in the mitochondrial lifecycle: clearance, formation, and energy-yielding metabolism. Buying them separately means five bottles, five dosing schedules and five markups.',
          "Worth being straight with you: the individual compounds each have their own research base, but large long-term human trials on this specific combination don't yet exist. Anyone claiming otherwise is overselling.",
        ],
      },
      {
        q: 'Is it vegan?',
        a: [
          'The softgel shell is vegan. The other ingredients are lecithin and annatto, which is used for colour. The bottle also carries non-GMO, gluten-free and halal marks.',
        ],
      },
      {
        q: 'How long until I notice anything?',
        a: [
          'Trials on the individual compounds typically run over weeks to months rather than days. Treat this as something you take consistently over a period, not something you assess after a week.',
          'Each bottle is a 30-day supply at two softgels daily.',
        ],
      },
      {
        q: 'Can I take this with my medication?',
        a: [
          'Ask your GP or pharmacist first, particularly if you take anticoagulants or statins. This applies to CoQ10 and resveratrol specifically, both of which have documented interactions worth checking. It is not for use during pregnancy or breastfeeding.',
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
        q: 'What is your returns policy?',
        a: [
          'TBD — state the returns window and whether opened bottles are covered. Under UK consumer law you must give a 14-day cancellation period for online orders; many supplement brands offer longer.',
        ],
      },
    ],
  },
];

/** Every product column except price_pence, is_published and is_placeholder. */
export const UROLITHIN_FIELDS = {
  slug: UROLITHIN_SLUG,
  name: 'Urolithin A Complex',
  subtitle:
    "Your gut probably can't make Urolithin A from food. This is the molecule itself — with NAD+, CoQ10, resveratrol and PQQ, in a vegan softgel.",
  summary: '60 Softgels · 30 Servings',
  meta_description:
    'Urolithin A with NAD+, CoQ10, resveratrol and PQQ — a 2000mg complex per two-softgel serving. 60 vegan softgels, 30 servings. From Harley Street Wellness.',
  story_blocks: UROLITHIN_BLOCKS,
};
