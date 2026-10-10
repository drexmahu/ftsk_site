"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function checkMemberCVSharing() {
  const script = fs.readFileSync(path.join(__dirname, "..", "..", "static", "js", "script.js"), "utf8");
  const start = script.indexOf("$(document).on('click', '.ftsk-member-cv-copy'");
  const end = script.indexOf("// Hero banner slideshow:", start);
  assert.ok(start >= 0 && end > start, "Public CV sharing handler exists");
  let handler, copied;
  const classes = new Set(["sr-only"]);
  const status = { textContent: "", classList: {
    add: name => classes.add(name), remove: name => classes.delete(name),
  } };
  const label = { textContent: "Megosztás" };
  const button = {
    disabled: false,
    closest: () => ({ querySelector: () => status }),
    querySelector: () => label,
    getAttribute: () => "/preview/tagok/alice/",
  };
  const context = {
    URL, document: {},
    $: () => ({ on: (_event, _selector, callback) => { handler = callback; } }),
    window: { location: { href: "https://example.test/preview/tagok/" } },
    navigator: { clipboard: { writeText: async url => { copied = url; } } },
  };
  vm.runInNewContext(script.slice(start, end), context);
  await handler.call(button);
  assert.equal(copied, "https://example.test/preview/tagok/alice/");
  assert.equal(button.disabled, false);
  assert.equal(label.textContent, "Másolva");
  assert.equal(status.textContent, "Link másolva.");
  assert.ok(classes.has("sr-only"), "Success must not add a bulky status row");
  let finishCopy;
  context.navigator.clipboard.writeText = () => new Promise(resolve => { finishCopy = resolve; });
  const pending = handler.call(button);
  assert.equal(button.disabled, true);
  finishCopy();
  await pending;
  assert.equal(button.disabled, false);
  context.navigator.clipboard.writeText = async () => { throw new Error("Permission denied"); };
  await handler.call(button);
  assert.match(status.textContent, /Permission denied/);
  assert.match(status.textContent, /Megnyitás/);
  assert.ok(!classes.has("sr-only"), "Copy failures must remain visible");
  assert.equal(button.disabled, false);
  delete context.navigator.clipboard;
  await handler.call(button);
  assert.match(status.textContent, /nem támogatja/);
  context.navigator.clipboard = { writeText: async () => {} };
  await handler.call(button);
  assert.ok(classes.has("sr-only"), "A successful retry clears the visible error row");
  const styles = fs.readFileSync(path.join(__dirname, "..", "..", "assets", "scss", "components", "_ftsk.scss"), "utf8").replace(/\r\n/g, "\n");
  const motifStyles = styles.slice(styles.indexOf(".ftsk-member-modal--cv {\n"), styles.indexOf("\n.ftsk-member-cv-document {"));
  assert.ok(motifStyles.includes("url($cave-hanging-url)") && motifStyles.includes("url($cave-standing-url)"));
  assert.ok(!motifStyles.includes("$hero-cave"), "CVs use the normal cave motifs, not the hero variants");
  const documentStyles = styles.slice(styles.indexOf(".ftsk-member-cv-document {\n"), styles.indexOf("\n.ftsk-member-cv {"));
  assert.ok(!documentStyles.includes("url("), "Standalone CV cards keep motifs outside the card");
  console.log("PASS: CV sharing copies subpath-aware URLs, reports errors and uses standard cave motifs.");
}

module.exports = { checkMemberCVSharing };
