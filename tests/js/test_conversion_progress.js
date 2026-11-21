"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "app.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "content.js"), "utf8");

function control() {
  return {
    attributes: {}, children: [], value: 0, classes: new Set(), handlers: {},
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; this.value = 0; },
    querySelector(tag) { return this.children.find(item => item.tag === tag); },
    reportValidity() { return true; },
  };
}

async function checkConversionProgress() {
  const controls = new Map();
  const get = id => {
    if (!controls.has(id)) {
      const item = control();
      item.classList = {
        remove: name => item.classes.delete(name),
        toggle: (name, active) => active ? item.classes.add(name) : item.classes.delete(name),
      };
      item.insertAdjacentElement = (_position, panel) => controls.set(panel.id, panel);
      controls.set(id, item);
    }
    return controls.get(id);
  };
  const context = {
    renderUploadPreviews() {},
    document: { getElementById: id => controls.get(id), createElement: tag => Object.assign(control(), { tag }) },
    node: (tag, textContent = "") => Object.assign(get(`node-${controls.size}`), { tag, textContent }),
  };
  for (const id of ["convert-photos", "convert-portrait", "content-convert"]) get(id);
  vm.runInNewContext(app.slice(app.indexOf("function conversionProgress("), app.indexOf("\nasync function convertPhotos(")), context);
  const single = context.conversionProgress("convert-portrait", 1);
  const panel = get("convert-portrait-progress");
  assert.equal(panel.attributes["aria-busy"], "true");
  assert.ok(!("value" in panel.querySelector("progress").attributes), "Single conversion is indeterminate, not a fake percentage");
  single.update(0, "Converting portrait…");
  assert.match(panel.querySelector("p").textContent, /Converting portrait/);
  single.finish("Failed", true);
  assert.equal(panel.attributes["aria-busy"], "false");
  assert.ok(panel.classes.has("error"));
  context.conversionProgress("convert-portrait", 1).finish("Ready");
  assert.equal(panel.querySelector("progress").value, 1);
  assert.ok(!panel.classes.has("error"), "Retry clears the previous error");

  const events = [];
  Object.assign(context, {
    state: { photos: [{ id: "one", name: "one.jpg" }, { id: "two", name: "two.jpg" }] },
    options: () => ({folder: "gallery"}), setBusy: value => events.push(["busy", value]),
    notify() {}, showResults() {}, queueView() {},
    window: {workbenchImages: {async open(options) {
      assert.equal(options.entries.length, 2);
      assert.equal(options.context.kind, "photos");
      return {results: [{files: []}], completedIds: ["one"]};
    }}},
  });
  vm.runInNewContext(app.slice(app.indexOf("async function convertPhotos("), app.indexOf('\n$("#photo-library-browse")')), context);
  await context.convertPhotos();
  assert.equal(context.state.photos.length, 1);
  assert.equal(context.state.photos[0].id, "two", "Only completed sources are removed from the photo queue");

  Object.assign(context, {
    $: get, action: callback => callback(),
    URLSearchParams, api: async () => ({folders: [], files: [{url: "/images/old.webp", name: "old.webp"}]}),
    window: {workbenchImages: {supports: () => true, async open(options) {
      assert.equal(options.context.folder, "", "Root images are edited beside the source, not in the upload folder");
      assert.equal(options.settings.width, 1600);
      return {results: []};
    }}},
  });
  get("#photo-folder").value = ""; get("#photo-library-folder").value = "";
  for (const key of ["width", "height", "quality"]) get(`#photo-${key}`).value = key === "quality" ? "82" : "1600";
  vm.runInNewContext(app.slice(app.indexOf("function imageSettings("), app.indexOf("\nfunction showResults(")), context);
  assert.throws(() => context.options("photo"), /Choose an output folder/, "New uploads still require a named folder");
  await context.browsePhotoLibrary();
  await get("#photo-library-files").children[0].handlers.click();
  context.api = async url => {
    const folder = new URLSearchParams(url.split("?")[1]).get("folder");
    return {folders: !folder ? ["hero", "turak"] : ["hero/sub"], files: []};
  };
  await context.visitPhotoFolder("");
  assert.equal(get("#photo-library-parent").disabled, true);
  await get("#photo-library-folders").children[0].handlers.click();
  assert.equal(get("#photo-library-folder").value, "hero");
  assert.equal(get("#photo-library-parent").disabled, false);
  assert.deepEqual(get("#photo-library-breadcrumbs").children.map(item => item.textContent), ["Images", "›", "hero"]);
  assert.equal(get("#photo-library-folders").children.length, 1, "Up is not mixed into the child-folder tiles");
  await get("#photo-library-breadcrumbs").children[0].handlers.click();
  assert.equal(get("#photo-library-folder").value, "", "Breadcrumbs return directly to an ancestor");
  let releaseOld;
  context.api = async url => new URLSearchParams(url.split("?")[1]).get("folder") === "hero" ?
    new Promise(resolve => { releaseOld = resolve; }) :
    {folders: [], files: [{url: "/images/turak/latest.webp", name: "latest.webp"}]};
  const oldNavigation = context.visitPhotoFolder("hero");
  await context.visitPhotoFolder("turak");
  releaseOld({folders: [], files: [{url: "/images/hero/old.webp", name: "old.webp"}]});
  await oldNavigation;
  assert.equal(get("#photo-library-files").children[0].children[0].src, "/images/turak/latest.webp", "Late folder responses cannot replace the current folder's files");

  get("photo-files");
  Object.assign(context, {
    window: {}, sessionStorage: { setItem() {} }, queueView() {},
    portraitQueue: () => [], currentPortraitOwner: () => "alice",
    state: { photos: [], portraits: [], busy: false },
    api: async (_url, options) => {
      if (options.filename === "failed.jpg") throw new Error("Upload failed");
      return { id: options.filename };
    },
  });
  vm.runInNewContext(app.slice(app.indexOf("async function upload("), app.indexOf("\nfunction options(")), context);
  await context.upload([{ name: "one.jpg" }, { name: "failed.jpg" }], "photos");
  const uploadPanel = get("photo-files-progress");
  assert.equal(uploadPanel.querySelector("progress").max, 2);
  assert.match(uploadPanel.querySelector("p").textContent, /Uploaded 1\/2 photos/);
  assert.equal(uploadPanel.attributes["aria-busy"], "false");
  assert.ok(uploadPanel.classes.has("error"));
  assert.equal(context.state.photos.length, 1);

  Object.assign(context, {
    $: get, window: {}, cropBox: () => ({}), nextPortrait: async () => {},
    options: () => ({folder: "gallery"}),
    currentPortraitOwner: () => "standalone",
    api: async () => ({ files: [] }),
  });
  context.state.activePortrait = { id: "portrait" };
  context.state.portraits = [{ id: "portrait" }];
  vm.runInNewContext(app.slice(app.indexOf("async function convertPortrait("), app.indexOf("\nfunction updateStatus(")), context);
  await context.convertPortrait();
  assert.match(panel.querySelector("p").textContent, /Portrait and thumbnail converted/);
  assert.equal(panel.attributes["aria-busy"], "false");
  context.api = async () => { throw new Error("Portrait failed"); };
  await assert.rejects(context.convertPortrait(), /Portrait failed/);
  assert.ok(panel.classes.has("error"));
  assert.equal(panel.attributes["aria-busy"], "false");

  const input = get("#content-image-files");
  input.files = [{ name: "page.jpg", size: 10 }];
  get("#content-image-name").value = "";
  Object.assign(context, {
    $: get, studio: { selected: new Map() }, rootAPI: "/content/",
    updateOwnedMediaFolders: () => "tanfolyamok/test", activePath: () => "tanfolyamok/test.md",
    window: {workbenchImages: {async open(options) {
      assert.equal(options.context.kind, "page");
      assert.equal(options.context.path, "tanfolyamok/test.md");
      assert.equal(options.folder, "tanfolyamok/test");
      return {results: [{files: [{url: "/images/tanfolyamok/test/page.webp"}]}], remainingFiles: []};
    }}},
    DataTransfer: class { constructor() { this.files = []; this.items = {add: file => this.files.push(file)}; } },
    browseAssets: async () => {}, feedback() {}, persistDraft() {},
  });
  vm.runInNewContext(content.slice(content.indexOf("  async function editPageImages("), content.indexOf("\n  async function refreshPageMedia(")), context);
  await context.convertImages();
  assert.equal(context.studio.selected.size, 1);
  input.files = [{name: "page.jpg", size: 10}];
  context.browseAssets = async () => { throw new Error("Refresh failed"); };
  await assert.rejects(context.convertImages(), /Refresh failed/);
  console.log("PASS: Upload/portrait progress and shared photo/page editing preserve completed-source cleanup and explicit errors.");
}

module.exports = checkConversionProgress;
