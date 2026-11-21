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
  const notices = [], calls = [];
  let refreshes = 0, failure = "";
  const context = {
    $: get, state: { busy: false },
    memberState: { busy: false, original: { id: "alice" }, catalog: { revision: "registry-revision" } },
    memberControls() {},
    renderUploadPreviews() {},
    DataTransfer: class {
      constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; }
    },
    browseMemberCVImages: async () => { refreshes++; },
    notify: (message, kind) => notices.push({ message, kind }),
    window: {workbenchImages: {async open(options) {
      calls.push(options);
      return {results: options.files.filter(file => file.name !== failure).map(file => ({
        files: [{url: `/images/members/alice/${file.name}.webp`}]})),
        remainingFiles: options.files.filter(file => file.name === failure)};
    }}},
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
  assert.equal(calls[0].files.length, 3);
  assert.equal(calls[0].context.person, "alice");
  assert.equal(calls[0].context.revision, "registry-revision");
  assert.equal(calls[0].settings.width, 1600);
  assert.equal(calls[0].folder, "members/alice");
  context.memberState.original.id = "bob";
  assert.throws(() => calls[0].validate(), /person or roster changed/);
  context.memberState.original.id = "alice";
  assert.deepEqual(get("#member-cv-file").files.map(file => file.name), ["two.png"]);
  assert.equal(context.memberState.busy, false);
  assert.equal(refreshes, 1);
  assert.match(notices[0].message, /Saved 2 reviewed/);
  failure = "";
  await context.uploadMemberCVImage();
  assert.equal(get("#member-cv-file").files.length, 0);
  assert.match(notices[1].message, /Saved 1 reviewed/);
  assert.equal(refreshes, 2);
  await assert.rejects(context.uploadMemberCVImage(), /Choose CV photos first/);
  assert.match(source, /if \(id !== null\) action\(browseMemberCVImages\)/);
  console.log("PASS: CV batches use the shared editor with person/revision guards, retain unfinished photos and refresh saved outputs.");
}

module.exports = { checkMemberCVBatch };
