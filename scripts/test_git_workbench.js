const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture() {
  const elements = new Map(), handlers = {};
  function node(tag, text = "", className = "") {
    return {
      tag, textContent: text, className, dataset: {}, children: [], attributes: {},
      value: "", hidden: false, disabled: false, open: false,
      classList: { toggle() {} },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      addEventListener(name, callback) { (this.handlers ||= {})[name] = callback; },
      click() { return this.handlers?.click?.(); },
      scrollIntoView() { this.scrolled = true; },
      focus() { this.focused = true; },
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelector() { return null; },
      querySelectorAll(selector) {
        const inputs = this.children.flatMap(child => child.tag === "input" ? [child] : child.querySelectorAll("input"));
        return selector === "input:checked" ? inputs.filter(input => input.checked) : selector === "input" ? inputs : [];
      },
    };
  }
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, node("element"));
    return elements.get(selector);
  };
  const panels = ["overview", "content", "photos", "portraits", "hero"].map(view => {
    const panel = get(`[data-panel="${view}"]`);
    panel.dataset.panel = view;
    return panel;
  });
  const links = new Map();
  const state = { token: "fixture-token", git: null, photos: [], portraits: [] };
  let reloads = 0, requests = 0, blockers = [], busyBlockers = [];
  const context = {
    $: get, node, state,
    document: {
      createElementNS: (namespace, tag) => node(tag),
      querySelector: get,
      querySelectorAll: selector => {
        if (selector === "[data-panel]") return panels;
        if (selector.startsWith("a[href=")) {
          if (!links.has(selector)) links.set(selector, node("a"));
          return [links.get(selector)];
        }
        return [];
      },
      addEventListener() {},
    },
    window: {
      addEventListener: (name, callback) => { handlers[name] = callback; },
      dispatchEvent: event => {
        if (event.type === "workbench-before-git") {
          event.detail.blockers.push(...blockers);
          event.detail.busy.push(...busyBlockers);
        }
        handlers[event.type]?.(event);
      },
    },
    Event: function(type) { this.type = type; },
    CustomEvent: function(type, options) { this.type = type; this.detail = options.detail; },
    location: { hash: "#overview", reload: () => { reloads++; } },
    searchableSelect() {}, navigate() {},
    confirm: () => true,
    api: async () => { requests++; return context.response; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "workbench", "git.js"), "utf8"), context);
  const data = {
    available: true, editable: true, branch: "working", head: "a".repeat(40), upstream: "origin/working",
    upstream_exists: true, ahead: 0, behind: 0, changes: [], branches: [
      { name: "main", head: "b".repeat(40), remote: false },
      { name: "working", head: "a".repeat(40), remote: false },
      { name: "origin/working", head: "a".repeat(40), remote: true },
    ], remote: true, rebase: false, conflicts: [], history: [], reasons: [], revision: "initial",
    job: { state: "idle", action: "", log: "", error: "" },
  };
  return { context, get, panels, links, data,
    update: value => context.window.updateGitState(value),
    block: value => { blockers = value; },
    activity: value => { busyBlockers = value; },
    reloads: () => reloads, requests: () => requests };
}

