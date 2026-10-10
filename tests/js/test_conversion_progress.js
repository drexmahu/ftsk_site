"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "app.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "content.js"), "utf8");

function control() {
  return {
    attributes: {}, children: [], value: 0, classes: new Set(),
    append(...items) { this.children.push(...items); },
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
    node: tag => Object.assign(get(`node-${controls.size}`), { tag }),
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
    options: () => ({}), setBusy: value => events.push(["busy", value]),
    notify() {}, showResults() {},
    api: async (_url, options) => {
      if (options.payload?.id === "two") throw new Error("Conversion failed");
      const progress = get("convert-photos-progress").querySelector("progress");
      if (options.payload) assert.equal(progress.value, 0, "No completed image before the first response");
      return { files: [] };
    },
  });
  vm.runInNewContext(app.slice(app.indexOf("async function convertPhotos("), app.indexOf("\nfunction clearCrop(")), context);
  await context.convertPhotos();
  const batch = get("convert-photos-progress");
  assert.equal(batch.querySelector("progress").max, 2);
  assert.equal(batch.querySelector("progress").value, 2);
  assert.match(batch.querySelector("p").textContent, /Converted 1\/2 photos.*failed/);
  assert.ok(batch.classes.has("error"));
  assert.deepEqual(events.at(-1), ["busy", false]);

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
  const updates = [];
  Object.assign(context, {
    $: get, studio: { selected: new Map() }, rootAPI: "/content/",
    updateOwnedMediaFolders: () => "tanfolyamok/test", activePath: () => "tanfolyamok/test.md",
    conversionProgress: (_id, total) => {
      assert.equal(total, 1);
      return { update: (count, label) => updates.push([count, label]), finish: (label, failed) => updates.push([label, failed]) };
    },
    api: async url => {
      if (url.endsWith("uploads")) return { id: "uploaded" };
      if (url.endsWith("convert")) return { files: [{ url: "/images/tanfolyamok/test/page.webp" }] };
      return {};
    },
    browseAssets: async () => {}, feedback() {}, persistDraft() {},
  });
  vm.runInNewContext(content.slice(content.indexOf("  async function convertImages("), content.indexOf("\n  async function refreshPageMedia(")), context);
  await context.convertImages();
  assert.ok(updates.some(([, label]) => typeof label === "string" && label.startsWith("Uploading")));
  assert.ok(updates.some(([, label]) => typeof label === "string" && label.startsWith("Converting")));
  assert.ok(updates.some(([, label]) => typeof label === "string" && label.startsWith("Cleaning")));
  assert.deepEqual(updates.at(-1), ["1 converted files. Ready to use.", false]);
  context.browseAssets = async () => { throw new Error("Refresh failed"); };
  await assert.rejects(context.convertImages(), /Refresh failed/);
  assert.equal(updates.at(-1)[1], true, "Post-export failures must not leave an active or successful progress indicator");
  console.log("PASS: Conversion progress tracks completed work, indeterminate processing, retry and explicit failures.");
}

module.exports = checkConversionProgress;
