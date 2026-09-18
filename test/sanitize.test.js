import test from 'node:test';
import assert from 'node:assert/strict';

import { inlineHtml, storyBlocks } from '../lib/sanitize.js';

test('inlineHtml', async (t) => {
  await t.test('keeps the allow-listed inline tags', () => {
    const out = inlineHtml('You Cannot Just <span class="gold">Eat Pomegranates</span>');
    assert.equal(out, 'You Cannot Just <span class="gold">Eat Pomegranates</span>');
  });

  await t.test('escapes quotes in text, which renders identically', () => {
    // Escaping ' and " matters because the sanitiser re-reads attribute values
    // out of the escaped string; &#39; renders as an apostrophe regardless.
    assert.equal(inlineHtml("You Can't"), 'You Can&#39;t');
  });

  await t.test('keeps em, strong and br', () => {
    assert.equal(inlineHtml('<em>a</em> <strong>b</strong><br>c'), '<em>a</em> <strong>b</strong><br>c');
  });

  await t.test('escapes script tags rather than dropping the text', () => {
    const out = inlineHtml('safe<script>alert(1)</script>');
    assert.ok(!out.includes('<script'), 'no live script tag');
    assert.ok(out.includes('&lt;script&gt;'), 'the text is preserved, escaped');
  });

  await t.test('strips a class other than gold from a span', () => {
    const out = inlineHtml('<span class="evil" onclick="x()">hi</span>');
    assert.equal(out, '<span>hi</span>');
  });

  await t.test('drops event handler attributes', () => {
    const out = inlineHtml('<strong onmouseover="steal()">hi</strong>');
    assert.equal(out, '<strong>hi</strong>');
  });

  await t.test('rejects javascript: and data: hrefs', () => {
    assert.ok(!inlineHtml('<a href="javascript:alert(1)">x</a>').includes('javascript:'));
    assert.ok(!inlineHtml('<a href="data:text/html,<script>">x</a>').includes('data:'));
  });

  await t.test('keeps http, https and mailto hrefs', () => {
    assert.ok(inlineHtml('<a href="https://example.com">x</a>').includes('href="https://example.com"'));
    assert.ok(inlineHtml('<a href="mailto:a@b.co">x</a>').includes('mailto:a@b.co'));
    assert.ok(inlineHtml('<a href="/shop">x</a>').includes('href="/shop"'));
  });

  await t.test('escapes bare ampersands and angle brackets', () => {
    assert.equal(inlineHtml('Fish & chips < 5'), 'Fish &amp; chips &lt; 5');
  });

  await t.test('handles non-string input without throwing', () => {
    assert.equal(inlineHtml(null), '');
    assert.equal(inlineHtml(undefined), '');
    assert.equal(inlineHtml(42), '42');
  });
});

test('storyBlocks', async (t) => {
  await t.test('drops unknown block types', () => {
    const out = storyBlocks([
      { type: 'faq', items: [{ q: 'Q', a: 'A' }] },
      { type: 'evil', html: '<script>alert(1)</script>' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'faq');
  });

  await t.test('sanitises text inside every block type', () => {
    const out = storyBlocks([
      { type: 'split', heading: '<script>x</script>H', paragraphs: ['<script>y</script>B'] },
      { type: 'steps', items: [{ n: '01', title: '<script>t</script>', body: 'b' }] },
      { type: 'facts', rows: [{ name: '<script>n</script>', amount: '10 mg' }] },
      { type: 'faq', items: [{ q: '<script>q</script>', a: ['a'] }] },
      { type: 'gallery', slots: [{ image: '/uploads/a.jpg', caption: '<script>c</script>' }] },
      { type: 'prose', paragraphs: ['<script>p</script>'] },
    ]);
    const json = JSON.stringify(out);
    assert.ok(!json.includes('<script'), 'no live script tag survived any block type');
    assert.equal(out.length, 6);
  });

  await t.test('preserves the facts table structure', () => {
    const [block] = storyBlocks([
      {
        type: 'facts',
        heading: 'Every Milligram, Printed',
        serving: '2 capsules',
        servingsPerContainer: '60',
        totalRow: { name: 'Urolithin A Complex', amount: '1000 mg' },
        rows: [{ name: 'Urolithin A', amount: 'TBD', tbd: true }],
        footnotes: [{ label: 'Other ingredients', value: 'TBD', tbd: true }],
      },
    ]);
    assert.equal(block.serving, '2 capsules');
    assert.equal(block.servingsPerContainer, '60');
    assert.equal(block.totalRow.amount, '1000 mg');
    assert.equal(block.rows[0].amount, 'TBD');
    assert.equal(block.rows[0].tbd, true);
    assert.equal(block.footnotes[0].label, 'Other ingredients');
    assert.equal(block.footnotes[0].tbd, true);
    assert.equal(block.panelTitle, 'Supplement Facts', 'panel title defaults');
  });

  await t.test('body copy is an array of paragraphs, and a bare string is accepted', () => {
    const [block] = storyBlocks([{ type: 'prose', paragraphs: 'one paragraph' }]);
    assert.deepEqual(block.paragraphs, ['one paragraph']);
  });

  await t.test('an anchor must be a plain slug', () => {
    const [ok] = storyBlocks([{ type: 'prose', anchor: 'how-it-works' }]);
    assert.equal(ok.anchor, 'how-it-works');
    const [bad] = storyBlocks([{ type: 'prose', anchor: '"><script>x</script>' }]);
    assert.equal(bad.anchor, null);
  });

  await t.test('tolerates rubbish input', () => {
    assert.deepEqual(storyBlocks(null), []);
    assert.deepEqual(storyBlocks('not an array'), []);
    assert.deepEqual(storyBlocks([null, 42, 'x']), []);
    assert.deepEqual(storyBlocks([{ noType: true }]), []);
  });

  await t.test('rejects a gallery image path outside /uploads', () => {
    const [block] = storyBlocks([
      { type: 'gallery', slots: [{ image: 'https://evil.example/x.jpg', caption: 'c' }] },
    ]);
    assert.equal(block.slots[0].image, null, 'external image sources are not accepted');
  });
});

test('gallery image paths', async (t) => {
  const image = (path) => storyBlocks([{ type: 'gallery', slots: [{ image: path }] }])[0].slots[0].image;

  await t.test('accepts admin uploads and committed product photography', () => {
    assert.equal(image('/uploads/1786964983829-8ff31e1e49d1e12d.png'), '/uploads/1786964983829-8ff31e1e49d1e12d.png');
    assert.equal(image('/img/products/urolithin-a/01-front.jpg'), '/img/products/urolithin-a/01-front.jpg');
  });

  await t.test('rejects traversal, other directories and external URLs', () => {
    for (const bad of [
      '/uploads/../app.js',
      '/img/products/../../config.js',
      '/img/products/a/b/c.jpg',
      '/css/hsw.css',
      'https://evil.example/x.jpg',
      '//evil.example/x.jpg',
    ]) {
      assert.equal(image(bad), null, bad);
    }
  });
});
