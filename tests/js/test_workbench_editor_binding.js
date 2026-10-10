"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function checkEditorBinding() {
  class Area {
    constructor() {
      this.id = "markdown"; this.rows = 4; this.maxLength = 100;
      this.dataset = { monacoLanguage: "markdown" }; this.isConnected = true;
      this.events = []; this.attributes = {}; this.classList = { add() {}, remove() {} };
      this._value = ""; this._start = 0; this._end = 0;
    }
    get value() { return this._value; }
    set value(value) { this._value = String(value).replace(/\r\n/g, "\n"); }
    get selectionStart() { return this._start; }
    set selectionStart(value) { this._start = value; }
    get selectionEnd() { return this._end; }
    set selectionEnd(value) { this._end = value; }
    setSelectionRange(start, end) { this._start = start; this._end = end; }
    after(host) { this.host = host; }
    dispatchEvent(event) { this.events.push(event.type); }
    getAttribute(key) { return this.attributes[key]; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    closest(selector) {
      if (selector === "label") return this.wrappingLabel || null;
      return selector === "[inert]" && this.inert ? {} : null;
    }
    matches() { return Boolean(this.disabled); }
  }
  class Range {
    constructor(a, b, c, d) { this.from = { lineNumber: a, column: b }; this.to = { lineNumber: c, column: d }; }
    getStartPosition() { return this.from; }
    getEndPosition() { return this.to; }
  }
  const area = new Area(), notices = [], editors = [], models = [];
  const label = {
    textContent: "CV (Markdown)", listeners: {},
    after(host) { this.host = host; },
    addEventListener(type, callback) { this.listeners[type] = callback; },
    removeEventListener(type, callback) { if (this.listeners[type] === callback) delete this.listeners[type]; },
  };
  area.wrappingLabel = label;
  area.labels = [label];
  const monaco = {
    Range,
    editor: {
      createModel(value, language) {
        const model = {
          value, language, change: () => {},
          getValue() { return this.value; },
          setValue(value) { this.value = value; this.change(); },
          getLanguageId() { return this.language; },
          getOffsetAt(position) {
            return this.value.split("\n").slice(0, position.lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + position.column - 1;
          },
          getPositionAt(offset) {
            const lines = this.value.slice(0, offset).split("\n");
            return { lineNumber: lines.length, column: lines.at(-1).length + 1 };
          },
          dispose() { this.disposed = true; },
        };
        models.push(model);
        return model;
      },
      create(_host, options) {
        const editor = {
          options, selection: new Range(1, 1, 1, 1), cursor: () => {}, blur: () => {}, undoStops: 0,
          getSelection() { return this.selection; },
          setSelection(range) { this.selection = range; this.cursor(); },
          revealPositionInCenterIfOutsideViewport() {},
          onDidChangeModelContent(fn) { options.model.change = fn; return { dispose() {} }; },
          onDidChangeCursorSelection(fn) { this.cursor = fn; return { dispose() {} }; },
          onDidBlurEditorText(fn) { this.blur = fn; return { dispose() {} }; },
          getRawOptions() { return options; },
          updateOptions(value) { Object.assign(options, value); },
          focus() { this.focused = true; },
          pushUndoStop() { this.undoStops++; },
          executeEdits(_source, edits) {
            const model = options.model;
            for (const edit of edits) model.setValue(model.value.slice(0, model.getOffsetAt(edit.range.from)) +
              edit.text + model.value.slice(model.getOffsetAt(edit.range.to)));
          },
          dispose() { this.disposed = true; },
        };
        editors.push(editor);
        return editor;
      },
      setModelLanguage(model, language) { model.language = language; },
    },
  };
  const context = {
    HTMLTextAreaElement: Area, testMonaco: monaco, window: { dispatchEvent() {} },
    Event: function (type) { this.type = type; },
    MutationObserver: class { observe() {} },
    queueMicrotask, requestAnimationFrame: fn => fn(),
    notify: message => notices.push(message),
    document: {
      body: {}, createElement: () => ({ style: {}, addEventListener() {}, remove() { this.removed = true; } }),
      querySelectorAll: () => area.isConnected ? [area] : [], querySelector: () => null, addEventListener() {},
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "editors.js"), "utf8")
    .replace('import("/workbench-editor/editor.js")', "Promise.resolve({ monaco: testMonaco })");
  vm.runInNewContext(source, context);
  await Promise.resolve();
  await Promise.resolve();
  const binding = context.window.workbenchEditors;
  assert.ok(binding.get(area), notices.join("\n"));
  assert.ok(label.host, "Monaco must be outside the wrapping label to avoid native focus stealing");
  assert.equal(area.host, undefined);
  let prevented = false;
  label.listeners.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(editors[0].focused, true, "Clicking the field label focuses Monaco, not the hidden textarea");
  area.value = "## Title\r\nHello";
  assert.equal(models[0].getValue(), "## Title\nHello");
  assert.equal(area.events.includes("input"), false, "Loading source must not create an unsaved draft");
  area.setSelectionRange(9, 14);
  area.setRangeText("World", 9, 14, "end");
  assert.equal(area.value, "## Title\nWorld");
  assert.equal(area.selectionStart, 14);
  assert.equal(area.selectionEnd, 14);
  assert.ok(area.events.includes("input"), "Toolbar edits must update the draft");
  assert.equal(editors[0].undoStops, 2, "Toolbar edits need their own undo boundary");
  area.focus();
  assert.equal(editors[0].focused, true);
  editors[0].blur();
  assert.ok(area.events.includes("change"));
  area.disabled = true;
  editors[0].focused = false;
  label.listeners.click({ preventDefault() {} });
  assert.equal(editors[0].focused, false, "Disabled source labels cannot focus Monaco");
  binding.refresh();
  assert.equal(editors[0].options.readOnly, true);
  area.disabled = false; area.inert = true;
  binding.refresh();
  assert.equal(editors[0].options.readOnly, true);
  area.inert = false; area.dataset.sourcePath = "config.yaml";
  binding.refresh();
  assert.equal(editors[0].options.readOnly, false);
  assert.equal(models[0].language, "yaml");
  models[0].setValue("x".repeat(101));
  assert.equal(models[0].getValue(), "## Title\nWorld");
  assert.equal(area.value, "## Title\nWorld");
  assert.match(notices[0], /at most 100/);
  area.isConnected = false;
  binding.refresh();
  assert.equal(models[0].disposed, true);
  assert.equal(editors[0].disposed, true);
  assert.equal(label.host.removed, true);
  assert.equal(label.listeners.click, undefined, "Disposed editors remove label handlers");
  assert.equal(Object.hasOwn(area, "value"), false, "Disposal must restore native form behavior");
  assert.equal(binding.get(area), undefined);
  area.isConnected = true;
  area.wrappingLabel = null;
  binding.refresh();
  assert.ok(area.host, "Fields with separate labels keep the editor beside the native textarea");
  editors[1].focused = false;
  label.listeners.click({ preventDefault() {} });
  assert.equal(editors[1].focused, true, "Separate labels also focus their Monaco editor");
  area.inert = true;
  editors[1].focused = false;
  label.listeners.click({ preventDefault() {} });
  assert.equal(editors[1].focused, false, "Inert editor labels must respect modal focus isolation");
  area.isConnected = false;
  binding.refresh();
  console.log("PASS: Monaco bindings synchronize drafts, selections, insertion, locks and disposal.");
}

module.exports = { checkEditorBinding };