async function run() {
  let f = fixture();
  assert.ok(f.panels.filter(panel => panel.dataset.panel !== "overview").every(panel => panel.inert));
  f.update({ ...f.data, branch: "main", editable: false, reasons: ["main is protected"] });
  assert.ok(f.get("#git-branch-banner").textContent.includes("LOCKED · main"));
  assert.ok(f.context.gitDisabledReason("git-review", { ...f.data, branch: "main", editable: false }).includes("working branch"));
  assert.ok(f.context.gitDisabledReason("git-review", f.data).includes("Save your changes"));
  assert.ok(f.context.gitDisabledReason("git-push", { ...f.data, behind: 2 }).includes("pull --rebase"));
  assert.ok(f.context.gitDisabledReason("git-fetch", { ...f.data, remote: false }).includes("configure"));
  assert.ok(f.context.gitDisabledReason("git-continue", { ...f.data, rebase: true }).includes("every resolution"));
  assert.ok(f.context.gitDisabledReason("git-pull", { ...f.data, upstream: "", upstream_exists: false }).includes("establish tracking"));
  assert.ok(f.context.gitDisabledReason("git-rebase", { ...f.data, changes: [{ path: "test.md" }] }).includes("checkpoint first"));
  assert.ok(f.context.gitDisabledReason("git-refresh", { ...f.data, manual_terminal: true }).includes("type exit"));
  assert.ok(f.context.gitDisabledReason("git-refresh", { ...f.data, busy: true }).includes("Wait"));
  assert.ok(f.context.gitDisabledReason("git-push-lease", { ...f.data, lease_ready: false }).includes("recovery backup"));
  assert.equal(f.get("#git-review").disabled, true);
  assert.equal(f.get("#git-create").disabled, false, "Creating a working branch is allowed from main");
  f.get("#git-branch-controls").tagName = "BUTTON";
  f.get("#git-guidance-action").handlers.click();
  assert.equal(f.get("#git-branch-dialog").open, true, "Guidance opens branch choices on main");
  assert.equal(f.get("#git-checkout").focused, true);
  assert.equal(f.requests(), 0, "Opening branch choices never changes the checkout");
  f.get("#git-branch-close").handlers.click();
  assert.equal(f.get("#git-branch-dialog").open, false);
  f.get("#git-new-branch-open").handlers.click();
  assert.equal(f.get("#git-new-branch").focused, true);
  assert.ok(f.get("#git-branch-heading").textContent.includes("Create"));
  f.context.openGitConfirmation("create", { branch: "course-2027" });
  assert.equal(f.get("#git-branch-dialog").open, false, "Branch choices hand over to the existing confirmation");
  assert.equal(f.get("#git-confirm-dialog").open, true);
  assert.equal(f.requests(), 0);
  assert.equal(f.get("#git-push").disabled, true);
  assert.ok([...f.links.values()].every(link => link.attributes["aria-disabled"] === "true"));
  f.update({ ...f.data, branch: "main", head: f.data.head, editable: false, upstream: "origin/main", revision: "protected-update" });
  assert.equal(f.get("#git-pull").disabled, false, "A clean protected branch may receive a safe server update");
  f.update({ ...f.data, branch: "main", editable: false, upstream: "origin/main", ahead: 1, revision: "protected-ahead" });
  assert.equal(f.get("#git-pull").disabled, true, "Protected unpublished history needs a maintainer");

  f = fixture();
  f.update(f.data);
  assert.ok(f.panels.filter(panel => panel.dataset.panel !== "overview").every(panel => !panel.inert));
  assert.ok(f.get("#git-branch-banner").textContent.includes("WORKING BRANCH · working"));
  assert.ok(f.get("#git-fetch-note").textContent.includes("not been checked"));
  f.update({ ...f.data, ahead: 2, last_fetch: new Date().toISOString(), revision: "ahead" });
  assert.ok(f.get("#git-next-step").textContent.includes("ready to send"));
  assert.ok(f.get("#git-server-sync").textContent.includes("not all been sent"));
  f.update({ ...f.data, behind: 1, revision: "behind" });
  assert.equal(f.get("#git-push").disabled, true);
  assert.ok(f.get("#git-next-step").textContent.includes("pull --rebase"));
  f.update({ ...f.data, changes: [{ path: "data/people.yaml", status: " M" }], revision: "dirty" });
  assert.equal(f.get("#git-switch").disabled, true);
  assert.equal(f.get("#git-create").disabled, true);
  assert.ok(f.get("#git-switch-reason").textContent.includes("checkpoint"));
  assert.ok(f.get("#git-create-reason").textContent.includes("Checkpoint"));
  assert.equal(f.get("#git-branch-controls").disabled, false, "Blocked actions remain explainable in the modal");
  assert.equal(f.get("#git-pull").disabled, true);
  assert.equal(f.get("#git-review").disabled, false);
  f.block(["Save the person draft first."]);
  f.context.openGitBranchDialog(true);
  assert.equal(f.get("#git-create").disabled, true);
  assert.ok(f.get("#git-create-reason").textContent.includes("person draft"));
  assert.throws(() => f.context.openGitConfirmation("checkout", { branch: "main" }), /person draft/);
  f.context.openGitConfirmation("fetch");
  assert.equal(f.get("#git-confirm-dialog").open, true, "Fetch can be reviewed without discarding a draft");
  assert.equal(f.requests(), 0, "Opening a review never executes Git");

  f = fixture();
  const guidance = (extra = {}, drafts = [], locked = false) =>
    f.context.gitGuidance({ ...f.data, last_fetch: new Date().toISOString(), ...extra }, drafts, locked);
  assert.equal(guidance({}, ["Save the person draft first."]).domain, "work");
  assert.ok(guidance({}, ["Save the person draft first."]).message.includes("unsaved"));
  assert.equal(guidance({ changes: [{ path: "page.md" }] }).target, "git-review");
  assert.equal(guidance({ ahead: 2 }).target, "git-push");
  assert.equal(guidance({ behind: 2, ahead: 2 }).target, "git-pull", "Receive diverged branch before sending");
  assert.equal(guidance({ base_branch: "origin/main", base_behind: 3, ahead: 1 }).target, "git-rebase-controls");
  assert.equal(guidance({ last_fetch: null, ahead: 1 }).target, "git-fetch", "Cached equality is not proof of server state");
  assert.equal(guidance({ last_fetch: new Date(Date.now() - 16 * 60 * 1000).toISOString() }).target, "git-fetch");
  assert.equal(guidance({ remote: false }).level, "error");
  assert.equal(guidance({ upstream_exists: false }).level, "error");
  assert.equal(guidance({ rebase: true }).target, "git-recovery");
  assert.equal(guidance({ merge: true }).level, "error");
  assert.equal(guidance({ merge: true }).target, "git-advanced-recovery");
  assert.equal(guidance({ manual_terminal: true, busy: true }).target, "git-advanced-recovery");
  f.update({ ...f.data, merge: true, editable: false });
  assert.equal(f.get("#git-terminal").disabled, false, "Native recovery remains available for external merges");
  f.get("#git-terminal").handlers.click();
  assert.equal(f.get("#git-confirm-dialog").open, true);
  assert.ok(f.get("#git-confirm-description").textContent.includes("GUI protections do NOT apply"));
  assert.equal(f.requests(), 0, "Opening the terminal review never executes a shell");
  f.block(["Save the page draft first."]);
  f.update(f.data);
  assert.equal(f.get("#git-terminal").disabled, true);
  assert.ok(f.get("#git-terminal-note").textContent.includes("page draft"));
  f.block([]);
  f.update({ ...f.data, manual_terminal: true, busy: true, job: { action: "terminal", state: "running" } });
  assert.equal(f.get("#git-terminal").disabled, true);
  assert.equal(f.get("#git-fetch").disabled, true);
  assert.ok(f.panels.filter(panel => panel.dataset.panel !== "overview").every(panel => panel.inert));
  f = fixture();
  f.update(f.data);
  f.context.response = { ...f.data, editable: false, busy: true, manual_terminal: true,
    job: { action: "terminal", state: "running" } };
  await f.context.startGit({ action: "terminal", confirm: true, revision: f.data.revision });
  f.update({ ...f.data, job: { action: "terminal", state: "passed", log: "Closed" } });
  assert.equal(f.reloads(), 1, "Closing the owned terminal reloads actual checkout state");
  assert.ok(f.get("#git-action-notice").textContent.includes("not audited"));
  f = fixture();
  assert.equal(guidance({}, [], true).target, "git-branch-controls");
  assert.equal(guidance().level, "synced");
  const recovery = { phase: "ready", expected_remote: "a".repeat(40) };
  assert.equal(guidance({ recovery, lease_ready: true, behind: 3 }).target, "git-push-lease");
  assert.equal(guidance({ recovery, lease_ready: false }).target, "git-backup-info");
  const graph = {
    lanes: [
      { id: "main", name: "origin/main", head: "b" },
      { id: "local-main", name: "main", head: "a" },
      { id: "work", name: "working", head: "c" },
      { id: "server", name: "origin/working", head: "c" },
    ],
    nodes: [
      { id: "b", parents: ["a"], subject: "Main moves forward", lanes: ["main"] },
      { id: "c", parents: ["a"], subject: "<script>not executable</script>", lanes: ["work", "server"] },
      { id: "a", parents: ["older"], subject: "Shared checkpoint", lanes: ["main", "local-main", "work", "server"] },
    ],
    forks: ["a"], main_only: 1, work_only: 1, truncated: ["work"], limit: 18, shallow: false,
  };
  const layout = f.context.gitGraphLayout(graph);
  assert.ok(layout.positions.get("a").y < layout.positions.get("b").y);
  assert.ok(layout.positions.get("a").y < layout.positions.get("c").y);
  assert.notEqual(layout.positions.get("b").x, layout.positions.get("c").x);
  const edgePositions = new Map([
    ["parent", { x: 34, y: 42 }], ["unrelated", { x: 142, y: 104 }], ["child", { x: 142, y: 228 }],
  ]);
  assert.ok(f.context.gitGraphEdge(edgePositions.get("parent"), edgePositions.get("child"), edgePositions).includes("L 160 "),
    "Long ancestry links detour around unrelated checkpoints rather than implying a connection");
  f.context.renderGitGraph({ ...f.data, graph });
  assert.ok(f.get("#git-graph-summary").textContent.includes("Main has 1"));
  assert.ok(f.get("#git-graph-note").textContent.includes("18 recent"));
  const svg = f.get("#git-graph-canvas").children[0];
  const walk = element => [element, ...element.children.flatMap(walk)];
  assert.equal(walk(svg).filter(element => element.tag === "script").length, 0);
  assert.ok(walk(svg).some(element => element.textContent.includes("<script>")));
  assert.ok(walk(svg).some(element => element.attributes.class?.includes("boundary")));
  assert.ok(walk(svg).some(element => element.textContent.includes("SHARED BRANCH POINT")));
  assert.ok(walk(svg).some(element => element.textContent.includes("CHECKED OUT")));
  f.context.renderGitGraph({ ...f.data, graph });
  assert.equal(f.get("#git-graph-canvas").children[0], svg, "Polling does not recreate the unchanged graph");
  f.context.renderGitGraph({ ...f.data, graph, busy: true, job: { state: "running", action: "rebase", target: "origin/main" } });
  assert.equal(f.get("#git-history-graph").dataset.phase, "replaying");
  assert.ok(walk(f.get("#git-graph-canvas").children[0]).some(element => element.tag === "animateMotion"));
  assert.ok(f.get("#git-graph-operation").textContent.includes("not finished"));
  f.context.renderGitGraph({ ...f.data, graph, busy: true, job: { state: "running", action: "fetch" } });
  assert.equal(walk(f.get("#git-graph-canvas").children[0]).filter(element => element.tag === "animateMotion").length, 0,
    "Fetch never animates a history rewrite");
  f.context.renderGitGraph({ ...f.data, graph, rebase: true, job: { state: "failed", action: "rebase" } });
  assert.equal(f.get("#git-history-graph").dataset.phase, "paused");
  assert.ok(f.get("#git-graph-operation").textContent.includes("paused"));
  assert.ok(walk(f.get("#git-graph-canvas").children[0]).some(element => element.textContent.includes("ORIGINAL BRANCH")));
  f.context.renderGitGraph({ ...f.data, graph, job: { state: "passed", action: "rebase" } });
  assert.equal(f.get("#git-history-graph").dataset.phase, "settled");
  assert.ok(f.get("#git-graph-operation").textContent.includes("does not publish"));
  f.context.renderGitGraph({ ...f.data, graph: { ...graph, forks: [], shallow: true } });
  assert.ok(f.get("#git-graph-summary").textContent.includes("No shared"));
  assert.ok(f.get("#git-graph-note").textContent.includes("shallow"));
  f.context.renderGitGraph({ ...f.data, available: false });
  assert.equal(f.get("#git-graph-canvas").children.length, 0);
  f.block(["Save the page draft first."]);
  f.update(f.data);
  assert.equal(f.get("#git-work-station").dataset.pending, "true");
  assert.ok(f.get("#git-attention-link").textContent.includes("Save"));
  assert.ok(f.get("#git-draft-status").textContent.includes("unsaved"));
  f.block([]);
  f.update({ ...f.data, ahead: 2, last_fetch: new Date().toISOString() });
  assert.equal(f.get("#git-local-station").dataset.pending, "true");
  assert.equal(f.get("#git-guidance-action").dataset.target, "git-push");
  assert.equal(f.get("#git-push").dataset.suggested, "true");
  assert.equal(f.get("#git-fetch").dataset.suggested, "false");
  assert.equal(f.get("#git-map").dataset.suggestedFlow, "send");
  f.get("#git-push").tagName = "BUTTON";
  f.get("#git-guidance-action").handlers.click();
  assert.equal(f.get("#git-confirm-dialog").open, true);
  assert.equal(f.requests(), 0, "Guidance actions still open an explicit confirmation; no silent Git action");
  f.update({ ...f.data, base_behind: 1, base_branch: "origin/main", last_fetch: new Date().toISOString() });
  f.get("#git-branch-controls").tagName = "DETAILS";
  f.get("#git-rebase-controls").tagName = "DETAILS";
  f.get("#git-rebase-controls").id = "git-rebase-controls";
  f.get("#git-guidance-action").handlers.click();
  assert.equal(f.get("#git-rebase-controls").open, true);
  assert.equal(f.get("#git-rebase-controls").focused, true);
  assert.equal(f.get("#git-rebase-target").value, "origin/main");
  assert.equal(f.get("#git-rebase-controls").dataset.suggested, "true");
  assert.equal(f.get("#git-map").dataset.suggestedFlow, "", "A local rebase is not a server transfer");
  f.update({ ...f.data, busy: true, job: { state: "running", action: "fetch" } });
  assert.equal(f.get("#git-map").dataset.operation, "fetch");
  assert.equal(f.get("#git-map").dataset.suggestedFlow, "");
  assert.equal(f.get("#git-guidance-action").dataset.suggested, "false");
  f.update({ ...f.data, last_fetch: new Date().toISOString(), job: { state: "passed", action: "fetch" } });
  assert.ok(f.get("#git-action-notice").textContent.includes("matches"));
  assert.equal(f.get("#git-fetch").dataset.suggested, "false", "Synced state does not urge another immediate fetch");
  f.update({ ...f.data, busy: true, job: { state: "running", action: "fetch" } });
  f.update({ ...f.data, behind: 1, last_fetch: new Date().toISOString(), job: { state: "passed", action: "fetch" } });
  assert.ok(f.get("#git-action-notice").textContent.includes("pull --rebase"), "Each repeated fetch reports the new next step");
  assert.equal(f.get("#git-pull").dataset.suggested, "true");
  assert.equal(f.get("#git-map").dataset.suggestedFlow, "receive");
  f.update({ ...f.data, last_fetch: null });
  assert.equal(f.get("#git-fetch").dataset.suggested, "true");
  assert.equal(f.get("#git-map").dataset.suggestedFlow, "fetch");
  f.update({ ...f.data, changes: [{ path: "test.md", status: " M" }] });
  assert.equal(f.get("#git-review").dataset.suggested, "true");
  assert.equal(f.get("#git-map").dataset.suggestedFlow, "checkpoint");
  f.block(["Unsaved editor draft"]);
  f.update(f.data);
  assert.equal(f.get("#git-review").dataset.suggested, "false");
  assert.equal(f.get("#git-map").dataset.suggestedFlow, "", "Unsaved drafts must not imply a Git transfer");

  f = fixture();
  f.update(f.data);
  f.update({ ...f.data, busy: true, editable: false, job: { state: "running", action: "fetch" } });
  assert.ok(f.panels.filter(panel => panel.dataset.panel !== "overview").every(panel => panel.inert));
  assert.equal(f.get("#git-fetch").disabled, true);
  f.update(null);
  assert.equal(f.context.state.git.editable, false, "Disconnects fail closed");
  assert.ok(f.get("#git-lock-notice").textContent.includes("disconnected"));

  f = fixture();
  f.update(f.data);
  f.update({ ...f.data, head: "c".repeat(40), revision: "external" });
  assert.equal(f.context.state.git.editable, false, "External checkout changes lock old editors");
  assert.ok(f.get("#git-lock-notice").textContent.includes("outside this page"));

  f = fixture();
  f.update(f.data);
  f.context.response = { ...f.data, busy: true, editable: false, job: { state: "running", action: "checkout" } };
  await f.context.startGit({ action: "checkout", branch: "main", revision: "initial", confirm: true });
  f.update({ ...f.data, branch: "main", editable: false, revision: "main", job: { state: "passed", action: "checkout" } });
  assert.equal(f.reloads(), 1, "Successful branch changes reload every editor's data");

  f = fixture();
  f.update({ ...f.data, rebase: true, rebase_branch: "working", branch: "", editable: false, conflicts: ["shared.txt"], revision: "conflict",
    job: { state: "failed", action: "rebase", error: "Conflict in shared.txt" } });
  assert.equal(f.get("#git-recovery").hidden, false);
  assert.ok(f.get("#git-branch-banner").textContent.includes("Rebase: working"));
  assert.equal(f.get("#git-continue").disabled, true);
  assert.equal(f.get("#git-abort").disabled, false);
  assert.equal(f.get("#git-conflicts").children.length, 1);
  assert.ok(f.get("#git-action-notice").textContent.includes("Conflict in shared.txt"));
  assert.equal(f.reloads(), 0, "Failures do not reload or hide recovery state");

  f = fixture();
  f.update({ ...f.data, behind: 2, lease_ready: true, recovery: {
    id: "backup-fixture", phase: "ready", expected_remote: "b".repeat(40),
    directory: ".workbench-backups/fixture", branch: "working", original_head: "c".repeat(40),
  } });
  assert.equal(f.get("#git-push").disabled, true);
  assert.equal(f.get("#git-push-lease").hidden, false);
  assert.equal(f.get("#git-push-lease").disabled, false);
  assert.equal(f.get("#git-pull").disabled, true, "Do not rebase back onto obsolete published history");
  assert.equal(f.get("#git-rebase").disabled, true, "Preserve the pending exact lease until publication");
  assert.ok(f.get("#git-next-step").textContent.includes("force-with-lease"));
  f.get("#git-push-lease").handlers.click();
  assert.ok(f.get("#git-confirm-description").textContent.includes("b".repeat(40)));
  assert.ok(f.get("#git-confirm-description").textContent.includes(".workbench-backups/fixture"));
  assert.equal(f.get("#git-confirm").disabled, true);
  f.get("#git-lease-confirm-branch").value = "wrong";
  f.get("#git-lease-confirm-branch").handlers.input();
  assert.equal(f.get("#git-confirm").disabled, true);
  f.get("#git-lease-confirm-branch").value = "working";
  f.get("#git-lease-confirm-branch").handlers.input();
  assert.equal(f.get("#git-confirm").disabled, false);
  assert.equal(f.requests(), 0, "Reviewing leased publication does not push");
  f.update({ ...f.data, lease_ready: false, recovery: null, revision: "no-backup" });
  assert.equal(f.get("#git-push-lease").hidden, true);
  f.get("#git-rebase-target").value = "origin/main";
  f.get("#git-rebase-published").checked = true;
  f.get("#git-rebase").handlers.click();
  assert.ok(f.get("#git-confirm-description").textContent.includes("BEFORE rewriting"));
  assert.ok(f.get("#git-confirm-description").textContent.includes("main is never rewritten"));

  f = fixture();
  const changes = Array.from({ length: 50 }, (_, index) => ({ path: `file-${index}.md`, status: " M" }));
  f.update({ ...f.data, changes });
  f.context.openGitCommit();
  const files = f.get("#git-commit-files").querySelectorAll("input");
  assert.equal(files.length, 50);
  assert.equal(f.get("#git-preview-diff").disabled, true);
  f.get("#git-select-all").handlers.click();
  assert.ok(files.every(input => input.checked));
  assert.equal(f.get("#git-selection-count").textContent, "50 of 50 files selected");
  f.get("#git-file-search").value = "file-12";
  f.get("#git-file-search").handlers.input();
  assert.equal(f.get("#git-commit-files").children.filter(row => !row.hidden).length, 1);
  assert.ok(files.every(input => input.checked), "Search hides rows without changing selections");
  assert.equal(f.get("#git-preview-diff").disabled, false);
  f.context.response = { revision: "initial", paths: changes.map(change => change.path), diff: "Reviewed files",
    files: changes.map(change => ({ path: change.path, status: "changed", kind: "text",
      sections: [{ lines: [{ kind: "removed", text: "Old wording" }, { kind: "added", text: "<script>New wording</script>" }] }] })) };
  await f.get("#git-preview-diff").handlers.click();
  assert.equal(f.get("#git-commit-confirm").disabled, true, "Review alone is insufficient without a message");
  f.get("#git-commit-message").value = "   ";
  f.get("#git-commit-message").handlers.input();
  assert.equal(f.get("#git-commit-confirm").disabled, true, "Whitespace is not a commit message");
  f.get("#git-commit-message").value = "Update article wording";
  f.get("#git-commit-message").handlers.input();
  assert.equal(f.get("#git-commit-confirm").disabled, false);
  const readable = f.get("#git-friendly-review").children[1];
  assert.equal(readable.children[0].textContent, "File updated · file-0.md");
  const pair = readable.children[2];
  assert.equal(pair.children[0].children[0].textContent, "Before");
  assert.equal(pair.children[0].children[1].children[1].textContent, "Old wording");
  assert.equal(pair.children[1].children[0].textContent, "After");
  assert.equal(pair.children[1].children[1].children[1].textContent, "<script>New wording</script>", "Content is rendered as text, not HTML");
  assert.equal(f.get("#git-technical-review").open, false, "Raw Git details are collapsed by default");
  assert.equal(f.get("#git-friendly-review").children.length, 2, "Only one file card is rendered at a time");
  assert.equal(f.get("#git-review-position").textContent, "File 1 of 50");
  assert.equal(f.get("#git-review-previous").disabled, true);
  f.get("#git-review-next").handlers.click();
  assert.equal(f.get("#git-review-position").textContent, "File 2 of 50");
  assert.equal(f.get("#git-friendly-review").children[1].children[0].textContent, "File updated · file-1.md");
  f.get("#git-review-file").value = "49";
  f.get("#git-review-file").handlers.change();
  assert.equal(f.get("#git-review-position").textContent, "File 50 of 50");
  assert.equal(f.get("#git-review-next").disabled, true);
  f.get("#git-review-previous").handlers.click();
  assert.equal(f.get("#git-review-position").textContent, "File 49 of 50");
  f.get("#git-commit-message").value = "";
  f.get("#git-commit-message").handlers.input();
  await f.get("#git-commit-confirm").handlers.click();
  assert.equal(f.requests(), 1, "Empty messages never send a commit request");
  assert.ok(f.get("#git-action-notice").textContent.includes("short description"));
  f.get("#git-select-none").handlers.click();
  assert.ok(files.every(input => !input.checked));
  assert.equal(f.get("#git-selection-count").textContent, "0 of 50 files selected");
  assert.equal(f.get("#git-preview-diff").disabled, true);
  assert.equal(f.get("#git-commit-confirm").disabled, true, "Bulk changes invalidate the previous review");
  assert.equal(f.get("#git-review-navigation").hidden, true);
  files[0].checked = true;
  files[0].handlers.change();
  assert.equal(f.get("#git-selection-count").textContent, "1 of 50 files selected");
  let completeReview;
  f.context.api = () => new Promise(resolve => { completeReview = resolve; });
  const pendingReview = f.get("#git-preview-diff").handlers.click();
  f.get("#git-select-all").handlers.click();
  completeReview({ revision: "initial", paths: [files[0].value], diff: "Outdated selection" });
  await pendingReview;
  assert.equal(f.get("#git-commit-confirm").disabled, true, "A late response cannot approve an outdated selection");
  assert.ok(!f.get("#git-diff").textContent.includes("Outdated selection"));
  f.context.renderGitReview([{ path: "portrait.webp", status: "added", kind: "image", before: null,
    after: "data:image/webp;base64,fixture", warning: "" }]);
  const imagePair = f.get("#git-friendly-review").children[1].children[1];
  assert.ok(imagePair.children[0].children[1].textContent.includes("does not exist"));
  assert.equal(imagePair.children[1].children[1].src, "data:image/webp;base64,fixture");

  f = fixture();
  f.update({ ...f.data, upstream: "", branches: [...f.data.branches,
    { name: "origin/server-only", head: "d".repeat(40), remote: true }] });
  assert.ok(f.get("#git-local-sync").textContent.includes("No tracked server branch yet"));
  assert.ok(f.get("#git-branch-map").children.at(-1).children[2].textContent.includes("Server only"));

  f = fixture();
  f.update({ ...f.data, editable: false, branch: "main" });
  f.block(["Save the hidden page draft first."]);
  let discardCount = 0, completeDownload;
  f.context.window.addEventListener("workbench-discard-drafts", () => { discardCount++; });
  f.context.window.addEventListener("workbench-export-drafts", event => {
    event.detail.operations.push(new Promise(resolve => { completeDownload = resolve; }));
  });
  const downloading = f.get("#git-export-drafts").handlers.click();
  assert.equal(f.get("#git-discard-drafts").disabled, true);
  await f.get("#git-discard-drafts").handlers.click();
  assert.equal(discardCount, 0, "Discard cannot race an unfinished draft export");
  await assert.rejects(f.context.startGit({ action: "fetch" }), /draft download/);
  completeDownload();
  await downloading;
  assert.equal(f.get("#git-discard-drafts").disabled, false, "Draft rescue remains available on main");
  f.context.confirm = () => false;
  await f.get("#git-discard-drafts").handlers.click();
  assert.equal(discardCount, 0, "Cancellation preserves drafts");
  f.context.confirm = () => true;
  f.activity(["Wait for the current page operation."]);
  await f.get("#git-discard-drafts").handlers.click();
  assert.equal(discardCount, 0, "Busy editors cannot have their state discarded");
  assert.ok(f.get("#git-action-notice").textContent.includes("page operation"));
  f.activity([]);
  await f.get("#git-discard-drafts").handlers.click();
  assert.equal(discardCount, 1);
  console.log("PASS: Git dashboard branch locks, draft guards, explicit reviews, stale-state protection and rebase recovery.");
}

