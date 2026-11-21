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
      removeAttribute(name) { delete this[name]; },
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
      if (url.endsWith("/progress")) return context.progress;
      if (url.endsWith("/jobs")) return {state: "running", action: "cleanup-scan"};
      return url.endsWith("/delete") ? {deleted: options.payload.paths, bytes: 1024} : context.catalog;
    },
    progress: {state: "idle", log: ""},
    catalog: {scan: null, job: {state: "idle", action: null}},
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
  const api = f.context.api;
  let finish;
  f.context.api = async (url, options) => {
    const result = await api(url, options);
    return url.endsWith("/delete") ? new Promise(resolve => { finish = () => resolve(result); }) : result;
  };
  f.$("#cleanup-confirm").handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.$("#cleanup-delete-progress").hidden, false);
  assert.equal(f.$("#cleanup-cancel").disabled, true);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  const deletion = f.calls.find(call => call.url.endsWith("/delete"));
  assert.equal(deletion.options.payload.scan, "scan-token");
  assert.deepEqual(Array.from(deletion.options.payload.paths), ["static/images/dead.webp"]);
  assert.equal(deletion.options.payload.advanced, false);
  assert.equal(deletion.options.payload.confirm, true);
  assert.equal(f.$("#cleanup-dialog").open, false);
  assert.equal(f.$("#cleanup-delete-progress").hidden, true);
  assert.ok(f.notices[0].includes("Nothing was published"));

  f = fixture();
  f.context.progress = {state: "running", step: 1, steps: 5, label: "Checking saved files",
    explanation: "Fingerprinting the checkout; nothing is deleted.", completed: 2, total: 10,
    current: "static/images/one.webp", elapsed_seconds: 3, log: ""};
  await f.$("#cleanup-scan").handlers.click();
  assert.deepEqual(f.calls.map(call => call.url), ["/api/workbench/jobs", "/api/workbench/cleanup/progress"],
    "Do not request the locked catalog during a safety snapshot");
  assert.equal(f.run("cleanupUI.busy"), false, "Scan initiation must release the UI for progress polling");
  assert.equal(f.$("#cleanup-progress-current").value, 2);
  assert.equal(f.$("#cleanup-progress-current").max, 10);
  assert.match(f.$("#cleanup-progress-counts").textContent, /2\/10 files checked · 3s/);
  assert.equal(f.$("#cleanup-progress-path").textContent, "static/images/one.webp");
  assert.equal(f.$("#cleanup-scan").disabled, true);
  f.context.progress = {...f.context.progress, step: 2, label: "Building a fresh site", total: null,
    completed: 0, current: "", log: "Hugo is processing images"};
  await f.run("cleanupRefresh()");
  assert.equal(f.$("#cleanup-progress-current").value, undefined, "Hugo must use indeterminate activity");
  assert.equal(f.$("#cleanup-progress-overall").value, 1, "Only finished stages count toward overall progress");
  assert.equal(f.$("#cleanup-log").textContent, "Hugo is processing images");

  f.context.location.hash = "#cleanup";
  const pollingApi = f.context.api;
  f.context.api = async () => { throw new Error("Connection lost"); };
  await f.run("cleanupPoll()");
  assert.match(f.$("#cleanup-progress").className, /error/);
  assert.match(f.$("#cleanup-progress-message").textContent, /Connection lost/);
  assert.equal(f.$("#cleanup-progress-current").value, 0, "A disconnected bar must stop animating");
  assert.match(f.run("cleanupBlocker()"), /reconnect/);
  f.context.api = pollingApi;
  await f.run("cleanupPoll()");
  assert.equal(f.run("cleanupUI.disconnected"), false);
  assert.doesNotMatch(f.$("#cleanup-notice").className, /error/, "Polling recovery clears a transient connection error");

  f.context.progress = {...f.context.progress, state: "failed", step: 4, total: 20, completed: 7,
    current: "static/report.pdf", error: "Fixture reference check failed"};
  f.context.catalog = {scan: null, job: {action: "cleanup-scan", state: "failed", log: "Fixture error"}};
  await f.run("cleanupRefresh()");
  assert.match(f.$("#cleanup-progress").className, /error/);
  assert.match(f.$("#cleanup-progress-title").textContent, /Step 4 of 5/);
  assert.equal(f.$("#cleanup-progress-message").textContent, "Fixture reference check failed");
  assert.equal(f.$("#cleanup-progress-current").value, 7, "Failure preserves actual checked-file progress");
  assert.equal(f.$("#cleanup-progress-overall").value, 3);
  assert.equal(f.$("#cleanup-review").disabled, true);
  f.context.progress = {...f.context.progress, state: "running", step: 1, total: null, completed: 0,
    current: "", error: "", elapsed_seconds: 0, log: ""};
  await f.$("#cleanup-scan").handlers.click();
  assert.doesNotMatch(f.$("#cleanup-progress").className, /error/);
  assert.equal(f.$("#cleanup-progress-overall").value, 0);
  assert.equal(f.$("#cleanup-progress-path").hidden, true, "Retry must not keep the failed file path");

  f.context.progress = {...f.context.progress, state: "passed", step: 5, completed: 10, total: 10};
  f.context.catalog = {scan: {...f.context.scan, checked: 6, used: 3}, job: {action: "cleanup-scan", state: "passed"}};
  await f.run("cleanupRefresh()");
  assert.equal(f.$("#cleanup-progress-overall").value, 5);
  assert.match(f.$("#cleanup-progress-counts").textContent, /Nothing was deleted/);
  assert.equal(f.$("#cleanup-files").children.length, 2, "Approved candidates appear only after completion");
  f.$("#cleanup-select").handlers.click();
  f.$("#cleanup-review").handlers.click();
  f.context.api = async () => { throw new Error("Selected file changed; nothing was deleted"); };
  f.$("#cleanup-confirm").handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.$("#cleanup-delete-progress").hidden, true);
  assert.equal(f.$("#cleanup-dialog").open, true);
  assert.match(f.$("#cleanup-dialog-notice").textContent, /Selected file changed/);
  assert.equal(f.run("cleanupUI.selected.size"), 1, "Validation failure must preserve the reviewed selection");

  f = fixture();
  f.context.progress = {state: "running", step: 1, steps: 5, label: "Checking saved files",
    explanation: "Fingerprinting saved files.", completed: 0, total: null, current: "", elapsed_seconds: 0};
  const startupApi = f.context.api;
  f.context.api = async (url, options) => {
    if (url.endsWith("/progress")) throw new Error("Initial progress connection failed");
    return startupApi(url, options);
  };
  await f.$("#cleanup-scan").handlers.click();
  assert.equal(f.run("cleanupUI.disconnected"), true);
  assert.equal(f.run("cleanupUI.error"), "", "A progress transport error is not a persistent scan failure");
  f.context.api = startupApi;
  await f.run("cleanupRefresh()");
  assert.equal(f.run("cleanupUI.disconnected"), false);
  assert.doesNotMatch(f.$("#cleanup-notice").className, /error/);
  console.log("PASS: Cleanup progress, nonblocking polling, connection recovery, retry, filters and safe reviewed deletion.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
