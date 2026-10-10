const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "..", "static", "barlangos-tortenelem", "index.html"), "utf8");
const start = source.indexOf("            function timelineWheel(event)");
const end = source.indexOf("            ['wheel'", start);
assert.ok(start >= 0 && end > start);
let window = [100000000000, 200000000000];
const context = {
  container: { clientHeight: 400, getBoundingClientRect: () => ({ left: 0, width: 1000 }) },
  $scope: { timeline: {
    getWindow: () => ({ start: new Date(window[0]), end: new Date(window[1]) }),
    setWindow: (start, end, options) => {
      assert.equal(options.animate, false);
      window = [start, end];
    },
  } },
};
vm.runInNewContext(source.slice(start, end), context);
function wheel(overrides = {}) {
  const event = {
    deltaY: 50, deltaMode: 0, clientX: 500, ctrlKey: false,
    stopped: false, prevented: false,
    stopImmediatePropagation() { this.stopped = true; },
    preventDefault() { this.prevented = true; },
    ...overrides,
  };
  context.timelineWheel(event);
  return event;
}
const initial = [...window];
const normal = wheel();
assert.deepEqual(window, initial);
assert.equal(normal.prevented, false);
assert.equal(normal.stopped, true);
const zoom = wheel({ ctrlKey: true, deltaY: -50 });
assert.equal(zoom.prevented, true);
assert.ok(window[1] - window[0] < initial[1] - initial[0]);
assert.equal((window[0] + window[1]) / 2, (initial[0] + initial[1]) / 2);
for (const options of [{ deltaY: 50000 }, { deltaY: 3, deltaMode: 1 },
  { deltaY: 1, deltaMode: 2 }, { deltaY: undefined, wheelDelta: -120 }]) {
  window = [...initial];
  wheel({ ctrlKey: true, ...options });
  assert.ok((window[1] - window[0]) / (initial[1] - initial[0]) <= Math.exp(0.2) + 1e-10);
}
assert.match(source, /'moveLeft'\)\.onclick\s*=\s*function \(\) \{ move\(-0\.2\)/);
assert.match(source, /'moveRight'\)\.onclick\s*=\s*function \(\) \{ move\( 0\.2\)/);
console.log("PASS: History timeline leaves page scroll alone, uses bounded Ctrl zoom and correct pan directions.");
