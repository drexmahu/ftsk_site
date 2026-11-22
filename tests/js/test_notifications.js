const assert = require("node:assert/strict");
const path = require("node:path");
const { createStore, normalizeKind } = require(path.join(__dirname, "../../tools/workbench/web/notifications.js"));

let clock = 1000;
const storage = new Map();
const session = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
let store = createStore({ now: () => clock, storage: session });
const snapshot = () => store.snapshot();

assert.equal(normalizeKind(true), "error");
assert.equal(normalizeKind("", "Person saved. Membership is separate."), "success", "Outcome messages read as success");
assert.equal(normalizeKind("", "Select photos first"), "info");
assert.equal(normalizeKind("busy"), "busy");

// Problems stay until dismissed; passing messages expire on their own.
store.add("Saved page.", "success");
const failed = store.add("Could not save: the file changed.", "error");
assert.equal(snapshot().toasts.length, 2);
assert.equal(snapshot().toasts.find(item => item.kind === "success").sticky, false);
assert.equal(snapshot().toasts.find(item => item.kind === "error").sticky, true, "Errors must never vanish on a timer");
assert.equal(snapshot().attention, 1, "An unread problem raises the bell badge");
store.dismiss(failed);
assert.equal(snapshot().attention, 0, "Dismissing a problem acknowledges it");
assert.equal(snapshot().toasts.some(item => item.id === failed), false, "Dismissing hides the toast…");
assert.equal(snapshot().items.some(item => item.id === failed), true, "…but the problem stays findable in the notification center");

// A keyed message replaces its predecessor instead of stacking.
store.add("Uploading 1/3", "busy", { key: "upload" });
store.add("Uploading 2/3", "busy", { key: "upload" });
assert.equal(snapshot().items.filter(item => item.key === "upload").length, 1);
store.add("Photos queued.", "success", { key: "upload" });
assert.deepEqual(snapshot().items.filter(item => item.key === "upload").map(item => item.kind), ["success"], "A finished job replaces its progress message");

// Unkeyed progress is settled by the next outcome; empty text clears it.
store.add("Working on it", "busy");
assert.equal(snapshot().toasts.some(item => item.kind === "busy"), true);
store.add("Finished.");
assert.equal(snapshot().toasts.some(item => item.kind === "busy"), false, "Progress must not linger after its outcome");
assert.equal(snapshot().items.some(item => item.kind === "busy"), false, "Progress is not history");

// Repeated polling failures do not re-open a dismissed toast or add history.
store.add("Workspace disconnected", "error", { key: "connection", dedupe: true });
const before = snapshot().items.length;
store.dismissKey("connection");
store.add("Workspace disconnected", "error", { key: "connection", dedupe: true });
assert.equal(snapshot().items.length, before);
assert.equal(snapshot().toasts.some(item => item.key === "connection"), false);
store.add("Workspace reconnected.", "success", { key: "connection" });
assert.equal(snapshot().items.filter(item => item.key === "connection").length, 1, "Recovery replaces the outage message");
store.add("Same failure", "error");
store.add("Same failure", "error");
assert.equal(snapshot().items.filter(item => item.message === "Same failure").length, 1, "A report sent twice at once is a single event");
clock += 5000;
store.add("Same failure", "error");
assert.equal(snapshot().items.filter(item => item.message === "Same failure").length, 2, "An explicit retry that fails again is reported again");

// Reading marks problems as seen; a long message gets longer to read.
store.markRead();
assert.equal(snapshot().attention, 0);
store.add("x".repeat(600));
const long = snapshot().items.find(item => item.message.startsWith("xxxx"));
assert.ok(long.duration > 6000 && long.duration <= 20000);

// Only the newest toasts occupy the screen; nothing is lost.
store = createStore({ now: () => clock });
for (let index = 1; index <= 7; index += 1) store.add(`Problem ${index}`, "error");
assert.equal(snapshot().toasts.length, 4);
assert.equal(snapshot().hidden, 3);
assert.equal(snapshot().toasts.at(-1).message, "Problem 7", "Newest sits closest to the corner");
assert.equal(snapshot().items.length, 7);

// History survives a reload within the tab, without resurrecting toasts or alarms.
store = createStore({ now: () => clock, storage: session });
store.add("Saved page.", "success");
store.add("A problem", "error");
store = createStore({ now: () => clock, storage: session });
assert.ok(snapshot().items.some(item => item.message === "A problem"));
assert.equal(snapshot().toasts.length, 0);
assert.equal(snapshot().attention, 0);
storage.set("ftsk-workbench-notifications", "{not json");
assert.equal(createStore({ storage: session }).snapshot().items.length, 0, "Corrupt history is ignored");
store.clear();
assert.equal(snapshot().items.length, 0);
console.log("PASS: Notifications keep problems visible until dismissed, replace keyed progress, de-duplicate polling and survive reloads.");
