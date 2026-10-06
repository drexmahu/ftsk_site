const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.classList = { toggle: (name, enabled) => { this.active = enabled; } };
  }
  append(...children) {
    for (const child of children) {
      child.parentNode?.removeChild(child);
      child.parentNode = this;
      this.children.push(child);
    }
  }
  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentNode = null;
  }
  insertBefore(child, before) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.children.splice(this.children.indexOf(before), 0, child);
  }
  replaceChildren(...children) {
    for (const child of [...this.children]) this.removeChild(child);
    this.append(...children);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  dispatchEvent(event) {
    for (const listener of this.listeners[event.type] || []) listener(event);
  }
  scrollIntoView() { this.scrolled = true; }
  closest(tag) { return this.tag === tag ? this : this.parentNode?.closest(tag); }
  get options() { return this.children.flatMap(child => child.tag === "optgroup" ? child.children : [child]); }
}

const document = { createElement: tag => new Element(tag), activeElement: null };
const observers = [];
const context = {
  document, Event: function(type) { this.type = type; },
  MutationObserver: class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
  },
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "workbench", "autocomplete.js"), "utf8"), context);

const label = new Element("label"), input = new Element("input");
label.append(input);
let choices = [
  { value: "first", label: "Németh Bence [first]", search: "Németh Bence Benci first" },
  { value: "second", label: "Stieber Bence [second]", search: "Stieber Bence second" },
];
const selections = [];
const picker = context.attachSuggestions(input, { choices: () => choices, select: item => selections.push(item.value) });
const list = input.parentNode.children[1];
function key(value) {
  const event = { type: "keydown", key: value, prevented: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  input.dispatchEvent(event);
  return event;
}
document.activeElement = input;
input.dispatchEvent({ type: "focus" });
assert.equal(list.hidden, false, "Suggestions open without opening a separate dropdown");
assert.equal(list.children.length, 2);
assert.equal(input.attributes.role, "combobox");
assert.equal(input.attributes["aria-expanded"], "true");
input.value = "Bence";
input.dispatchEvent({ type: "input" });
assert.equal(list.children.length, 2, "Same first name does not select or collapse different identities");
assert.equal(selections.length, 0, "Typing never assigns an identity");
assert.equal(key("Enter").prevented, true, "Enter without keyboard highlight must not submit a form");
assert.equal(selections.length, 0);
key("ArrowUp");
assert.equal(list.children[1].attributes["aria-selected"], "true");
assert.equal(input.attributes["aria-activedescendant"], list.children[1].id);
key("Enter");
assert.equal(selections[0], "second");
assert.equal(list.hidden, true);
input.value = "Benci";
input.dispatchEvent({ type: "input" });
assert.equal(list.children.length, 1, "Aliases and nicknames are searchable");
list.children[0].dispatchEvent({ type: "click" });
assert.equal(selections[1], "first");
input.value = "ne\u0301meth";
input.dispatchEvent({ type: "input" });
assert.equal(list.children.length, 1, "Unicode normalization preserves accented name matching");
input.value = "unknown";
input.dispatchEvent({ type: "input" });
assert.ok(list.children[0].textContent.includes("No matching"));
key("ArrowDown");
key("Enter");
assert.equal(selections.length, 2);
input.value = "";
input.dispatchEvent({ type: "input" });
const escaped = key("Escape");
assert.equal(list.hidden, true);
assert.equal(escaped.stopped, true, "First Escape closes suggestions, not an enclosing person dialog");
key("ArrowDown");
assert.equal(list.children[0].attributes["aria-selected"], "true");
key("ArrowDown");
assert.equal(list.children[1].attributes["aria-selected"], "true");
key("ArrowDown");
assert.equal(list.children[0].attributes["aria-selected"], "true");
key("Tab");
assert.equal(list.hidden, true);
input.dispatchEvent({ type: "focus" });
input.dispatchEvent({ type: "blur" });
assert.equal(list.hidden, true);
choices = [{ value: "new", label: "New identity" }];
input.dispatchEvent({ type: "focus" });
picker.refresh();
assert.equal(list.children.length, 1, "Refresh reads the latest saved choices");
input.disabled = true;
picker.refresh();
assert.equal(list.hidden, true);

const selectLabel = new Element("label"), select = new Element("select");
selectLabel.append(select);
const option = new Element("option");
option.value = "helpers";
option.textContent = "Helpers";
select.append(option);
let changes = 0, edits = 0;
select.addEventListener("change", () => { changes++; });
select.addEventListener("input", () => { edits++; });
const enhanced = context.searchableSelect(select, "custom categories");
assert.equal(context.searchableSelect(select, "custom categories"), enhanced, "Enhancement is idempotent");
const selectInput = selectLabel.children[0].children[0];
document.activeElement = selectInput;
selectInput.value = "help";
selectInput.dispatchEvent({ type: "input" });
selectInput.parentNode.children[1].children[0].dispatchEvent({ type: "click" });
assert.equal(select.value, "helpers");
assert.equal(changes, 1, "Picking a suggestion uses the existing select change handler");
assert.equal(edits, 1, "Explicitly selected values notify delegated draft-change handlers");
assert.equal(selectInput.dataset.selectSearch, "true", "Search text is not a saved field edit");
assert.equal(selectInput.value, "");
select.disabled = true;
observers.at(-1).callback();
assert.equal(selectInput.disabled, true);
select.disabled = false;
const newOption = new Element("option");
newOption.textContent = "New category";
newOption.value = "new-category";
select.append(newOption);
observers.at(-1).callback();
selectInput.dispatchEvent({ type: "focus" });
assert.equal(selectInput.parentNode.children[1].children.length, 2);

console.log("PASS: Typeahead suggestions, explicit identity selection, keyboard navigation, live choices and disabled controls.");
