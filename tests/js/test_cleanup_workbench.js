const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture() {
  const elements = new Map(), calls = [], notices = [];
  function node(tag, text = "") {
    return {
      tag, textContent: text, value: "", checked: false, disabled: false, hidden: false,
      children: [], handlers: {}, open: false,
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      showModal() { this.open = true; }, close() { this.open = false; },
    };
  }
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, node("div"));
    return elements.get(selector);
  };
  $("#cleanup-kind").value = "all";
  const context = vm.createContext({
    $, node, document: {createElement: node}, Set,
    state: {token: "token", git: {editable: true, available: true, branch: "work", head: "head"}, jobState: "idle"},
    location: {hash: ""}, window: {addEventListener() {}}, setTimeout() {},
    draftBlockers: [], gitDraftBlockers() { return context.draftBlockers; },
    notify(message) { notices.push(message); }, async refreshGit() {},
    async api(url, options) {
      calls.push({url, options});
      return url.endsWith("/delete") ? {deleted: options.payload.paths, bytes: 1024} : {scan: null, job: {state: "idle"}};
    },
    scan: {id: "scan-token", branch: "work", head: "head", files: [
      {path: "static/images/dead.webp", media: true, kind: "image", bytes: 1024, url: "/static/images/dead.webp", protected: ""},
      {path: "static/report.pdf", media: true, kind: "pdf", bytes: 1024, url: "/static/report.pdf", protected: "Not committed"},
      {path: "static/dead.css", media: false, kind: "file", bytes: 100, protected: ""},
    ]},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../tools/workbench/web/cleanup.js"), "utf8"), context);
  vm.runInContext("cleanupUI.scan = scan; cleanupRenderFiles();", context);
  return {context, $, calls, notices, run: code => vm.runInContext(code, context)};
}

async function run() {
  let f = fixture();
  assert.equal(f.run("cleanupVisible().length"), 2, "Default discovery hides advanced static files");
  assert.equal(f.$("#cleanup-files").children[1].children[0].children[0].disabled, true);
  f.$("#cleanup-select").handlers.click();
  assert.equal(f.run("cleanupUI.selected.size"), 1, "Select visible never selects protected files");
  f.$("#cleanup-search").value = "report";
  f.$("#cleanup-search").handlers.input();
  assert.equal(f.run("cleanupUI.selected.size"), 1, "Filtering must not silently discard reviewed selection");
  f.$("#cleanup-advanced").checked = true;
  f.$("#cleanup-search").value = "";
  f.$("#cleanup-advanced").handlers.change();
  f.$("#cleanup-select").handlers.click();
  assert.equal(f.run("cleanupUI.selected.size"), 2);
  f.$("#cleanup-advanced").checked = false;
  f.$("#cleanup-advanced").handlers.change();
  assert.equal(f.run("cleanupUI.selected.size"), 1, "Leaving advanced mode removes advanced selections");
  f.context.draftBlockers.push("Unsaved article");
  f.run("cleanupButtons()");
  assert.equal(f.$("#cleanup-review").disabled, true, "Unsaved drafts prevent deletion");
  f.context.draftBlockers.length = 0;
  f.context.state.git.head = "new-head";
  f.run("cleanupButtons()");
  assert.equal(f.$("#cleanup-review").disabled, true, "A new checkout invalidates deletion review");

  f = fixture();
  f.$("#cleanup-select").handlers.click();
  f.$("#cleanup-review").handlers.click();
  assert.equal(f.$("#cleanup-dialog").open, true);
  assert.equal(f.calls.length, 0, "Opening review never deletes files");
  f.$("#cleanup-confirm").handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  const deletion = f.calls.find(call => call.url.endsWith("/delete"));
  assert.equal(deletion.options.payload.scan, "scan-token");
  assert.deepEqual(Array.from(deletion.options.payload.paths), ["static/images/dead.webp"]);
  assert.equal(deletion.options.payload.advanced, false);
  assert.equal(deletion.options.payload.confirm, true);
  assert.equal(f.$("#cleanup-dialog").open, false);
  assert.ok(f.notices[0].includes("Nothing was published"));
  console.log("PASS: Cleanup filters, selective review, advanced mode, draft/stale guards and exact deletion payload.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
