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

async function testFailedPreviewRecovery() {
  const controls = new Map();
  const getControl = selector => {
    if (!controls.has(selector)) controls.set(selector, {sandbox: {add() {}}, textContent: "", hidden: true});
    return controls.get(selector);
  };
  const studio = {page: {path: "turak/example.md"}, busy: false, previewID: "old-preview",
    previewURL: "/old-preview/", previewPath: "turak/example.md", previewSource: "Old draft"};
  const previewContext = {
    studio, $: getControl, rootAPI: "/api/workbench/content/",
    async sync() { return {path: "turak/example.md", source: "New draft"}; },
    async api() { throw new Error("Preview service unavailable"); },
    switchPanel() {}, feedback() {}, setBusy: value => { studio.busy = value; },
    markDirty() { getControl("#content-preview-state").textContent = "Ready"; }
  };
  const start = source.indexOf("  async function renderPreview(");
  vm.runInNewContext(source.slice(start, source.indexOf("\n  async function showNewPage(", start)), previewContext);
  await assert.rejects(previewContext.renderPreview(), /service unavailable/);
  previewContext.previewStatus({job: {state: "idle", action: "content-preview", log: "Old build succeeded"},
    contentPreview: {id: "old-preview", path: "turak/example.md", state: "ready", url: "/old-preview/"}});
  assert.equal(studio.previewURL, "", "A failed new build must not relabel the old preview as matching the new draft");
  assert.match(getControl("#content-preview-state").textContent, /Preview could not start/);
  assert.doesNotMatch(getControl("#content-preview-log").textContent, /Old build succeeded/);
  console.log("PASS: Failed preview requests reject stale successful build status.");
}
testFailedPreviewRecovery().catch(error => { console.error(error); process.exitCode = 1; });

