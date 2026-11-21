"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const geometry = require("../../tools/workbench/web/image-editor.js");

function fixture() {
  const elements = new Map(), calls = [], tickets = new Map(), timers = new Set(), events = new Map(), sources = new Map(), notices = [];
  let count = 0;
  function node(tag, text = "", className = "") {
    return {tag, textContent: text, className, children: [], handlers: {}, hidden: false, disabled: false,
      value: "", checked: false, open: false, style: {}, scrollLeft: 0, scrollTop: 0,
      append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      addEventListener(name, fn) { this.handlers[name] = fn; }, showModal() { this.open = true; }, close() { this.open = false; },
      getBoundingClientRect() { return {left: 0, top: 0, width: 900, height: 680}; },
      getContext() { return new Proxy({}, {get: () => () => {}}); }, setPointerCapture() {},
      setAttribute(name, value) { this[name] = value; }, scrollIntoView() {},
    };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, node("div")); return elements.get(id); };
  get("image-canvas").width = 900; get("image-canvas").height = 680;
  const context = {
    document: {getElementById: get}, node, crypto: {randomUUID}, structuredClone,
    Option: function(text, value) { return {...node("option", text), value}; },
    Image: class { async decode() {} },
    window: {addEventListener(name, fn) { events.set(name, fn); }},
    state: {git: {editable: true, branch: "work"}, jobState: "idle", busy: false},
    sessionStorage: {setItem() {}}, notify(message, kind) { notices.push({message, kind}); },
    setBusy(value) { context.state.busy = value; },
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
    async api(url, options) {
      calls.push({url, payload: options.payload, method: options.method});
      if (url.endsWith("/uploads")) {
        if (options.raw.failure) throw new Error(options.raw.failure);
        const entry = {id: options.filename, name: options.filename, stem: options.filename.split(".")[0], width: 160, height: 120};
        sources.set(entry.id, entry);
        return entry;
      }
      if (url.endsWith("/preview")) {
        const p = options.payload, token = `ticket-${++count}`;
        const source = sources.get(p.id);
        const canOverwrite = source?.source_url?.endsWith(".webp") &&
          source.source_url.startsWith(`/images/${p.context.folder}/`);
        const result = {token, url: `/images/${p.context.folder || "page"}/${p.name}.webp`, preview: `/preview/${token}`,
          width: 100, height: 100, bytes: 500, mode: p.mode, can_overwrite: Boolean(canOverwrite),
          overwrite_reason: canOverwrite ? "" : "Save a new copy; this source cannot be replaced from this destination."};
        tickets.set(token, result);
        return result;
      }
      if (url.endsWith("/save")) return {files: [{...tickets.get(options.payload.token)}], log: "Saved"};
      if (options.method === "DELETE") tickets.delete(url.split("/").pop());
      return {};
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../tools/workbench/web/image-editor.js"), "utf8"), context);
  const tick = async () => { for (const fn of [...timers]) { timers.delete(fn); fn(); } await new Promise(resolve => setImmediate(resolve)); };
  const open = (entries, options = {}) => {
    for (const entry of entries || []) sources.set(entry.id, entry);
    return context.window.workbenchImages.open({entries,
      context: {kind: "photos", folder: "gallery"}, settings: {width: 1600, height: 1600, quality: 82}, ...options});
  };
  return {context, get, calls, tickets, events, tick, open, notices};
}

async function reviewUseCases() {
  let f = fixture();
  let done = f.open([{id: "crop", name: "crop.jpg", stem: "crop", width: 160, height: 120}]);
  await f.tick(); f.get("image-create").handlers.click(); await f.tick();
  f.get("image-crop-width").value = "0"; f.get("image-crop-width").handlers.change();
  assert.equal(f.get("image-save").disabled, true, "Invalid crop dimensions must not leave the previous output saveable");
  f.get("image-quality").value = "75"; f.get("image-quality").handlers.input(); await f.tick();
  assert.equal(f.get("image-save").disabled, true, "Changing another setting must not bypass an invalid crop");
  f.get("image-crop-width").value = "80"; f.get("image-crop-width").handlers.change(); await f.tick();
  assert.equal(f.get("image-save").disabled, false);
  const api = f.context.api;
  let fail = true;
  f.context.api = async (url, options) => {
    if (url.endsWith("/preview") && fail) { fail = false; throw new Error("Temporary preview failure"); }
    return api(url, options);
  };
  f.get("image-quality").value = "80"; f.get("image-quality").handlers.input(); await f.tick();
  assert.equal(f.get("image-save").disabled, true);
  await f.get("image-refresh").handlers.click(); await f.tick();
  assert.equal(f.get("image-save").disabled, false, "An explicit preview retry must recover without changing image settings");
  assert.equal(f.get("image-notice").textContent, "");
  await f.get("image-close").handlers.click(); await done;

  f = fixture();
  done = f.open([{id: "drag", name: "drag.jpg", stem: "drag", width: 160, height: 120},
    {id: "next", name: "next.jpg", stem: "next", width: 160, height: 120}]);
  await f.tick(); f.get("image-create").handlers.click(); await f.tick();
  for (const id of ["image-crop-width", "image-crop-height"]) { f.get(id).value = "80"; f.get(id).handlers.change(); }
  await f.tick();
  f.get("image-canvas").handlers.pointerdown({clientX: 225, clientY: 227.5, pointerId: 1, preventDefault() {}});
  f.get("image-canvas").handlers.pointermove({clientX: 281.25, clientY: 227.5});
  assert.equal(f.get("image-save").disabled, true, "Moving a crop invalidates its preview before pointer release");
  await f.get("image-next").handlers.click();
  f.get("image-canvas").handlers.pointermove({clientX: 350, clientY: 300});
  f.get("image-canvas").handlers.pointerup();
  await f.tick();
  const moved = f.calls.filter(call => call.url.endsWith("/preview") && call.payload.id === "drag").at(-1).payload;
  assert.deepEqual(Array.from(moved.edit.crop), [10, 0, 90, 80], "Navigation finishes the old drag; later pointer events cannot alter another source");
  await f.get("image-close").handlers.click(); await done;

  f = fixture();
  const normal = f.context.api;
  let release;
  f.context.api = async (url, options) => {
    if (url.endsWith("/uploads") && options.filename === "later.jpg") await new Promise(resolve => { release = resolve; });
    return normal(url, options);
  };
  done = f.open(undefined, {files: [{name: "one.jpg"}, {name: "two.jpg"}, {name: "later.jpg"}]});
  await f.tick();
  assert.equal(f.get("image-next").disabled, false, "Already-read sources remain navigable while later files are loading");
  await f.get("image-next").handlers.click(); release(); await f.tick();
  assert.match(f.get("image-position").textContent, /^2\/3/);
  await f.get("image-close").handlers.click(); await done;

  f = fixture();
  done = f.open(undefined, {files: [{name: "bad.gif", failure: "Unsupported image"}]});
  await f.tick();
  assert.equal(f.get("image-activity").hidden, true, "An entirely failed batch must not keep the loading indicator running");
  assert.match(f.get("image-notice").textContent, /bad.gif/);
  await f.get("image-close").handlers.click(); await done;

  f = fixture();
  done = f.open(undefined, {files: [{name: "good.jpg"}, {name: "bad.gif", failure: "Unsupported image"}]});
  await f.tick(); await f.get("image-save").handlers.click();
  assert.match(f.get("image-review-note").textContent, /could not be prepared/);
  await f.get("image-save").handlers.click();
  const partial = await done;
  assert.equal(partial.results.length, 1);
  assert.equal(partial.sourceErrors.length, 1);
  assert.equal(partial.remainingFiles[0].name, "bad.gif");

  f = fixture();
  done = f.open(Array.from({length: 11}, (_, index) =>
    ({id: `batch-${index}`, name: `${index}.jpg`, stem: `${index}`, width: 160, height: 120})));
  await f.tick();
  for (let index = 0; index < 10; index++) {
    await f.get("image-photos").children[index].handlers.click();
    for (let version = 1; version < 20 && !f.get("image-create").disabled; version++) {
      f.get("image-create").handlers.click(); await f.tick();
    }
  }
  await f.get("image-photos").children[10].handlers.click();
  assert.equal(f.get("image-create").disabled, true, "The UI enforces the actual 200-output batch limit");
  await f.get("image-photos").children[0].handlers.click();
  f.get("image-keep").checked = false; f.get("image-keep").handlers.change(); await f.tick();
  assert.ok(f.calls.some(call => call.method === "DELETE"), "Omitting an unedited output releases its prepared preview");
  await f.get("image-photos").children[10].handlers.click();
  assert.equal(f.get("image-create").disabled, false, "Omitting an output makes room without closing the batch");
  f.get("image-create").handlers.click(); await f.tick();
  assert.equal(f.get("image-create").disabled, true);
  await f.get("image-close").handlers.click(); await done;
}

async function run() {
  assert.deepEqual(geometry.fit(160, 120, 1), [20, 0, 140, 120]);
  assert.deepEqual(geometry.move([20, 10, 100, 90], 1000, -1000, 160, 120), [80, 0, 160, 80]);
  for (const ratio of [1, 16/9, 2/3]) {
    const b = geometry.fit(403, 301, ratio, 67);
    assert.ok(b[0] >= 0 && b[1] >= 0 && b[2] <= 403 && b[3] <= 301);
    assert.ok(Math.abs((b[2]-b[0]) / (b[3]-b[1]) - ratio) < 0.02);
  }

  let f = fixture();
  const done = f.open([{id: "one", name: "one.jpg", stem: "one", width: 160, height: 120},
    {id: "two", name: "two.jpg", stem: "two", width: 160, height: 120}]);
  await f.tick();
  assert.match(f.get("image-position").textContent, /^1\/2/);
  assert.equal(f.get("image-next").disabled, false, "Batch navigation unlocks after all staged sources arrive");
  const busy = {detail: {busy: [], blockers: []}};
  f.events.get("workbench-before-git")(busy);
  assert.match(busy.detail.busy[0], /image editor/);
  f.get("image-create").handlers.click(); await f.tick();
  f.get("image-keep").checked = false; f.get("image-keep").handlers.change();
  f.get("image-shape").value = "circle"; f.get("image-shape").handlers.change(); await f.tick();
  const circle = f.calls.filter(call => call.url.endsWith("/preview")).at(-1).payload;
  assert.equal(circle.edit.shape, "circle");
  assert.deepEqual(Array.from(circle.edit.crop), [20, 0, 140, 120]);
  f.get("image-brightness").value = "150"; f.get("image-brightness").handlers.input(); await f.tick();
  f.get("image-duplicate").handlers.click(); await f.tick();
  const secondVersion = f.get("image-versions").value;
  await f.get("image-next").handlers.click(); await f.get("image-previous").handlers.click();
  assert.equal(f.get("image-versions").value, secondVersion, "Batch navigation remembers the version being edited");
  await f.get("image-save").handlers.click();
  assert.equal(f.get("image-outputs").children.length, 3, "Two edited outputs without the original, plus the other photo's original");
  assert.equal(f.calls.filter(call => call.url.endsWith("/save")).length, 0, "Review must not write files");
  await f.get("image-save").handlers.click();
  const result = await done;
  assert.equal(result.results.length, 3);
  assert.deepEqual(Array.from(result.completedIds), ["one", "two"]);
  assert.equal(f.context.window.workbenchImages.pending, false);
  assert.deepEqual(Array.from(f.calls.at(-1).payload.remove), ["one", "two"]);

  f = fixture();
  const replacement = f.open([{id: "existing", name: "old.webp", stem: "old", width: 160, height: 120,
    source_url: "/images/gallery/old.webp"}]);
  await f.tick();
  f.get("image-mode").value = "overwrite"; f.get("image-mode").handlers.change(); await f.tick();
  await f.get("image-save").handlers.click();
  assert.equal(f.get("image-save").disabled, true, "Replacement cannot be saved before explicit approval");
  f.get("image-approve").checked = true; f.get("image-approve").handlers.change();
  assert.equal(f.get("image-save").disabled, false);
  await f.get("image-save").handlers.click(); await replacement;
  assert.equal(f.calls.find(call => call.url.endsWith("/save")).payload.confirm_overwrite, true);

  f = fixture();
  const cancelled = f.open([{id: "cancel", name: "cancel.jpg", stem: "cancel", width: 160, height: 120}]);
  await f.tick(); await f.get("image-close").handlers.click(); const empty = await cancelled;
  assert.equal(empty.results.length, 0);
  assert.equal(f.calls.filter(call => call.url.endsWith("/save")).length, 0);
  assert.equal(f.calls.at(-1).payload.remove.length, 0, "Cancel keeps an externally queued source available for retry");

  f = fixture();
  const partial = f.open([{id: "first", name: "first.jpg", stem: "first", width: 160, height: 120},
    {id: "second", name: "second.jpg", stem: "second", width: 160, height: 120}], {field: "Banner"});
  await f.tick(); await f.get("image-save").handlers.click();
  f.get("image-outputs").children[1].children.at(-1).children[0].handlers.change();
  const normalAPI = f.context.api, attempts = [];
  f.context.api = async (url, options) => {
    if (url.endsWith("/save")) {
      attempts.push(options.payload.token);
      if (attempts.length === 2) throw new Error("Connection interrupted");
    }
    return normalAPI(url, options);
  };
  await f.get("image-save").handlers.click();
  assert.match(f.get("image-notice").textContent, /Already saved.*first/);
  assert.equal(f.context.state.busy, false);
  await f.get("image-save").handlers.click();
  const recovered = await partial;
  assert.equal(recovered.results.length, 2);
  assert.equal(recovered.primary, "/images/gallery/second.webp");
  assert.notEqual(attempts[0], attempts[1]);
  assert.equal(attempts[1], attempts[2], "A partial retry saves only the failed output");

  f = fixture();
  const primaryChanged = f.open([{id: "field", name: "field.jpg", stem: "field", width: 160, height: 120}], {field: "Thumbnail"});
  await f.tick(); f.get("image-create").handlers.click(); await f.tick();
  await f.get("image-save").handlers.click(); f.get("image-back").handlers.click();
  f.get("image-keep").checked = false; f.get("image-keep").handlers.change();
  await f.get("image-save").handlers.click();
  assert.equal(f.get("image-outputs").children[0].children.at(-1).children[0].checked, true,
    "Disabling the previous field output selects a remaining output, never silently an empty assignment");
  await f.get("image-save").handlers.click();
  assert.equal((await primaryChanged).primary, "/images/gallery/field-edit-1.webp");

  f = fixture();
  const late = f.open([{id: "late", name: "late.jpg", stem: "late", width: 160, height: 120}]);
  await f.tick();
  const immediateAPI = f.context.api;
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  f.context.api = async (url, options) => {
    const result = await immediateAPI(url, options);
    if (url.endsWith("/preview") && options.payload.sequence === 2) await blocked;
    return result;
  };
  f.get("image-quality").value = "75"; f.get("image-quality").handlers.input(); await f.tick();
  f.get("image-quality").value = "90"; f.get("image-quality").handlers.input(); await f.tick();
  f.get("image-quality").value = "85"; f.get("image-quality").handlers.input(); await f.tick();
  assert.equal(f.calls.filter(call => call.url.endsWith("/preview")).length, 2,
    "An in-flight render coalesces subsequent slider changes instead of queueing obsolete images");
  release(); await f.tick();
  assert.deepEqual(f.calls.filter(call => call.url.endsWith("/preview")).map(call => call.payload.sequence), [1, 2, 4]);
  assert.equal(f.get("image-preview").src, "/preview/ticket-3", "Only the newest recipe becomes the ready preview");
  assert.ok(f.calls.some(call => call.url.includes("/preview/ticket-2")), "Superseded temporary previews are discarded");
  await f.get("image-close").handlers.click(); await late;
  f = fixture();
  let failOldSource;
  f.context.Image = class { decode() { return new Promise((resolve, reject) => { failOldSource = reject; }); } };
  const oldSource = f.open([{id: "old", name: "old.jpg", stem: "old", width: 160, height: 120}]);
  await f.tick(); await f.get("image-close").handlers.click(); await oldSource;
  f.context.Image = class { async decode() {} };
  const newSource = f.open([{id: "new", name: "new.jpg", stem: "new", width: 160, height: 120}]);
  await f.tick(); failOldSource(new Error("Cancelled source was removed")); await f.tick();
  assert.equal(f.get("image-notice").textContent, "", "A late source-decoding failure cannot contaminate a reopened editor");
  await f.get("image-close").handlers.click(); await newSource;
  await reviewUseCases();
  console.log("PASS: Shared image editor crops, variants, batch navigation, exact output review, approval and cancellation.");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
