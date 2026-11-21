const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture({ maintenance = false } = {}) {
  const elements = [], selected = new Map(), calls = [], timers = [];
  const state = { photos: [], portraits: [], busy: false };
  let drafts = [], busy = [], reloads = 0, exports = 0, discarded = 0;
  let reply = { state: "ready", message: "", generation: 1, version: "1.0.0", fingerprint: "abc123", token: "runtime-token" };
  function element(tag) {
    const result = {
      tag, children: [], handlers: {}, hidden: false, disabled: false, inert: false, open: false,
      textContent: "", className: "", dataset: {}, attributes: {},
      append(...children) { this.children.push(...children); },
      setAttribute(key, value) { this.attributes[key] = value; },
      hasAttribute(key) { return key === "data-runtime-maintenance" && maintenance; },
      addEventListener(name, callback) { this.handlers[name] = callback; },
      click() { return this.handlers.click?.(); },
      showModal() { this.open = true; }, close() { this.open = false; },
    };
    elements.push(result);
    return result;
  }
  const context = {
    URL, Headers, Request, Promise,
    state,
    location: { href: "http://localhost:8879/", origin: "http://localhost:8879", reload() { reloads++; } },
    document: {
      currentScript: { dataset: { generation: maintenance ? "0" : "1" } },
      head: element("head"), body: element("body"),
      createElement: element,
      querySelector(selector) {
        if (!selected.has(selector)) selected.set(selector, element(selector));
        return selected.get(selector);
      },
    },
    window: {
      fetch: async (input, options) => {
        calls.push({ input, options });
        return { ok: true, json: async () => reply };
      },
      dispatchEvent(event) {
        if (event.type === "workbench-before-git") {
          event.detail.blockers.push(...drafts);
          event.detail.busy.push(...busy);
        }
        if (event.type === "workbench-export-drafts") {
          exports++;
          if (drafts.length) event.detail.operations.push(Promise.resolve());
        }
        if (event.type === "workbench-discard-drafts") discarded++;
      },
    },
    CustomEvent: function(type, options) { this.type = type; this.detail = options.detail; },
    Event: function(type) { this.type = type; },
    setTimeout(callback) { timers.push(callback); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../tools/workbench/web/runtime-bridge.js"), "utf8"), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return {
    context, state, calls, settle, elements, selected,
    setDrafts(value) { drafts = value; },
    setBusy(value) { busy = value; },
    setReply(value) { reply = { ...reply, ...value }; },
    async poll() { timers.shift()(); await settle(); },
    find(text) { return elements.find(el => el.textContent === text); },
    reloads: () => reloads, exports: () => exports, discarded: () => discarded,
  };
}

async function run() {
  let f = fixture();
  await f.settle();
  assert.equal(f.reloads(), 0);
  assert.ok(f.find("Editor 1.0.0"));
  await f.context.window.fetch("/api/workbench/status");
  assert.equal(f.calls.at(-1).options.headers.get("X-Workbench-Generation"), "1");
  await f.context.window.fetch("https://outside.example/");
  assert.equal(f.calls.at(-1).options.headers, undefined, "Never leak runtime headers cross-origin");
  f.setDrafts(["Unsaved article"]);
  f.setReply({ generation: 2 });
  await f.poll();
  assert.equal(f.reloads(), 0, "An automatic reconnect must not discard browser drafts");
  assert.equal(f.elements.find(el => el.tag === "dialog").open, true);
  assert.equal(f.selected.get(".workspace").inert, true);
  await f.find("Download unsaved drafts").click();
  assert.equal(f.exports(), 1);
  await f.poll();
  assert.ok(f.elements.some(el => el.textContent.includes("Check your Downloads folder")));
  assert.equal(f.reloads(), 0, "A download does not imply consent to discard/reload");
  f.find("I saved my drafts · reload").click();
  assert.equal(f.discarded(), 1);
  assert.equal(f.reloads(), 1);

  f = fixture();
  await f.settle();
  f.state.photos.push({ id: "temporary" });
  f.setReply({ generation: 2 });
  await f.poll();
  assert.equal(f.reloads(), 0, "Queued uploads also require explicit recovery");
  await f.find("Download unsaved drafts").click();
  assert.ok(f.elements.some(el => el.textContent.includes("No downloadable drafts were found")),
    "Photo queues must not be reported as successful text-draft downloads");
  f.setBusy(["An editor save is running"]);
  await f.poll();
  assert.equal(f.find("I saved my drafts · reload").disabled, true);
  f.find("I saved my drafts · reload").click();
  assert.equal(f.reloads(), 0);

  f = fixture();
  await f.settle();
  f.setReply({ state: "development", developer: true, message: "Source changed" });
  await f.poll();
  assert.equal(f.reloads(), 0);
  await f.find("Restart editor").click();
  const restart = f.calls.find(call => call.options?.method === "POST");
  assert.equal(restart.options.headers["X-Workbench-Runtime-Token"], "runtime-token");
  f.setReply({ state: "failed", message: "Dependencies could not be prepared" });
  f.setDrafts(["Unsaved draft"]);
  await f.poll();
  assert.equal(f.elements.find(el => el.tag === "dialog").open, true);
  assert.equal(f.find("Retry startup").hidden, false);
  assert.equal(f.find("Download unsaved drafts").hidden, false, "A failed backend must not strand browser drafts");
  await f.find("Retry startup").click();
  assert.equal(f.calls.filter(call => call.options?.method === "POST").length, 2,
    "Retrying a failed backend keeps drafts in the current browser");
  assert.equal(f.discarded(), 0);

  f = fixture({ maintenance: true });
  await f.settle();
  assert.equal(f.reloads(), 1, "The first matching backend replaces the stable startup page");
  console.log("PASS: Editor runtime guards generations, browser drafts, uploads, developer restart and retry.");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
