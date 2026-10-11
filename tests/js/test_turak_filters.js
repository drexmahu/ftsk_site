"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "..", "static", "js", "script.js"), "utf8");
const start = script.indexOf("      function applyTurakFilters()");
const end = script.indexOf("      $turakSearch.on(", start);
assert.ok(start >= 0 && end > start);
let search = "", decade = "", featuredHidden = false, matches = [];
const cards = [
  { search: "new cave report", decade: 2020, categories: "barlang", featured: true },
  { search: "old cave report", decade: 2010, categories: "barlang", featured: false },
  { search: "old canyon report", decade: 2000, categories: "kanyon", featured: false },
];
const toggle = (_name, state) => {
  assert.equal(typeof state, "boolean", "Class visibility must be set explicitly, not toggled by a string");
};
const context = {
  $: Object.assign(card => ({ data: key => card[key] }), { trim: value => value.trim() }),
  $turakSearch: { val: () => search },
  $turakDecade: { val: () => decade },
  $turakFeatured: { toggleClass: (name, state) => { toggle(name, state); featuredHidden = state; } },
  $turakCards: { filter: callback => cards.filter(card => callback.call(card)) },
  $turakCount: { text: () => {} },
  $turakEmpty: { toggleClass: toggle },
  $turakResetButtons: { filter: () => ({ toggleClass: toggle }) },
  activeCategories: [],
  paginateTurak: filtered => { matches = filtered; },
};
vm.runInNewContext(script.slice(start, end), context);

function check(term, selectedDecade, categories, expected) {
  search = term;
  decade = selectedDecade;
  context.activeCategories = categories;
  context.applyTurakFilters();
  assert.equal(featuredHidden, Boolean(term.trim() || selectedDecade || categories.length));
  assert.deepEqual(matches.map(card => card.search), expected);
}

check("", "", [], ["old cave report", "old canyon report"]);
check("", "2010", [], ["old cave report"]);
check("", "2000", [], ["old canyon report"]);
check("", "2020", [], ["new cave report"]);
check("", "2020", [], ["new cave report"]);
check("", "", [], ["old cave report", "old canyon report"]);
check("new", "", [], ["new cave report"]);
check("new cave", "", [], ["new cave report"]);
check("missing", "", [], []);
check("", "", ["barlang"], ["new cave report", "old cave report"]);
check("old", "2010", ["barlang"], ["old cave report"]);
check("  ", "", [], ["old cave report", "old canyon report"]);
console.log("PASS: Search, decade and category filters always hide newest highlights; clearing filters restores them without duplicate cards.");
