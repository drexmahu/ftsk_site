const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../tools/workbench/web/app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../../tools/workbench/web/index.html"), "utf8");
const start = source.indexOf("function startupStatus(");
const end = source.indexOf("\nfunction notify(", start);
const controls = new Map();
const get = selector => {
  if (!controls.has(selector)) controls.set(selector, {
    hidden: false, dataset: {}, attributes: {}, inert: true,
    setAttribute(key, value) { this.attributes[key] = value; },
  });
  return controls.get(selector);
};
const state = { token: "", git: null, initialized: false };
const context = { state, $: get };
vm.runInNewContext(source.slice(start, end), context);

context.startupStatus();
assert.equal(get("#workbench-startup").hidden, false);
assert.equal(get(".workspace").inert, true);
state.token = "local-token";
state.initialized = true;
context.startupStatus();
assert.equal(get("#workbench-startup").hidden, false, "A token alone cannot unlock unknown Git state");
context.startupStatus("Connection refused");
assert.equal(get("#startup-retry").hidden, false);
assert(get("#startup-detail").textContent.includes("Connection refused"));
assert.equal(get("#workbench-startup").attributes["aria-busy"], "false");
assert.equal(get(".sidebar").inert, true);
state.git = { branch: "work", editable: true };
context.startupStatus();
assert.equal(get("#workbench-startup").hidden, true);
for (const selector of [".sidebar", ".workspace", ".skip-link"]) assert.equal(get(selector).inert, false);
context.startupStatus("Later polling failure");
assert.equal(get("#workbench-startup").hidden, true, "Later reconnects must not obscure active drafts");
assert.equal(get(".workspace").inert, false);
assert.match(html, /class="sidebar" inert/);
assert.match(html, /class="workspace" inert/);
assert.match(source, /updateStatus\(await api\("\/api\/workbench\/status"\)\);\s*startupStatus\(\)/);
console.log("PASS: Startup blocks unknown state, surfaces retryable errors and unlocks only after a complete status snapshot.");
