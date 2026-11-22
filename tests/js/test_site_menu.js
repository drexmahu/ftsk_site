const assert = require('node:assert/strict');
const path = require('node:path');
const { classify } = require(path.join(__dirname, '../../static/js/menu.js'));

const here = new URL('https://www.ftsk.hu/egyesuletunk/');
assert.equal(classify('/egyesuletunk/', here), 'same-page', 'A menu link to the page being viewed must not reload it');
assert.equal(classify('/egyesuletunk', here), 'same-page', 'A missing trailing slash is still the same page');
assert.equal(classify('/egyesuletunk/index.html', here), 'same-page');
assert.equal(classify('/egyesuletunk/#tortenetunk', here), 'anchor', 'In-page sections never navigate, so the menu must close itself');
assert.equal(classify('/egyesuletunk/#', here), 'same-page');
assert.equal(classify('#kapcsolat', here), 'anchor');
assert.equal(classify('/turak/', here), 'other-page');
assert.equal(classify('/egyesuletunk/?page=2', here), 'other-page');
assert.equal(classify('https://example.org/egyesuletunk/', here), 'external');
assert.equal(classify('/', new URL('https://www.ftsk.hu/')), 'same-page');
assert.equal(classify('/#x', new URL('https://www.ftsk.hu/')), 'anchor');
console.log('PASS: Menu links are classified so same-page and in-page choices close the dropdown without a reload.');
