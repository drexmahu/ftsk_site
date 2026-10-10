const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../../static/js/404.js'), 'utf8');

async function simulate(base, requested, enabled, previewExists = true) {
  const nodes = [
    { href: new URL(base).pathname },
    { href: new URL(base).pathname + 'turak/?page=2#details' },
    { href: '#local' },
    { href: 'https://other.example.org/' },
    { 'data-search-index': new URL(base).pathname + 'searchindex.json' },
  ].map(attributes => ({
    attributes,
    getAttribute: name => attributes[name] || null,
    setAttribute: (name, value) => { attributes[name] = value; },
  }));
  const document = {
    querySelector: selector => selector.startsWith('.error') ? enabled : { href: base },
    querySelectorAll: () => nodes,
  };
  await vm.runInNewContext(script, {
    document, location: new URL(requested), URL, window: {},
    fetch: async () => ({ ok: previewExists }),
  });
  return nodes.map(node => node.attributes);
}

async function run() {
const preview = await simulate('https://owner.github.io/site/', 'https://owner.github.io/site/pr-preview/pr-7/missing/page/', true);
assert.equal(preview[0].href, '/site/pr-preview/pr-7/');
assert.equal(preview[1].href, '/site/pr-preview/pr-7/turak/?page=2#details');
assert.equal(preview[2].href, '#local');
assert.equal(preview[3].href, 'https://other.example.org/');
assert.equal(preview[4]['data-search-index'], '/site/pr-preview/pr-7/searchindex.json');
const nested = await simulate('https://owner.github.io/site/', 'https://owner.github.io/site/pr-preview/pr-7/missing/pr-preview/pr-8/', true);
assert.equal(nested[0].href, '/site/pr-preview/pr-7/');
const production = await simulate('https://example.org/', 'https://example.org/pr-preview/pr-7/missing', false);
assert.equal(production[0].href, '/');
const direct = await simulate('https://owner.github.io/site/pr-preview/pr-7/', 'https://owner.github.io/site/pr-preview/pr-7/404.html', true);
assert.equal(direct[0].href, '/site/pr-preview/pr-7/');
const removed = await simulate('https://owner.github.io/site/', 'https://owner.github.io/site/pr-preview/pr-7/missing', true, false);
assert.equal(removed[0].href, '/site/');
assert.equal(removed[4]['data-search-index'], '/site/searchindex.json');
console.log('PASS: PR fallback 404 preserves preview navigation/search, fragments, and external links; production and direct preview 404 remain unchanged.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });