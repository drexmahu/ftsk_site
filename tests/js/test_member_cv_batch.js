"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function checkMemberCVBatch() {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "members.js"), "utf8");
  const controls = new Map();
  const get = selector => {
    if (!controls.has(selector)) controls.set(selector, { value: "", files: [], textContent: "" });
    return controls.get(selector);
  };
  const updates = [], notices = [], calls = [];
  let refreshes = 0, failure = "";
  const context = {
    $: get, state: { busy: false },
    memberState: { busy: false, original: { id: "alice" }, catalog: { revision: "registry-revision" } },
    memberControls() {},
    renderUploadPreviews() {},
    DataTransfer: class {
      constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; }
    },
    conversionProgress: (_id, total) => ({
      update: (completed, message) => updates.push({ total, completed, message }),
      finish: (message, failed) => updates.push({ message, failed }),
    }),
    browseMemberCVImages: async () => { refreshes++; },
    notify: (message, kind) => notices.push({ message, kind }),
    api: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/workbench/uploads") return { id: options.filename };
      if (url.endsWith("/cv-image")) {
        if (options.payload.id === failure) throw new Error("Conversion failed");
        return { files: [{ url: `/images/members/alice/${options.payload.id}.webp` }] };
      }
      return {};
    },
  };
  vm.runInNewContext(source.slice(source.indexOf("function selectMemberCVFiles("),
    source.indexOf('\nsetupFileDrop("#member-cv-file"')), context);
  vm.runInNewContext(source.slice(source.indexOf("async function uploadMemberCVImage("),
    source.indexOf("\nfunction memberCVSnapshot(", source.indexOf("async function uploadMemberCVImage("))), context);
  get("#member-cv-width").value = "1600";
  get("#member-cv-height").value = "1200";
  get("#member-cv-quality").value = "82";
  const photos = [{ name: "one.jpg" }, { name: "two.png" }, { name: "three.heic" }];
  context.selectMemberCVFiles(photos);
  assert.equal(get("#member-cv-file").files.length, 3);
  failure = "two.png";
  await context.uploadMemberCVImage();
  const conversions = calls.filter(call => call.url.endsWith("/cv-image"));
  assert.equal(conversions.length, 3, "One failure must not skip later batch photos");
  for (const call of conversions) {
    assert.equal(call.options.payload.person, "alice");
    assert.equal(call.options.payload.revision, "registry-revision");
    assert.equal(call.options.payload.width, 1600);
  }
  assert.equal(calls.filter(call => call.options.method === "DELETE").length, 3);
  assert.deepEqual(get("#member-cv-file").files.map(file => file.name), ["two.png"]);
  assert.equal(context.memberState.busy, false);
  assert.equal(refreshes, 1);
  assert.match(notices[0].message, /Converted 2\/3/);
  assert.match(notices[0].message, /two.png: Conversion failed/);
  assert.equal(notices[0].kind, "error");
  assert.ok(updates.some(update => update.total === 3 && update.completed === 3));
  failure = "";
  await context.uploadMemberCVImage();
  assert.equal(get("#member-cv-file").files.length, 0);
  assert.match(notices[1].message, /Converted 1\/1/);
  assert.equal(refreshes, 2);
  await assert.rejects(context.uploadMemberCVImage(), /Choose CV photos first/);
  assert.match(source, /if \(id !== null\) action\(browseMemberCVImages\)/);
  console.log("PASS: CV batches convert independently, retain failed photos, refresh saved images and clean uploads.");
}

module.exports = { checkMemberCVBatch };
