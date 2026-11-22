const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../tools/workbench/web/content-library.js"), "utf8"), {window});
const library = window.workbenchContentLibrary;
const pages = [
  {path: "turak/arviz.md", section: "turak", title: "Árvíztűrő expedíció", date: "2026-04-02", draft: true},
  {path: "turak/old.md", section: "turak", title: "Older expedition", date: "2024-01-01", draft: false},
  {path: "research/_index.md", section: "research", title: "Our research", date: "", draft: false},
  {path: "research/broken.md", section: "research", title: "Broken source", date: "", error: "Invalid YAML"},
  {path: "about.md", section: "pages", title: "About us", date: "", draft: false},
  {path: "tagok/person/cv.md", section: "tagok", title: "Person's CV", date: "", draft: false},
];
const categories = library.categories({pages, templates: []});
assert.deepEqual(Array.from(categories.slice(0, 2), item => item.id), ["turak", "tanfolyamok"]);
assert.equal(categories.find(item => item.id === "tanfolyamok").count, 0, "Empty maintained categories stay discoverable");
assert.equal(categories.find(item => item.id === "research").label, "Our research", "New folders use their section title without adding code");
assert.equal(library.categories({pages: [{path: "future_news/_index.md", section: "future_news", title: "_index"}]}).find(item => item.id === "future_news").label, "Future news", "Untitled section indexes must use the folder label");
assert.equal(categories.find(item => item.id === "pages").href, "#content/pages");
assert(categories.some(item => item.id === "tagok"), "Linked CV pages remain accessible");
assert.deepEqual(Array.from(library.filter(pages, {section: "turak", search: "arviz 2026", status: "draft"}), item => item.path), ["turak/arviz.md"]);
assert.deepEqual(Array.from(library.filter(pages, {status: "attention"}), item => item.path), ["research/broken.md"]);
assert.equal(library.filter(pages).length, pages.length, "Root and section index files must not disappear");
assert.equal(library.slug("Árvíztűrő tükörfúrógép 2026!"), "arvizturo-tukorfurogep-2026");
assert.deepEqual(Array.from(library.folderTrail("turak/trip", "All images"), item => item.folder), ["", "turak", "turak/trip"]);
const matching = "Earlier text.\nÁrvíztűrő\n  tükörfúrógép.\nOther text.\nÁrvíztűrő tükörfúrógép.";
const range = library.findTextRange(matching, "arvizturo tukorfurogep", 2);
assert.equal(range.line, 2);
assert.equal(matching.slice(range.start, range.end), "Árvíztűrő\n  tükörfúrógép.");
assert.equal(library.findTextRange(matching, "ARVIZTURO tukorfurogep", 5).line, 5, "Picking a later match must select that occurrence");
assert.equal(library.findTextRange("a+b\nacb", "a+b").line, 1, "Search text must not become executable regular expressions");
assert.equal(library.findTextRange(matching, "missing"), null);
assert.equal(library.findTextRange(matching, "\u0301"), null);

const source = fs.readFileSync(path.join(__dirname, "../../tools/workbench/web/content.js"), "utf8");
const start = source.indexOf("  function showContentScreen(");
const end = source.indexOf("\n  function renderCategoryNavigation(", start);
const controls = new Map();
const get = selector => {
  if (!controls.has(selector)) controls.set(selector, {hidden: false, dataset: {}, scrollIntoView() {}});
  return controls.get(selector);
};
const studio = {screen: "editor", page: {source: "unsaved source"}, dirty: true, changes: {title: "Draft"}};
const context = {studio, $: get, renderLibrary() {}, location: {hash: "#content/turak"}};
vm.runInNewContext(source.slice(start, end), context);
context.showContentScreen("library");
assert.equal(get("#content-library").hidden, false);
assert.equal(get(".content-detail").hidden, true);
assert.equal(get('[data-panel="content"]').dataset.saveTarget, "", "Library browsing must not save a hidden draft via the keyboard");
assert.equal(studio.dirty, true);
assert.equal(studio.page.source, "unsaved source", "Browsing is not a draft-replacement operation");
context.showContentScreen("editor");
assert.equal(get("#content-library").hidden, true);
assert.equal(get(".content-detail").hidden, false);
assert.equal(get('[data-panel="content"]').dataset.saveTarget, "save-page");
assert.deepEqual(studio.changes, {title: "Draft"});
console.log("PASS: Automatic categories, accented multi-term search, source attention filters, title-based filenames and draft-preserving library navigation.");

