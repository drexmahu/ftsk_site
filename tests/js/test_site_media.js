const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const site = require(path.join(__dirname, '../../static/js/media.js'));
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../tools/workbench/web/media-editor.js'), 'utf8'), { window });
const model = window.workbenchMediaModel;
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
assert.ok(model && window.workbenchMediaEditor, 'The editor module must load without a DOM');

// The workbench and the public page must agree on what a YouTube link is.
for (const value of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
  'https://youtu.be/dQw4w9WgXcQ?t=9', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  'https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ', ' dQw4w9WgXcQ ']) {
  assert.equal(site.youtubeId(value), 'dQw4w9WgXcQ', value);
  assert.equal(model.youtubeId(value), 'dQw4w9WgXcQ', value);
}
for (const value of ['', 'https://vimeo.com/123456789', '/videos/clip.mp4', 'short', 'https://youtube.com/watch?v=tooshort']) {
  assert.equal(site.youtubeId(value), '', value);
  assert.equal(model.youtubeId(value), '', value);
}

// Reel arrows only appear when there is something to scroll to.
same({ ...site.reelState(0, 1000, 1000) }, { scrollable: false, hasPrev: false, hasNext: false, size: 100, pos: 0 });
let state = site.reelState(0, 500, 2000);
assert.equal(state.hasPrev, false); assert.equal(state.hasNext, true); assert.equal(state.size, 25);
state = site.reelState(1500, 500, 2000);
assert.equal(state.hasPrev, true); assert.equal(state.hasNext, false); assert.equal(state.pos, 75);
assert.equal(site.reelState(1, 500, 501).scrollable, false, 'A sub-pixel overflow is not scrollable');

assert.equal(site.swipeDirection(-80, 5, 200), 1);
assert.equal(site.swipeDirection(80, 5, 200), -1);
assert.equal(site.swipeDirection(30, 0, 100), 0, 'Short drags are ignored');
assert.equal(site.swipeDirection(80, 70, 200), 0, 'Vertical scrolling must not change the photo');
assert.equal(site.swipeDirection(80, 0, 2000), 0, 'Slow drags are ignored');

assert.equal(site.idFromHash('#reel-2', { 'reel-2': {} }), 'reel-2');
assert.equal(site.idFromHash('#nope', { 'reel-2': {} }), '', 'Unknown or hostile hashes open nothing');
assert.equal(site.idFromHash('#%E0%A4%A', { 'reel-2': {} }), '', 'Malformed escapes do not throw');
assert.equal(site.idFromHash('#constructor', {}), '', 'Prototype names are not items');
assert.equal(site.counter(0, 6), '1 / 6');
assert.equal(site.creditLine({ credit: 'Kiss Anna', label: 'Fotó' }), 'Fotó: Kiss Anna');
assert.equal(site.creditLine({ credit: '' }), '');
assert.equal(site.embedUrl({ embed: 'https://x/embed/abc' }, true), 'https://x/embed/abc?rel=0&modestbranding=1&playsinline=1&autoplay=1');

// Same ratio rules as layouts/partials/media/ratio.html.
assert.equal(model.parseRatio('3:2'), 1.5);
assert.equal(model.parseRatio('16:9'), 16 / 9);
assert.equal(model.parseRatio(' 1.25 '), 1.25);
assert.equal(model.parseRatio('9:0'), 0);
assert.equal(model.parseRatio('wide'), 0);
assert.equal(model.parseRatio(true), 0);
assert.equal(model.parseRatio('100:1'), 5);
assert.equal(model.parseRatio('1:100'), 0.2);

assert.equal(model.sentenceCount(''), 0);
assert.equal(model.sentenceCount('Egy mondat.'), 1);
assert.equal(model.sentenceCount('Egy. Kettő! Három? Négy…'), 4);
assert.equal(model.sentenceCount('**Félkövér** szöveg. [Link](https://x.hu) vége.'), 2);

assert.equal(model.slugify('Gortani expedíció – 2026'), 'gortani-expedicio-2026');
assert.equal(model.uniqueId('reel', ['reel', 'reel-2']), 'reel-3');
assert.equal(model.uniqueId('', []), 'section');