async function checkHeroBridge() {
  const parentHandlers = {}, frameHandlers = {}, requests = [], downloads = [];
  let source = "", completeWrite;
  const parent = {
    addEventListener: (type, handler) => { parentHandlers[type] = handler; },
    removeEventListener: type => { delete parentHandlers[type]; },
    downloadWorkbenchDraft: (name, draft) => downloads.push({ name, draft }),
  };
  const window = {
    parent,
    fetch: async (input, options) => {
      requests.push({ input, options });
      if (input === "/api/workbench/status") return { ok: true, json: async () => ({ token: "fixture", git: { branch: "working" } }) };
      if (options?.method === "PUT") await new Promise(resolve => { completeWrite = resolve; });
      return { ok: true };
    },
    addEventListener: (type, handler) => { frameHandlers[type] = handler; },
    dispatchEvent: event => {
      if (event.type === "workbench-hero-draft") event.detail.source = source;
      if (event.type === "workbench-hero-discard") source = "";
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "workbench", "hero-bridge.js"), "utf8"), {
    window, Headers,
    CustomEvent: function(type, options) { this.type = type; this.detail = options.detail; },
    Event: function(type) { this.type = type; },
  });
  source = '{"images":[{"path":"fixture.webp","alt":"Unsaved hero"}]}';
  let detail = { blockers: [], busy: [] };
  parentHandlers["workbench-before-git"]({ detail });
  assert.ok(detail.blockers[0].includes("hero draft"));
  detail = { operations: [] };
  parentHandlers["workbench-export-drafts"]({ detail });
  await Promise.all(detail.operations);
  assert.deepEqual(downloads[0], { name: "hero-draft.json", draft: source });
  assert.ok(source.includes("Unsaved hero"), "Export preserves the hero draft");
  const writing = window.fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" } });
  await new Promise(resolve => setImmediate(resolve));
  detail = { blockers: [], busy: [] };
  parentHandlers["workbench-before-git"]({ detail });
  assert.ok(detail.busy[0].includes("hero operation"));
  assert.equal(requests.at(-1).options.headers.get("X-Workbench-Token"), "fixture");
  assert.equal(requests.at(-1).options.headers.get("X-Workbench-Branch"), "working");
  completeWrite();
  await writing;
  parentHandlers["workbench-discard-drafts"]();
  assert.equal(source, "");
  frameHandlers.pagehide();
  assert.equal(Object.keys(parentHandlers).length, 0, "Closed hero frames release parent listeners");
}

module.exports = (async () => { await run(); await checkHeroBridge(); })();