async function testSiteSearch() {
  class Element {
    constructor(tag, text = "") { this.tag = tag; this.textContent = text; this.dataset = {}; this.children = []; this.events = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(event, handler) { this.events[event] = handler; }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
    emit(event) { this.events[event]({preventDefault() {}}); }
    scrollIntoView() {}
  }
  const elements = new Map(), calls = [], jobs = [], opened = [], listeners = {};
  const getElement = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element("div"));
    return elements.get(selector);
  };
  const searchContext = {
    $: getElement, node: (tag, text) => new Element(tag, text), URLSearchParams, notify() {},
    state: {git: {editable: true}}, location: {hash: "#search"},
    api: url => new Promise((resolve, reject) => calls.push({url, resolve, reject})),
    action: operation => { const job = Promise.resolve().then(operation); jobs.push(job); job.catch(() => {}); },
    window: {addEventListener: (event, handler) => { listeners[event] = handler; },
      workbenchContent: {openMatch: (...args) => { opened.push(args); }}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../tools/workbench/web/site-search.js"), "utf8"), searchContext);
  const form = getElement("#site-search-form"), results = getElement("#site-search-results");
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const match = {line: 3, lines: 1, excerpt: "Beta phrase"};
  const file = {path: "content/about.md", kind: "page", title: "About", error: "", count: 1, matches: [match]};
  const response = (files = [file], next = null) => ({query: "Beta", files, next_offset: next, total_files: 26, total_matches: 26, warnings: []});
  getElement("#site-search-scope").value = "all";
  getElement("#site-search-query").value = "Alpha";
  form.emit("submit"); await tick();
  getElement("#site-search-query").value = "Beta"; form.emit("input");
  calls[0].resolve(response()); await jobs[0];
  assert.equal(results.children.length, 0, "An old response must not populate a changed search");
  form.emit("submit"); await tick();
  calls[1].reject(new Error("offline"));
  await assert.rejects(jobs[1], /offline/);
  assert.match(getElement("#site-search-status").textContent, /Search failed.*draft is safe/);
  assert.equal(getElement("#site-search-progress").hidden, true);
  assert.equal(getElement("#site-search-submit").disabled, false, "A failed search must permit retry");
  form.emit("submit"); await tick();
  calls[2].resolve(response([file], 25)); await jobs[2];
  results.querySelectorAll("button")[0].emit("click"); await jobs[3];
  assert.deepEqual(opened[0], [file, match, "Beta"], "Selecting a result must pass its precise source match to the draft-safe editor");
  getElement("#site-search-more").emit("click"); await tick();
  assert.match(calls[3].url, /offset=25/);
  calls[3].reject(new Error("temporary pagination failure"));
  await assert.rejects(jobs[4], /pagination failure/);
  assert.equal(getElement("#site-search-more").hidden, false, "Failed pagination must retain its retry action and existing results");
  assert.equal(results.children.length, 1);
  getElement("#site-search-more").emit("click"); await tick();
  calls[4].resolve(response()); await jobs[5];
  assert.equal(results.children.length, 2, "More results must append, not replace the first page");
  searchContext.state.git.editable = false; listeners["workbench-status"]();
  assert(results.querySelectorAll("button").every(button => button.disabled), "Branch locks must update existing result actions");
  getElement("#start-site-search-query").value = "Start phrase";
  getElement("#start-site-search-form").emit("submit"); await tick();
  assert.equal(searchContext.location.hash, "#search");
  assert.match(calls[5].url, /query=Start\+phrase/);
  calls[5].resolve({...response([]), query: "Start phrase"}); await jobs[6];
  console.log("PASS: Global search ignores stale responses, retries failures, appends pages, respects branch locks and shares the Start here entry.");
}
testSiteSearch().catch(error => { console.error(error); process.exitCode = 1; });

async function testMatchNavigation() {
  const text = "---\ntitle: 2026\npublishDate: 2026\ndate: 2026\ncustom_note: 2026\n---\nStory.\n";
  const fields = ["title", "publishDate", "date"].map(name => ({
    dataset: {field: name}, value: "2026", type: "text", focus() {}, setSelectionRange() {}, scrollIntoView() {},
    closest: selector => selector === "[data-editor-panel]" ? {dataset: {editorPanel: "metadata"}} : null
  }));
  const controls = new Map();
  const getControl = selector => {
    if (!controls.has(selector)) controls.set(selector, {
      value: selector === "#post-body" ? "Story.\n" : text, tagName: "TEXTAREA",
      focus() {}, setSelectionRange() {}, scrollIntoView() {}, closest() { return null; }
    });
    return controls.get(selector);
  };
  let selected;
  const matchContext = {
    studio: {catalog: {pages: [{path: "turak/example.md"}]}, page: {source: text, body: "Story.\n", guided: true}, dirty: true},
    state: {git: {editable: true}}, activePath: () => "turak/example.md",
    $: getControl, normalized: value => value, window: {workbenchContentLibrary: library},
    document: {querySelectorAll: () => fields}, activateEditorRoute() {}, showContentScreen() {},
    async sync() {}, renderForms() {}, switchPanel: tab => { selected = tab; }
  };
  const start = source.indexOf("  async function openSearchMatch(");
  vm.runInNewContext(source.slice(start, source.indexOf("\n  function persistDraft(", start)), matchContext);
  await matchContext.openSearchMatch({path: "content/turak/example.md"}, {line: 4}, "2026");
  assert.equal(selected, "metadata");
  let focused = false;
  fields[2].focus = () => { focused = true; };
  await matchContext.openSearchMatch({path: "content/turak/example.md"}, {line: 4}, "2026");
  assert(focused, "Repeated values must focus the chosen source field, not the first matching field");
  await matchContext.openSearchMatch({path: "content/turak/example.md"}, {line: 5}, "2026");
  assert.equal(selected, "source", "Unsupported settings must open their source even if a guided field contains the same text");
  console.log("PASS: Precise search navigation distinguishes repeated guided settings from unsupported source fields.");
}
testMatchNavigation().catch(error => { console.error(error); process.exitCode = 1; });
