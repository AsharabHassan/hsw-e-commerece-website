// Sanitisation for admin-authored story-block content.
//
// Sanitising happens ON SAVE, not on render. That way the database only ever
// holds content that is safe to emit, and there is exactly one place to audit.
// Everything else in the application relies on Nunjucks autoescaping.
//
// The allow-list is deliberately tiny: the design calls for emphasis, line
// breaks, the gold accent span and links. Nothing else. An unknown tag is
// escaped rather than dropped, so an operator who pastes something odd sees
// their text rather than losing it silently.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for HTML output. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

// tag -> which attributes survive, and how
const ALLOWED_TAGS = {
  em: null,
  strong: null,
  br: null,
  span: 'gold-class-only',
  a: 'href-only',
};

const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/))/i;

function renderOpenTag(tag, rawAttrs) {
  const policy = ALLOWED_TAGS[tag];

  if (policy === null) return `<${tag}>`;

  if (policy === 'gold-class-only') {
    // The one class the design uses. Anything else, including every event
    // handler, is discarded.
    return /class\s*=\s*["']?gold["']?/i.test(rawAttrs) ? '<span class="gold">' : '<span>';
  }

  if (policy === 'href-only') {
    const match = rawAttrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
    if (!SAFE_HREF.test(href)) return '<a>';

    const external = /^https?:\/\//i.test(href);
    const rel = external ? ' rel="noopener noreferrer" target="_blank"' : '';
    return `<a href="${escapeHtml(href)}"${rel}>`;
  }

  return '';
}

/**
 * Escape a string, then re-admit a small allow-list of inline tags.
 * @param {unknown} value
 * @returns {string} HTML safe to emit
 */
export function inlineHtml(value) {
  if (value === null || value === undefined) return '';

  const escaped = escapeHtml(value);

  // Walk the escaped text and restore only the allow-listed tags. Working on
  // the escaped string means anything not matched here stays escaped.
  return escaped.replace(
    /&lt;(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^&]|&(?!gt;))*?)\s*\/?&gt;/g,
    (whole, closing, rawTag, rawAttrs) => {
      const tag = rawTag.toLowerCase();
      if (!(tag in ALLOWED_TAGS)) return whole;
      if (closing) return tag === 'br' ? whole : `</${tag}>`;

      // Attributes come back escaped; unescape quotes so hrefs can be read.
      const attrs = rawAttrs.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      return renderOpenTag(tag, attrs);
    },
  );
}

/** Plain text: escaped, no tags admitted at all. */
function text(value) {
  return escapeHtml(value);
}

/** Only our own uploaded images may be referenced. */
function imagePath(value) {
  const str = typeof value === 'string' ? value.trim() : '';
  // /uploads/ holds admin uploads on the droplet; /img/products/ holds
  // photography committed to the repo, so it ships with every deploy.
  return /^\/(?:uploads|img\/products\/[\w-]+)\/[\w-]+(?:\.[\w-]+)*$/.test(str) ? str : null;
}

function arrayOf(value, mapper, limit = 60) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object').slice(0, limit).map(mapper);
}

/**
 * Body copy is an array of paragraphs, not one HTML blob. The allow-list has
 * no block-level tags in it, so paragraph structure has to be data — which
 * also means the admin form can edit one paragraph without touching the rest.
 */
function paragraphs(value, limit = 20) {
  if (typeof value === 'string') return value.trim() ? [inlineHtml(value)] : [];
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map(inlineHtml).filter((p) => p.trim() !== '');
}

// Fields every block shares.
function common(b) {
  return {
    eyebrow: text(b.eyebrow),
    heading: inlineHtml(b.heading),
    // Renders on the alternate background, giving the page its banding rhythm.
    alt: Boolean(b.alt),
    anchor: /^[a-z][a-z0-9-]{0,40}$/.test(b.anchor ?? '') ? b.anchor : null,
  };
}

// One cleaner per block type. A type absent from this table is dropped.
const BLOCK_TYPES = {
  split: (b) => ({
    type: 'split',
    ...common(b),
    // A named, code-backed illustration — never operator-supplied markup.
    media: ['seedfield', 'none'].includes(b.media) ? b.media : 'none',
    mediaCaption: inlineHtml(b.mediaCaption),
    mediaLabel: text(b.mediaLabel),
    paragraphs: paragraphs(b.paragraphs),
  }),

  steps: (b) => ({
    type: 'steps',
    ...common(b),
    intro: inlineHtml(b.intro),
    items: arrayOf(b.items, (item) => ({
      n: text(item.n),
      title: text(item.title),
      sub: text(item.sub),
      body: inlineHtml(item.body),
    })),
  }),

  facts: (b) => ({
    type: 'facts',
    ...common(b),
    paragraphs: paragraphs(b.paragraphs),
    footnoteLabel: text(b.footnoteLabel),
    footnote: inlineHtml(b.footnote),

    panelTitle: text(b.panelTitle) || 'Supplement Facts',
    serving: text(b.serving),
    servingsPerContainer: text(b.servingsPerContainer),

    totalRow: b.totalRow && typeof b.totalRow === 'object'
      ? { name: inlineHtml(b.totalRow.name), amount: text(b.totalRow.amount), tbd: Boolean(b.totalRow.tbd) }
      : null,

    rows: arrayOf(b.rows, (row) => ({
      name: inlineHtml(row.name),
      amount: text(row.amount),
      // Marks an unresolved value so the template renders the gold
      // placeholder treatment the original page used.
      tbd: Boolean(row.tbd),
      nameTbd: Boolean(row.nameTbd),
    })),

    footnotes: arrayOf(b.footnotes, (note) => ({
      label: text(note.label),
      value: inlineHtml(note.value),
      tbd: Boolean(note.tbd),
    })),
  }),

  gallery: (b) => ({
    type: 'gallery',
    ...common(b),
    paragraphs: paragraphs(b.paragraphs),
    callout: b.callout && typeof b.callout === 'object'
      ? { title: text(b.callout.title), body: inlineHtml(b.callout.body) }
      : null,
    slots: arrayOf(b.slots, (slot) => ({
      image: imagePath(slot.image),
      label: text(slot.label),
      caption: text(slot.caption),
    })),
  }),

  faq: (b) => ({
    type: 'faq',
    ...common(b),
    items: arrayOf(b.items, (item) => ({
      q: text(item.q),
      a: paragraphs(item.a),
    })),
  }),

  prose: (b) => ({
    type: 'prose',
    ...common(b),
    paragraphs: paragraphs(b.paragraphs),
    centred: Boolean(b.centred),
  }),
};

/**
 * Validate and clean an array of story blocks.
 * Unknown types are dropped; every text field is sanitised.
 * @param {unknown} blocks
 * @returns {object[]}
 */
export function storyBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];

  return blocks
    .filter((b) => b && typeof b === 'object' && typeof b.type === 'string')
    .slice(0, 40)
    .map((b) => BLOCK_TYPES[b.type]?.(b))
    .filter(Boolean);
}

export const BLOCK_TYPE_NAMES = Object.keys(BLOCK_TYPES);