assert.equal(model.videoSource('https://youtu.be/dQw4w9WgXcQ').value, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
assert.equal(model.videoSource('/videos/a.mp4').kind, 'file');
assert.equal(model.videoSource('https://cdn.example.org/a.webm?x=1').kind, 'file');
assert.equal(model.videoSource('/videos/a.avi').kind, '');
assert.match(model.videoSource('https://vimeo.com/1').message, /MP4, WebM/);
assert.equal(model.videoSource('').message, '');

// Reordering, including across sections and the drop-position arithmetic.
const sections = () => [{ items: [{ n: 'a' }, { n: 'b' }, { n: 'c' }] }, { items: [{ n: 'x' }] }, { layout: 'grid' }];
const names = list => list.map(section => (section.items || []).map(item => item.n).join(''));
let list = sections();
same(model.moveItem(list, { s: 0, i: 0 }, { s: 0, i: 2 }), { s: 0, i: 2 });
same(names(list), ['bca', 'x', '']);
list = sections();
same(model.moveItem(list, { s: 0, i: 1 }, { s: 1, i: 0 }), { s: 1, i: 0 });
same(names(list), ['ac', 'bx', '']);
list = sections();
model.moveItem(list, { s: 1, i: 0 }, { s: 2, i: 9 });
same(names(list), ['abc', '', 'x'], 'A section without an items list can receive items');
assert.equal(model.dropIndex({ s: 0, i: 0 }, 0, 2, false), 1, 'Dropping before tile 2 after removing tile 0');
assert.equal(model.dropIndex({ s: 0, i: 0 }, 0, 2, true), 2);
assert.equal(model.dropIndex({ s: 0, i: 2 }, 0, 0, false), 0);
assert.equal(model.dropIndex({ s: 1, i: 0 }, 0, 1, true), 2, 'Other-section drops do not shift');
for (const [from, to, tile, after] of [[0, 1, 1, true], [2, 0, 0, false], [1, 2, 0, true]]) {
  list = sections();
  const landed = model.moveItem(list, { s: 0, i: from }, { s: 0, i: model.dropIndex({ s: 0, i: from }, 0, tile, after) });
  assert.equal(list[0].items.length, 3, 'Reordering never loses or duplicates items');
  assert.equal(list[0].items[landed.i].n, 'abc'[from]);
}
const order = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
assert.equal(model.moveSection(order, 0, 5), 2);
same(order.map(section => section.id), ['b', 'c', 'a']);
assert.equal(model.moveSection(order, 1, -3), 0);

same(model.itemIssues({ type: 'photo', src: '/images/a.webp' }), [
  'Add a short description (3–4 sentences).', "Add the photographer's name.", 'Add alt text or a title for screen readers.']);
same(model.itemIssues({ type: 'photo', title: 'T', credit: 'C', text: 'One. Two. Three.' }), []);
same(model.itemIssues({ type: 'video', credit: 'C', text: 'A. B. C. D. E.' }), ['The description is longer than 4 sentences.']);
same({ ...model.sectionStats({ items: [{ type: 'photo' }, { type: 'video', credit: 'C', text: 'A.' }] }) }, { photos: 1, videos: 1, attention: 1 });
same({ ...model.sectionStats({}) }, { photos: 0, videos: 0, attention: 0 });

const target = { a: 1, b: 2 };
model.setOrDelete(target, 'a', ''); model.setOrDelete(target, 'b', 0); model.setOrDelete(target, 'c', NaN);
same(target, { b: 0 }, 'Blank restores the default by removing the key; zero is a real value');
assert.equal(model.clamp(5000, 'height'), 900);
assert.equal(model.clamp(3.6, 'columns'), 4);
assert.equal(model.clamp(-4, 'gap'), 0);

const taken = [{ id: 'a' }, { id: 'b' }];
assert.equal(model.idProblem(taken, 0, 'b'), 'Another section already uses this link name.');
assert.equal(model.idProblem(taken, 0, 'a'), '', 'A section may keep its own link name');
assert.match(model.idProblem(taken, 0, 'has space'), /letters, numbers/);
assert.equal(model.idProblem(taken, 0, ''), '');

const meta = { title: 'Fotók', description: 'Hegyi képek', media_sections: [
  { title: 'Gortani expedíció', subtitle: '', items: [{ title: 'Csúcs', credit: 'Kiss Anna', text: 'Szikla a hóban.', src: '/images/a.webp' }] },
  { title: 'Kanin', items: [{ type: 'video', video: 'https://youtu.be/dQw4w9WgXcQ' }] }] };
same(model.findText(meta, 'fotok'), { kind: 'page', field: 'title' });
same(model.findText(meta, 'gortani'), { kind: 'section', field: 'title', s: 0 });
same(model.findText(meta, 'SZIKLA'), { kind: 'item', field: 'text', s: 0, i: 0 });
same(model.findText(meta, 'dQw4w9'), { kind: 'item', field: 'video', s: 1, i: 0 });
assert.equal(model.findText(meta, 'nincs ilyen'), null);
assert.equal(model.findText({}, 'x'), null);
assert.equal(model.findText(meta, ''), null);

console.log('PASS: Media pages agree between the site, the workbench model, and the reorder arithmetic.');
