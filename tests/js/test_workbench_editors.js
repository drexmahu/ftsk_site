"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "shortcuts.js"), "utf8");
const notices = [], clicks = [], events = [];
const buttons = new Map();
let dialogs = [], focus = null, panel = { dataset: { saveTarget: "save-page" } };
let handler;
const context = {
  location: { hash: "#content" },
  notify: message => notices.push(message),
  Event: function (type) { this.type = type; },
  window: { addEventListener: (type, callback, capture) => {
    assert.equal(type, "keydown");
    assert.equal(capture, true, "Save must run before Monaco's keybinding handler");
    handler = callback;
  } },
  document: {
    get activeElement() { return { closest: selector => selector === "[data-save-target]" ? focus : null }; },
    querySelectorAll: () => dialogs,
    querySelector: selector => selector === "#hero-frame" ?
      { contentWindow: { dispatchEvent: event => events.push(event.type) } } : panel,
    getElementById: id => buttons.get(id),
  },
};
function button(id, extra = {}) {
  const value = { disabled: false, hidden: false, closest: () => null, matches: () => false,
    click: () => clicks.push(id), ...extra };
  buttons.set(id, value);
  return value;
}
function press(extra = {}) {
  let prevented = false, stopped = false;
  handler({ key: "s", ctrlKey: true, preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; }, ...extra });
  return { prevented, stopped };
}
vm.runInNewContext(source, context);
button("save-page");
assert.deepEqual(press(), { prevented: true, stopped: true });
assert.deepEqual(clicks, ["save-page"]);
button("member-save");
dialogs = [{ dataset: { saveTarget: "member-save" } }];
press({ ctrlKey: false, metaKey: true });
assert.equal(clicks.at(-1), "member-save", "An open person modal takes precedence over the page behind it");
dialogs = [{ id: "member-files-dialog", dataset: {} }];
const count = clicks.length;
press();
assert.equal(clicks.length, count, "A deletion/review dialog must not accidentally save the underlying page");
assert.match(notices.at(-1), /no save action/);
dialogs = [];
focus = { dataset: { saveTarget: "category-save" } };
button("category-save");
press();
assert.equal(clicks.at(-1), "category-save");
buttons.get("category-save").disabled = true;
press();
assert.match(notices.at(-1), /unavailable/);
assert.equal(clicks.length, count + 1);
buttons.get("category-save").disabled = false;
buttons.get("category-save").matches = () => true;
press();
assert.equal(clicks.length, count + 1, "A disabled parent fieldset must lock shortcuts too");
focus = null;
context.location.hash = "#hero";
press();
assert.deepEqual(events, ["workbench-save"]);
press({ repeat: true });
assert.equal(events.length, 1, "Holding Ctrl+S must not enqueue multiple saves");
assert.deepEqual(press({ altKey: true }), { prevented: false, stopped: false });
assert.deepEqual(press({ ctrlKey: false, metaKey: false }), { prevented: false, stopped: false });

const html = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "index.html"), "utf8");
for (const id of ["member-bio", "member-cv", "post-body", "post-source", "git-conflict-source", "remove-media-source"]) {
  assert.match(html, new RegExp(`<textarea id="${id}"[^>]*data-monaco-language=`), `${id} must use Monaco`);
}
const content = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "content.js"), "utf8");
assert.ok(content.includes('["answer", "Answer (Markdown)", "markdown"]'), "Dynamic FAQ answers must use Monaco");
assert.ok(!content.includes('event.key.toLowerCase() === "s"'), "The previous page-only shortcut must not double-save");
{
  const hero = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "hero", "hero_focus_picker.html"), "utf8");
  const handlers = {}, errors = [];
  let saves = 0;
  const heroContext = { activeEditor: { save: () => { saves++; } },
    setStatus: message => errors.push(message),
    Event: function (type) { this.type = type; },
    window: {
      addEventListener: (type, callback) => { handlers[type] = callback; },
      dispatchEvent: event => handlers[event.type](),
    } };
  vm.runInNewContext(hero.slice(hero.indexOf("  window.addEventListener('workbench-save'"),
    hero.indexOf("  connectedSelect.addEventListener('change'")), heroContext);
  const key = { key: "s", ctrlKey: true, preventDefault() {}, stopPropagation() {} };
  handlers.keydown(key);
  handlers.keydown({ ...key, ctrlKey: false, metaKey: true });
  handlers.keydown({ ...key, repeat: true });
  assert.equal(saves, 2, "Hero must save from keyboard or parent events without key-repeat duplicates");
  heroContext.activeEditor = null;
  handlers["workbench-save"]();
  assert.match(errors[0], /Choose a slideshow photo/);
}
console.log("PASS: Monaco source coverage and context-aware Ctrl+S/Cmd+S preserve save guards.");
