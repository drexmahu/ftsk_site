const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "..", "static", "js", "script.js");
const script = fs.readFileSync(scriptPath, "utf8");
const helperStart = script.indexOf("function getCourseMilestoneStates");
const helperEnd = script.indexOf("$(document).ready", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);

const context = {};
vm.runInNewContext(script.slice(helperStart, helperEnd), context);

const milestones = [
  { date: "2026-10-22" },
  { date: "2026-12-01" },
  { date: "2027-01-27" },
  { date: "2027-02-10" },
  { date: "2027-07-01" },
];
const localDate = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour);

let states = context.getCourseMilestoneStates(milestones, localDate(2026, 10, 23));
assert.equal(states[0].status, "current");
assert.equal(states[0].showNow, true);
assert.ok(states[0].progress > 0 && states[0].progress < 0.1);
assert.equal(states[1].status, "upcoming");

states = context.getCourseMilestoneStates(milestones, localDate(2026, 12, 1, 0));
assert.equal(states[0].status, "done");
assert.equal(states[0].progress, 1);
assert.equal(states[1].status, "current");
assert.equal(states[1].progress, 0);

states = context.getCourseMilestoneStates(milestones, localDate(2027, 7, 1, 0));
assert.ok(states.every((state) => state.status === "done"));
assert.equal(states.at(-1).showNow, false);

states = context.getCourseMilestoneStates([
  { date: "2026-10-22" },
  { date: "" },
  { date: "2026-10-23" },
], localDate(2026, 10, 24));
assert.equal(states[0].status, "current");
assert.equal(states[1].status, "upcoming");
assert.equal(states[2].status, "upcoming");

const template = fs.readFileSync(
  path.join(__dirname, "..", "..", "layouts", "partials", "tanfolyam-milestones.html"),
  "utf8"
);
assert.match(template, /data-date=/);
assert.match(template, /printf "%.6f" \$p/);
assert.match(script, /progress\.toFixed\(6\)/);
assert.match(script, /window\.setInterval\(updateMilestones, 60 \* 1000\)/);
assert.match(script, /document\.addEventListener\('visibilitychange'/);

console.log("PASS: Course milestone statuses and progress follow current browser time.");
