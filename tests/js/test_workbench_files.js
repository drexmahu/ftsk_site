"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function checkFileNavigation() {
  class Element {
    constructor(tag, className = "") {
      this.tagName = tag; this.children = []; this.attributes = {}; this.events = {}; this.dataset = {};
      this.isConnected = true; this.hidden = false;
      this.classList = { contains: value => className.split(" ").includes(value) };
    }
    append(...children) {
      for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); child.isConnected = true; }
    }
    before(sibling) {
      const parent = this.parentElement, index = parent.children.indexOf(this);
      sibling.parentElement = parent; parent.children.splice(index, 0, sibling);
    }
    after(sibling) {
      const parent = this.parentElement, index = parent.children.indexOf(this);
      sibling.parentElement = parent; parent.children.splice(index + 1, 0, sibling);
    }
    matches(selector) { return selector.split(", ").includes(this.tagName); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, callback) { this.events[type] = callback; }
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null; this.isConnected = false;
    }
  }
  const requests = [], notices = [], pending = [], targets = [];
  const context = {
    window: {}, document: { body: {}, querySelectorAll: () => targets,
      createElementNS: (_namespace, tag) => new Element(tag) },
    node: (tag, _text, className) => new Element(tag, className),
    MutationObserver: class { observe() {} }, queueMicrotask,
    action: fn => { pending.push(fn().catch(error => notices.push(error.message))); },
    api: async (url, options) => requests.push({ url, ...options }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "files.js"), "utf8"), context);
  const group = context.window.workbenchFiles.controls("content/tagok/alice/index.md");
  assert.equal(group.children.length, 2);
  assert.equal(group.children[0].attributes["aria-label"], "Open in VS Code");
  assert.equal(group.children[1].attributes["aria-label"], "Reveal in Explorer");
  const event = { preventDefault() {}, stopPropagation() { this.stopped = true; } };
  for (const button of group.children) {
    button.events.click(event);
    assert.equal(button.disabled, true);
    await Promise.all(pending);
    assert.equal(button.disabled, false);
  }
  assert.equal(event.stopped, true, "File navigation must not select or open the parent card");
  assert.equal(requests[0].url, "/api/workbench/files/navigate");
  assert.equal(requests[0].payload.path, "content/tagok/alice/index.md");
  assert.equal(requests[0].payload.action, "open");
  assert.equal(requests[1].payload.action, "reveal");
  const imageActions = context.window.workbenchFiles.controls("static/images/portrait%20one.webp");
  imageActions.children[0].events.click(event);
  await Promise.all(pending);
  assert.equal(requests[2].payload.path, "static/images/portrait one.webp");
  context.api = async () => { throw new Error("File is missing"); };
  group.children[0].events.click(event);
  await Promise.all(pending);
  assert.deepEqual(notices, ["File is missing"]);
  assert.equal(group.children[0].disabled, false);
  const host = new Element("div"), label = new Element("label"), checkbox = new Element("input");
  label.dataset.workbenchFile = "static/images/one.webp";
  label.append(checkbox); host.append(label); targets.push(label);
  context.window.workbenchFiles.refresh();
  const wrapper = host.children[0];
  assert.equal(label.children.length, 1, "File buttons must stay outside checkbox labels");
  assert.equal(wrapper.children[1].children.length, 2);
  label.hidden = true;
  context.window.workbenchFiles.refresh();
  assert.equal(wrapper.hidden, true, "Filtering a card must hide its adjacent file actions");
  label.dataset.workbenchFile = "static/images/two.webp";
  context.window.workbenchFiles.refresh();
  assert.equal(wrapper.children.length, 2, "Updating a path must not duplicate controls");
  assert.equal(wrapper.children[1].attributes["aria-label"], "File actions: static/images/two.webp");
  label.remove(); targets.pop();
  context.window.workbenchFiles.refresh();
  assert.equal(host.children.length, 0, "Removed cards must not leave empty action wrappers");
  console.log("PASS: File navigation icons use explicit authenticated actions and surface launch errors.");
}

module.exports = { checkFileNavigation };