function testFolderNavigation() {
  class Element {
    constructor() { this.value = ""; this.children = []; this.events = {}; this.attributes = {}; }
    replaceChildren() { this.children = []; }
    append(child) { this.children.push(child); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, handler) { this.events[key] = handler; }
    click() { return this.events.click(); }
  }
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const context = {window: {}, document: {querySelector: element, createElement: () => new Element()}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../tools/workbench/web/content-library.js"), "utf8"), context);
  let browser;
  const visited = [];
  const open = () => { browser.update(); visited.push(element("input").value); };
  browser = context.window.workbenchContentLibrary.folderBrowser({
    input: "input", trail: "trail", back: "back", forward: "forward", up: "up", refresh: "refresh",
    label: "Images", open, run: operation => operation()
  });
  browser.reset();
  element("input").value = "turak"; open();
  element("input").value = "turak/trip"; open();
  element("back").click();
  assert.equal(element("input").value, "turak");
  element("forward").click();
  assert.equal(element("input").value, "turak/trip");
  element("up").click();
  element("input").value = "hero"; open();
  assert.equal(element("forward").disabled, true, "Opening a new folder after going back must replace forward history");
  element("refresh").click(); element("back").click();
  assert.equal(element("input").value, "turak", "Refresh must not create a history entry");
  element("trail").children[0].click();
  assert.equal(element("input").value, "", "The root breadcrumb replaces a redundant All folders button");
  assert.equal(element("up").disabled, true);
  browser.reset();
  assert.equal(element("back").disabled, true, "A new page/picker must not inherit another page's navigation history");
  element("input").value = "manual/path";
  element("input").events.keydown({key: "Enter", preventDefault() {}});
  assert.equal(visited.at(-1), "manual/path", "Advanced path entry must open with Enter in every file browser");
  assert(visited.includes("hero"));
  console.log("PASS: Folder navigation supports back, forward, up, root, refresh and independent picker history.");
}
testFolderNavigation();

function testPhotoPreparation() {
  class Transfer {
    constructor() { this.files = []; this.items = {add: file => this.files.push(file)}; }
  }
  const controls = new Map(), storage = new Map(), notices = [];
  let path = "turak/alpha.md", rejectWrites = false;
  const element = selector => {
    if (!controls.has(selector)) controls.set(selector, {value: "", files: [], textContent: "", className: ""});
    return controls.get(selector);
  };
  const state = {git: {branch: "fixture"}};
  const studio = {page: {}, catalog: {workspace: "C:\\fixture"}, photoScope: "",
    selected: new Map(), photoWorkspaces: new Map(), missingOriginals: []};
  const context = {studio, state, $: element, activePath: () => path, DataTransfer: Transfer,
    renderUploadPreviews() {}, renderSelection() {}, notify: message => notices.push(message),
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem(key, value) { if (rejectWrites) throw new Error("Quota exceeded"); storage.set(key, value); }
    }};
  const start = source.indexOf("  const photoSettings =");
  vm.runInNewContext(source.slice(start, source.indexOf("\n  function setBusy(", start)), context);
  context.restorePhotoWorkspace();
  const alphaScope = studio.photoScope;
  const first = {url: "/images/hero/one.webp", name: "one.webp", alt: "Entrance", caption: "Written caption"};
  const second = {url: "/images/hero/two.webp", name: "two.webp", alt: "Exit", caption: ""};
  studio.selected = new Map([[second.url, second], [first.url, first]]);
  element("#asset-folder").value = "hero";
  element("#insert-layout").value = "gallery";
  element("#content-image-files").files = [{name: "original.jpg"}];
  context.persistPhotoWorkspace();
  path = "turak/beta.md"; studio.selected.clear(); context.restorePhotoWorkspace();
  assert.equal(studio.selected.size, 0, "Photo selection must not leak into another page");
  assert.equal(element("#insert-layout").value, "image", "Layout settings must not leak either");
  path = "turak/alpha.md"; context.restorePhotoWorkspace();
  assert.deepEqual([...studio.selected.keys()], [second.url, first.url]);
  assert.equal(studio.selected.get(first.url).caption, "Written caption");
  assert.equal(element("#insert-layout").value, "gallery");
  assert.equal(element("#asset-folder").value, "hero");
  assert.equal(element("#content-image-files").files[0].name, "original.jpg", "Original files survive page switches in the same tab");
  studio.photoWorkspaces.clear(); studio.selected.clear(); context.restorePhotoWorkspace();
  assert.equal(studio.selected.get(first.url).alt, "Entrance", "Descriptions survive a browser reload");
  assert.deepEqual(Array.from(studio.missingOriginals), ["original.jpg"], "Unreviewed originals require explicit reselection after reload");
  state.git.branch = "other"; studio.selected.clear(); context.restorePhotoWorkspace();
  assert.equal(studio.selected.size, 0, "Another branch must not restore these photos");
  state.git.branch = "fixture"; studio.catalog.workspace = "C:\\another"; studio.selected.clear(); context.restorePhotoWorkspace();
  assert.equal(studio.selected.size, 0, "Another repository must not restore these photos");
  studio.catalog.workspace = "C:\\fixture"; context.restorePhotoWorkspace();
  rejectWrites = true;
  studio.selected.get(first.url).caption = "Latest caption";
  context.persistPhotoWorkspace(); studio.selected.clear(); context.restorePhotoWorkspace();
  assert.equal(studio.selected.get(first.url).caption, "Latest caption", "A failed browser backup must retain preparation in this tab");
  assert(notices.some(message => message.includes("Quota exceeded")));
  rejectWrites = false;
  context.forgetPhotoWorkspace(path);
  studio.selected.clear(); context.restorePhotoWorkspace();
  assert.equal(studio.selected.size, 0, "Deleted pages must not restore obsolete preparation");
  storage.set(alphaScope, "{broken"); studio.photoWorkspaces.clear();
  context.restorePhotoWorkspace(); context.persistPhotoWorkspace();
  assert.equal(storage.get(alphaScope), "{broken", "An unreadable backup must not be silently overwritten");
  assert.match(element("#photo-workspace-status").textContent, /backup needs attention/);
  console.log("PASS: Photo descriptions, order, settings and originals survive navigation, with repository/branch isolation and explicit backup failures.");
}
testPhotoPreparation();

