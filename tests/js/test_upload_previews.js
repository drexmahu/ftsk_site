"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function checkUploadPreviews() {
  class Element {
    constructor(tag, className = "") {
      this.tag = tag; this.children = []; this.events = {}; this.attributes = {};
      this.classes = new Set(className.split(" "));
      this.classList = { add: name => this.classes.add(name),
        toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name) };
    }
    append(...items) { items.forEach(item => { item.parent = this; this.children.push(item); }); }
    before(item) { this.parent.children.splice(this.parent.children.indexOf(this), 0, item); item.parent = this.parent; }
    after(item) { this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, item); item.parent = this.parent; }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    closest(selector) {
      if (selector === ".panel, .media-converter") return host;
      return label;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, callback) { this.events[type] = callback; }
    dispatchEvent(event) { this.events[event.type]?.(event); }
    matches(selector) { return selector === ":disabled" && Boolean(this.disabled); }
  }
  const host = new Element("div"), label = new Element("label"), input = new Element("input");
  host.append(label); label.append(input);
  input.files = [{ name: "one.jpg" }, { name: "two.png" }];
  const created = [], revoked = [], pageEvents = {};
  const context = {
    node: (tag, text, classes) => Object.assign(new Element(tag, classes), { textContent: text }),
    state: { busy: false }, window: { addEventListener: (event, callback) => { pageEvents[event] = callback; } },
    document: { querySelectorAll: () => [] },
    URL: { createObjectURL: file => { const url = `blob:${created.length}-${file.name}`; created.push(url); return url; },
      revokeObjectURL: url => revoked.push(url) },
    Event: class { constructor(type) { this.type = type; } },
    DataTransfer: class { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "uploads.js"), "utf8"), context);
  context.renderUploadPreviews(input);
  const shell = host.children[0], gallery = shell.children[1];
  assert.equal(shell.children[0], label, "Keep the picker label separate from preview action buttons");
  assert.equal(gallery.children.length, 2);
  assert.equal(label.children.length, 1, "Never nest cancel buttons in the file-input label");
  let changes = 0, stopped = false;
  input.addEventListener("change", () => { changes++; });
  const cancel = gallery.children[0].children[2];
  assert.equal(cancel.attributes["aria-label"], "Remove pending photo: one.jpg");
  cancel.events.click({ preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(changes, 1);
  assert.deepEqual(input.files.map(file => file.name), ["two.png"]);
  assert.equal(gallery.children.length, 1);
  assert.deepEqual(revoked.slice(0, 2), created.slice(0, 2));
  input.disabled = true;
  gallery.children[0].children[2].events.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(input.files.length, 1, "A running operation must protect its pending selection");
  input.disabled = false;
  let removed = -1, crops = 0;
  context.renderUploadPreviews(input, [{ name: "Server portrait", url: "/api/workbench/uploads/one",
    selected: true, choose: () => { crops++; } }], index => { removed = index; });
  const serverCard = gallery.children[0];
  assert.ok(serverCard.classes.has("selected"));
  serverCard.children[3].events.click();
  assert.equal(crops, 1);
  serverCard.children[2].events.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(removed, 0, "Server-backed queues use their own temporary-upload cancellation");
  assert.equal(input.files.length, 1, "Cancelling a server queue must not change unrelated native files");
  input.files = [];
  context.renderUploadPreviews(input);
  assert.equal(gallery.hidden, true);
  pageEvents.pagehide();
  assert.equal(revoked.length, created.length, "Release every temporary thumbnail URL");
  const cancellations = [];
  let queue;
  context.state.portraits = [{ id: "pending-one", name: "one.jpg" }];
  context.state.activePortrait = { id: "pending-one" };
  Object.assign(context, {
    $: selector => selector.endsWith("-queue") ? new Element("div") : input,
    portraitQueue: () => context.state.portraits,
    renderUploadPreviews: (_input, entries, remove) => { queue = { entries, remove }; },
    action: operation => operation(),
    api: async (url, options) => { cancellations.push({ url, method: options.method }); },
    clearCrop: () => { context.state.activePortrait = null; },
  });
  const app = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "app.js"), "utf8");
  vm.runInNewContext(app.slice(app.indexOf("function queueView("), app.indexOf("\nfunction setBusy(")), context);
  context.queueView("portraits");
  assert.equal(queue.entries[0].url, "/api/workbench/uploads/pending-one");
  await queue.remove(0);
  assert.deepEqual(cancellations, [{ url: "/api/workbench/uploads/pending-one", method: "DELETE" }]);
  assert.equal(context.state.portraits.length, 0);
  assert.equal(context.state.activePortrait, null);
  console.log("PASS: Shared pending previews support individual cancellation, crop actions, busy guards and URL cleanup.");
}

module.exports = { checkUploadPreviews };