function testLayoutValidation() {
  const controls = new Map();
  const element = selector => {
    if (!controls.has(selector)) controls.set(selector, {value: "", reportValidity: () => false});
    return controls.get(selector);
  };
  let inserted;
  const selected = new Map(["one", "two"].map(name => [`/images/${name}.webp`,
    {url: `/images/${name}.webp`, name, alt: `${name} description`, caption: ""}]));
  const context = {studio: {selected}, $: element, insertText: value => { inserted = value; }, feedback() {}};
  const start = source.indexOf("  const shortcodeEscape =");
  vm.runInNewContext(source.slice(start, source.indexOf("\n  function pdfStatus(", start)), context);
  element("#insert-layout").value = "gallery";
  context.insertPhotos();
  assert.match(inserted, /\{\{< gallery >\}\}/);
  assert(inserted.indexOf('src="/images/one.webp"') < inserted.indexOf('src="/images/two.webp"'));
  selected.delete("/images/two.webp");
  element("#insert-layout").value = "markdown";
  context.insertPhotos();
  assert.match(inserted, /!\[one description\]\(\/images\/one.webp\)/);
  element("#insert-layout").value = "image";
  element("#insert-width").value = "60";
  assert.throws(() => context.insertPhotos(), /layout dimensions/, "Visible standalone-image dimensions must still be validated");
  element("#insert-width").reportValidity = () => true;
  element("#insert-width").focus = () => {};
  element("#insert-width").value = "";
  assert.throws(() => context.insertPhotos(), /Fill in all visible/, "Blank dimensions must not become zero-width images");
  console.log("PASS: Gallery and Markdown ignore hidden sizing fields while supported image dimensions remain validated.");
}
testLayoutValidation();

async function testStalePageFiles() {
  const controls = new Map(), requests = [];
  const element = selector => {
    if (!controls.has(selector)) controls.set(selector, {value: "", textContent: "", replaceChildren() {}});
    return controls.get(selector);
  };
  let path = "turak/alpha.md", rendered = [];
  const studio = {page: {source: "Alpha story"}, changes: {}, mediaRead: 0, pageMedia: []};
  const context = {studio, $: element, rootAPI: "/content/", normalized: value => value,
    activePath: () => path, bodySource: () => studio.page.source,
    pageFileBrowsers: {images: {update() {}}}, run: operation => operation(),
    sync: async () => ({path, source: studio.page.source}),
    api: () => new Promise((resolve, reject) => requests.push({resolve, reject})),
    renderPageMedia() { rendered = studio.pageMedia.map(file => file.name); }
  };
  const start = source.indexOf("  async function refreshPageMedia(");
  vm.runInNewContext(source.slice(start, source.indexOf("\n  function renderPageMedia(", start)), context);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const response = name => ({files: [{name}], image_folders: [], pdf_folders: []});
  const first = context.refreshPageMedia(); await tick();
  element("#page-media-image-folder").value = "hero";
  const second = context.refreshPageMedia(); await tick();
  requests[1].resolve(response("current folder")); await second;
  requests[0].resolve(response("previous folder")); await first;
  assert.deepEqual(Array.from(rendered), ["current folder"], "Late responses must not replace the current folder's files");
  const edited = context.refreshPageMedia(); await tick();
  studio.page.source = "Changed story";
  requests[2].resolve(response("outdated draft")); await edited;
  assert.match(element("#page-media-status").textContent, /page changed/);
  const anotherPage = context.refreshPageMedia(); await tick();
  path = "turak/beta.md";
  requests[3].resolve(response("Alpha files")); await anotherPage;
  assert.deepEqual(Array.from(rendered), ["current folder"], "Files from a previous page must never be rendered in the newly opened page");
  console.log("PASS: File-usage browsing rejects stale folder, draft and page responses.");
}
testStalePageFiles().catch(error => { console.error(error); process.exitCode = 1; });
