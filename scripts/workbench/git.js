"use strict";

const gitUI = { pending: null, commitReview: null, conflict: null, lastRevision: "", busy: false,
  reloadAction: "", context: "", stale: false, lastJob: "", ownedOperation: false, draftBusy: false,
  selectionVersion: 0, reviewFiles: [], reviewIndex: 0 };
const gitGraphUI = { key: "" };
const gitButtonHints = [];
let gitHintOwner = null;
let gitHintPopup = null;
const editingViews = ["content", "photos", "portraits", "hero"];
const gitFetchFreshness = 15 * 60 * 1000;

function gitGuidance(data, drafts, locked, now = Date.now()) {
  const changes = data.changes?.length || 0;
  const fetched = data.last_fetch ? new Date(data.last_fetch).getTime() : 0;
  const unchecked = !fetched || now - fetched >= gitFetchFreshness;
  const step = (stage, message, detail, target = "", domain = "", level = "attention") =>
    ({ stage, message, detail, target, domain, level });
  if (!data.available) return step("Connection needs attention", "Git is unavailable. Ask the site maintainer to restore this checkout.", "", "", "", "error");
  if (data.manual_terminal) return step("Manual Git recovery in progress", "Use the native terminal; Workbench is locked until it closes.",
    "Close child editors, then type exit in the recovery terminal. Workbench reloads the real Git state afterwards. Manual commands bypass GUI safeguards.", "git-advanced-recovery", "local", "working");
  if (data.busy) return step("Operation in progress", `Working: ${data.job?.action || "Git"}. Keep this window open; editors are temporarily locked.`,
    "The moving marker shows the direction of this operation. Nothing else is being published.", "", "", "working");
  if (data.rebase) return step("Finish or undo the paused update", "Resolve the conflicts and continue, or abort the rebase.",
    "Your previous history is backed up. Do not start another update.", "git-recovery", "local", "error");
  if (data.merge || data.conflicts?.length) return step("Maintainer help needed", "Unfinished history or file conflicts need attention.",
    "Use Advanced recovery to open a native Git terminal before editing or sending.", "git-advanced-recovery", "local", "error");
  if (drafts.length) return step("1 · Save your editor drafts", "You have unsaved work in this browser.",
    `${drafts.join(" ")} Drafts are not yet saved files, checkpoints or a GitHub backup. Open the relevant editor to save; recovery downloads are available below.`,
    "git-work-station", "work");
  if (locked) return step("Choose your working branch", "Choose or create a working branch before editing.",
    "Main is read-only. Your work must be on a working branch before it can be checkpointed or shared.", "git-branch-controls", "local");
  if (changes) return step("2 · Save a checkpoint", "Review your saved file changes and create a checkpoint.",
    `${changes} changed file(s) exist only on this computer. A checkpoint preserves the reviewed changes locally; sending to GitHub is a separate next step.`,
    "git-review", "work");
  if (data.recovery?.phase === "ready" && data.recovery.expected_remote) {
    return step("3 · Publish the rebased branch", "Your branch has been rebased. Review its backup, then publish with the protected force-with-lease action.",
      data.lease_ready ? "The GitHub branch still has the previous history. Confirm the protected publication to finish; ordinary Receive must not be used here." :
        "Publication is locked. Review the recovery notice and ask the maintainer if the original branch or server history changed.",
      data.lease_ready ? "git-push-lease" : "git-backup-info", "local");
  }
  if (!data.remote) return step("GitHub is not connected", "Your work is local only. Ask the maintainer to configure origin.",
    "There is no GitHub destination, so neither checking nor sending is available.", "", "server", "error");
  if (data.upstream && !data.upstream_exists) return step("Server branch missing", "Your tracked GitHub branch is missing.",
    "Check GitHub again, then ask the maintainer before republishing or changing tracking.", "git-fetch", "server", "error");
  if (data.behind) return step("Receive updates from GitHub", "Receive the server updates with pull --rebase.",
    `${data.behind} checkpoint(s) on your GitHub branch are missing locally. Receive them before sending your own checkpoints.`,
    "git-pull", "server");
  if (unchecked) return step("Check GitHub before continuing", "Check GitHub for new updates; this server snapshot may be out of date.",
    `${data.ahead ? `${data.ahead} local checkpoint(s) still need sending. ` : !data.upstream ? "This branch is still local only. " : ""}Fetch only refreshes your knowledge of GitHub. It does not change working files, receive updates, or send your work.`,
    "git-fetch", "server");
  if (data.base_behind > 0) return step("Follow the updated main branch", `Main has ${data.base_behind} checkpoint(s) your branch does not include.`,
    `Follow ${data.base_branch} with rebase before sharing. If this branch was already published, explicitly approve the backup-protected rebase, then publish with its lease.`,
    "git-rebase-controls", "local");
  if (data.ahead || !data.upstream) return step("3 · Send to GitHub", data.ahead ?
    "Your local checkpoints are ready to send to GitHub." : "This working branch has not been published to GitHub.",
    "Local checkpoints are not a remote backup. Send them explicitly; successful sending is not a merge into main or a guaranteed deployment.",
    "git-push", "local");
  return step("Checked & shared", "Your branch matches the last-checked GitHub state.",
    "Your files are checkpointed and those checkpoints are on GitHub. Check again when returning to work; the server snapshot is not live.",
    "git-fetch", "server", "synced");
}

function renderGitGuidance(data = state.git) {
  if (!data) return;
  const drafts = gitDraftBlockers();
  const guidance = gitGuidance(data, drafts, !data.editable);
  $("#git-guidance").dataset.level = guidance.level;
  for (const [id, text] of [["git-guidance-stage", guidance.stage], ["git-next-step", guidance.message],
    ["git-guidance-detail", guidance.detail], ["git-attention-link", guidance.stage]]) {
    if ($("#" + id).textContent !== text) $("#" + id).textContent = text;
  }
  $("#git-attention-link").dataset.level = guidance.level;
  const action = $("#git-guidance-action");
  action.hidden = !guidance.target;
  action.dataset.target = guidance.target;
  const target = guidance.target ? $("#" + guidance.target) : null;
  action.textContent = guidance.target === "git-work-station" ? "Show draft recovery & save guidance" :
    guidance.target === "git-branch-controls" ? "Choose a working branch" :
    guidance.target === "git-rebase-controls" ? "Review how to follow main" :
    guidance.target === "git-recovery" ? "Show conflict recovery" :
    guidance.target === "git-backup-info" ? "Show recovery backup" :
    target?.textContent || "Show next step";
  action.disabled = Boolean(target?.disabled);
  $("#git-draft-status").textContent = drafts.length ? `${drafts.length} unsaved draft / upload notice(s) — not checkpointed or on GitHub` :
    "No unsaved browser drafts or queued uploads detected.";
  $("#git-base-status").textContent = data.base_branch ?
    `${data.base_branch}: ${data.base_behind || 0} checkpoint(s) missing from this branch. Based on last-known server state; Fetch checks again.` :
    "Main's server branch is not known yet. Check GitHub first.";
  const terminalBlock = data.manual_terminal ? "Recovery terminal is already open. Close it to resume Workbench." :
    !data.available ? "Git checkout is unavailable. Open your own terminal manually." :
    data.busy || gitUI.busy || gitUI.draftBusy ? "Wait for the current operation to finish." :
    drafts.length ? drafts.join(" ") : "";
  $("#git-terminal").disabled = Boolean(terminalBlock);
  $("#git-terminal-note").textContent = terminalBlock || "Opens a separate native window after explicit confirmation; no Git command runs automatically.";
  $("#git-pull-help").textContent = data.recovery?.phase === "ready" && data.recovery.expected_remote ?
    "Publish your backed-up rebase with its recorded lease first. Receiving here would mix rewritten and old history." :
    data.rebase || data.merge || data.conflicts?.length ? "Resolve or abort the unfinished history operation first; use Advanced recovery if needed." :
    drafts.length ? "Save browser drafts and finish uploads before receiving teammates' changes." :
    data.changes?.length ? "Create a checkpoint for saved files first. Receiving never stashes or discards them automatically." :
    !data.upstream?.startsWith("origin/") || !data.upstream_exists ? "Publish this working branch first to establish its tracked GitHub branch." :
    `Fetch all remotes with prune, then replay your unpublished checkpoints onto ${data.upstream}. Keeps teammates' work; no merge or force push. Conflicts pause for review.`;
  for (const domain of ["work", "local", "server"]) {
    $("#" + `git-${domain}-station`).dataset.attention = guidance.domain === domain && guidance.level !== "synced" ? "true" : "false";
  }
  $("#git-work-station").dataset.pending = String(drafts.length > 0 || Boolean(data.changes?.length));
  $("#git-local-station").dataset.pending = String(Boolean(data.ahead || (data.head && !data.upstream) ||
    (data.recovery?.phase === "ready" && data.recovery.expected_remote)));
  $("#git-server-station").dataset.pending = String(Boolean(data.behind));
  if (drafts.length && !data.changes?.length) gitDots($("#git-work-dots"), drafts.length, true);
  renderGitBranchDialog();
  action.disabled = Boolean(target?.disabled);
  const suggested = guidance.level === "attention" && !data.busy && !gitUI.busy &&
    !gitUI.draftBusy && !gitUI.stale && target && !target.disabled ? guidance.target : "";
  action.dataset.suggested = String(Boolean(suggested));
  for (const id of ["git-review", "git-fetch", "git-pull", "git-push", "git-push-lease",
    "git-branch-controls", "git-new-branch-open", "git-rebase-controls", "git-rebase"]) {
    const element = $("#" + id);
    const matches = id === suggested ||
      suggested === "git-branch-controls" && id === "git-new-branch-open" ||
      suggested === "git-rebase-controls" && id === "git-rebase";
    element.dataset.suggested = String(Boolean(matches && !element.disabled));
  }
  const flows = { "git-review": "checkpoint", "git-fetch": "fetch", "git-pull": "receive",
    "git-push": "send", "git-push-lease": "send" };
  $("#git-map").dataset.suggestedFlow = flows[suggested] || "";
  refreshGitButtonHints();
}

function gitDisabledReason(id, data = state.git || {}) {
  if (id === "git-guidance-action") return gitDisabledReason($("#git-guidance-action").dataset.target, data);
  if (data.manual_terminal) return "The recovery terminal is open. Close child editors and type exit there to unlock Workbench.";
  if (!data.available || !state.token) return "Workbench is disconnected or Git is unavailable. Reconnect and reload the page before continuing.";
  if (gitUI.busy || gitUI.draftBusy || data.busy) return "Another operation is running. Wait for it to finish before starting this action.";
  if (["git-export-drafts", "git-discard-drafts"].includes(id)) return "An editor save, preview or upload is running. Wait for it to finish, then recover your drafts.";
  if (id === "git-confirm" && gitUI.pending?.action === "push-lease") return "Type the exact working branch name shown in this review to enable protected publication.";
  if (id === "git-continue") return data.rebase ?
    "Conflicting files remain. Review and accept every resolution, or use Advanced recovery, then continue." :
    "There is no paused rebase to continue. Start a reviewed update first.";
  if (id === "git-abort") return "There is no active rebase to abort.";
  if (data.rebase || data.merge || data.conflicts?.length) return "A history operation or conflict is unfinished. Resolve and continue it, abort the rebase, or use Advanced recovery first.";
  if (gitUI.stale) return "The checkout changed outside this page. Download unsaved drafts, then reload Workbench before continuing.";
  const drafts = gitDraftBlockers();
  if (drafts.length && id !== "git-fetch" && id !== "git-refresh") return drafts.join(" ");
  if (["git-pull", "git-rebase"].includes(id) && data.recovery?.phase === "ready" && data.recovery.expected_remote) {
    return "Your published branch has already been rebased. Review the backup and publish with its recorded force-with-lease first; do not receive the old history.";
  }
  if (id === "git-create" && !data.head) return "A starting checkpoint is required. Ask the maintainer to initialise this checkout first.";
  if (id === "git-switch" && !data.branches?.length) return "There are no known branches to select. Check the server or ask the maintainer to initialise this checkout.";
  const protectedPull = id === "git-pull" && ["main", "master"].includes(data.branch) &&
    data.upstream === `origin/${data.branch}` && data.ahead === 0;
  if (!data.editable && !protectedPull && ["git-pull", "git-review", "git-rebase", "git-push", "git-push-lease"].includes(id)) {
    return "This checkout is protected or detached. Choose or create a working branch first; unpublished changes on main require maintainer review.";
  }
  if (data.changes?.length && ["git-switch", "git-create", "git-pull", "git-rebase", "git-push", "git-push-lease"].includes(id)) {
    return "Saved files have uncommitted changes. Review changed files and create a checkpoint first; nothing is automatically stashed or discarded.";
  }
  if (id === "git-review") return "There are no saved file changes to checkpoint. Save your changes in an editor first.";
  if (id === "git-fetch") return "No server remote is configured. Ask the maintainer to configure one before fetching.";
  if (["git-push", "git-pull"].includes(id) && !data.remote) return "No origin server is configured. Ask the maintainer to configure origin first.";
  if (id === "git-pull") return !data.upstream?.startsWith("origin/") ?
    "This branch has no tracked GitHub branch. Send its first checkpoint to establish tracking before receiving updates." :
    "The tracked server branch is missing. Fetch again, then ask the maintainer before recreating or changing its tracking.";
  if (id === "git-push" && data.behind) return "Your branch is missing teammates' server checkpoints. Receive updates with pull --rebase before sending.";
  if (id === "git-push-lease") return "Protected publication needs the original working branch, unchanged recorded server lease and valid recovery backup. Review the recovery notice; ask the maintainer if history or origin changed.";
  if (id === "git-commit-confirm") return "Review the current selected files and enter a checkpoint message. If files or selection changed, review them again before committing.";
  if (id === "git-preview-diff") return "Select at least one changed file, then review the selected changes.";
  if (id === "git-review-previous") return "This is the first reviewed file. Use Next file or the file selector to inspect another.";
  if (id === "git-review-next") return "This is the last reviewed file. Use Previous file or the file selector to inspect another.";
  return "This control is unavailable in the current review. Refresh the state and complete the required selections or review shown here first.";
}

function hideGitButtonHint() {
  if (gitHintPopup) gitHintPopup.hidePopover();
  gitHintOwner = null;
}

function showGitButtonHint(entry) {
  if (!entry.button.disabled || entry.button.hidden) return;
  gitHintOwner = entry;
  gitHintPopup.textContent = entry.button.dataset.disabledReason;
  gitHintPopup.showPopover();
  const rect = entry.wrapper.getBoundingClientRect();
  const popup = gitHintPopup.getBoundingClientRect();
  gitHintPopup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - popup.width - 12))}px`;
  gitHintPopup.style.top = `${Math.max(12, rect.bottom + popup.height + 12 < window.innerHeight ?
    rect.bottom + 8 : rect.top - popup.height - 8)}px`;
}

function refreshGitButtonHints() {
  for (const entry of gitButtonHints) {
    const disabled = entry.button.disabled;
    const reason = disabled ? gitDisabledReason(entry.button.id) : "";
    entry.button.dataset.disabledReason = reason;
    entry.button.title = "";
    entry.description.textContent = reason;
    entry.wrapper.dataset.disabled = String(disabled);
    entry.wrapper.hidden = entry.button.hidden;
    entry.wrapper.tabIndex = disabled && !entry.button.hidden ? 0 : -1;
    entry.wrapper.setAttribute("aria-label", disabled ? `${entry.button.textContent.trim()}. Unavailable. ${reason}` : entry.button.textContent.trim());
    if (gitHintOwner === entry) {
      if (!disabled || entry.button.hidden) hideGitButtonHint();
      else gitHintPopup.textContent = reason;
    }
  }
}

function initGitButtonHints() {
  const buttons = document.querySelectorAll('button[id^="git-"]');
  if (!buttons.length) return;
  gitHintPopup = node("div", "", "git-disabled-tooltip");
  gitHintPopup.setAttribute("popover", "manual");
  gitHintPopup.setAttribute("role", "tooltip");
  document.body.append(gitHintPopup);
  for (const button of buttons) {
    const wrapper = node("span", "", "git-button-help");
    wrapper.setAttribute("role", "group");
    const description = node("span", "", "sr-only");
    description.id = `${button.id}-disabled-description`;
    button.setAttribute("aria-describedby", description.id);
    button.parentNode.insertBefore(wrapper, button);
    wrapper.append(button, description);
    const entry = { button, wrapper, description };
    gitButtonHints.push(entry);
    wrapper.addEventListener("mouseenter", () => showGitButtonHint(entry));
    wrapper.addEventListener("mouseleave", hideGitButtonHint);
    wrapper.addEventListener("focus", () => showGitButtonHint(entry));
    wrapper.addEventListener("blur", hideGitButtonHint);
    wrapper.addEventListener("click", () => { if (button.disabled) showGitButtonHint(entry); });
    new MutationObserver(refreshGitButtonHints).observe(button, { attributes: true, attributeFilter: ["disabled", "hidden"] });
  }
  document.addEventListener("keydown", event => { if (event.key === "Escape") hideGitButtonHint(); });
  window.addEventListener("scroll", hideGitButtonHint, true);
  window.addEventListener("resize", hideGitButtonHint);
  refreshGitButtonHints();
}

function renderGitBranchDialog() {
  const data = state.git || {};
  const drafts = gitDraftBlockers();
  const unavailable = !data.available || !state.token || gitUI.busy || gitUI.draftBusy || data.busy;
  const history = data.rebase || data.merge || data.conflicts?.length;
  for (const id of ["git-branch-controls", "git-new-branch-open"]) {
    $("#" + id).disabled = Boolean(unavailable || history);
  }
  $("#git-branch-context").textContent = `Current checkout: ${data.branch || "no branch"}. ${data.changes?.length || 0} saved file change(s). ${drafts.length} unsaved draft / upload notice(s). ${data.last_fetch ? "Server choices reflect the last GitHub check." : "GitHub has not been checked in this session."}`;
  const common = unavailable ? "Wait for the operation or reconnect before changing branches." :
    history ? "Finish or abort the active history operation first." :
    gitUI.stale ? "The checkout changed outside this page. Preserve your drafts and reload before changing branches." :
    drafts.length ? drafts.join(" ") : "";
  const switchReason = common || (data.changes?.length ? "Create a checkpoint for saved changes before switching." :
    !data.branches?.length ? "No existing branch is available yet. Ask the maintainer to initialise this checkout." : "");
  const createReason = common || (!data.head ? "A starting checkpoint is required. Ask the maintainer to initialise this checkout." :
    data.changes?.length && !["main", "master"].includes(data.branch) ? "Checkpoint saved changes on this working branch before creating another branch." : "");
  $("#git-switch").disabled = Boolean(switchReason);
  $("#git-create").disabled = Boolean(createReason);
  $("#git-switch-reason").textContent = switchReason || "Ready to review a switch. All editors reload after confirmation.";
  $("#git-create-reason").textContent = createReason || `Starts from ${data.branch || "this checkout"}. Saved changes on main are carried onto the new branch. Review and confirm before anything changes.`;
}

function openGitBranchDialog(create = false) {
  renderGitBranchDialog();
  $("#git-branch-heading").textContent = create ? "Create a new working branch" : "Switch your working branch";
  if (!$("#git-branch-dialog").open) $("#git-branch-dialog").showModal();
  $(create ? "#git-new-branch" : "#git-checkout").focus();
}

function gitGraphLayout(graph) {
  const commits = new Map(graph.nodes.map(commit => [commit.id, commit]));
  const ordered = [], visited = new Set();
  function visit(id) {
    if (visited.has(id) || !commits.has(id)) return;
    visited.add(id);
    const commit = commits.get(id);
    commit.parents.forEach(visit);
    ordered.push(commit);
  }
  graph.forks.forEach(visit);
  graph.nodes.forEach(commit => visit(commit.id));
  const positions = new Map(ordered.map((commit, index) => {
    const lane = graph.lanes.findIndex(item => commit.lanes.includes(item.id));
    return [commit.id, { x: 34 + Math.max(0, lane) * 54, y: 42 + index * 62 }];
  }));
  return { ordered, positions, labelX: 58 + graph.lanes.length * 54, height: 80 + ordered.length * 62 };
}

function gitSvg(tag, attributes = {}, text = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text) element.textContent = text;
  return element;
}

function gitGraphEdge(parent, position, positions) {
  const crossing = [...positions.values()].some(other =>
    other.x === position.x && other.y > parent.y && other.y < position.y);
  const rail = position.x + (crossing ? parent.x <= position.x ? 18 : -18 : 0);
  return `M ${parent.x} ${parent.y} C ${parent.x} ${parent.y + 20}, ${rail} ${parent.y + 20}, ${rail} ${parent.y + 28} ` +
    `L ${rail} ${position.y - 20} Q ${rail} ${position.y}, ${position.x} ${position.y}`;
}

function renderGitGraph(data) {
  const graph = data.graph;
  const region = $("#git-history-graph");
  const running = data.busy && ["rebase", "pull", "continue"].includes(data.job?.action);
  const settled = !data.busy && data.job?.state === "passed" && ["rebase", "pull", "continue"].includes(data.job?.action);
  region.dataset.phase = data.rebase && !data.busy ? "paused" : running ? "replaying" : settled ? "settled" : "idle";
  const operation = $("#git-graph-operation");
  operation.hidden = !running && !data.rebase && !settled;
  operation.textContent = data.rebase && !data.busy ?
    "Rebase is paused. The working-branch label still marks its original history; the paused checkout marks the current replay position. Resolve conflicts or abort below." :
    running ? `Updating local history${data.job.target ? ` onto ${data.job.target}` : ""}. Motion illustrates replay, not finished checkpoints. The graph stays at the last confirmed state until Git reports the result.` :
    settled ? "Local history updated. The graph now shows the confirmed result. Receiving or rebasing does not publish rewritten checkpoints to GitHub; review the next-step banner." : "";
  const key = JSON.stringify([graph, region.dataset.phase, data.job?.target, data.head, data.available]);
  if (gitGraphUI.key === key) return;
  gitGraphUI.key = key;
  if (!data.available || !graph?.nodes.length) {
    $("#git-graph-summary").textContent = !data.available ? "Git is unavailable; the graph cannot be checked." :
      data.head ? "Checkpoint graph is unavailable. Restart Workbench to load the updated Git service." :
      "No checkpoints yet. The graph appears after the checkout has its first checkpoint.";
    $("#git-graph-canvas").replaceChildren();
    $("#git-graph-list").replaceChildren();
    $("#git-graph-legend").replaceChildren();
    $("#git-graph-note").textContent = "";
    return;
  }
  const main = graph.lanes.find(lane => lane.id === "main");
  const work = graph.lanes.find(lane => lane.id === "work");
  $("#git-graph-summary").textContent = !main ? "Main is not known in this checkout. Check GitHub to discover its history." :
    !graph.forks.length ? "No shared checkpoint is known between main and this checkout. Do not guess a rebase base; ask the maintainer." :
    !graph.main_only && !graph.work_only ? "Main and this checkout share the same latest checkpoint." :
    `Main has ${graph.main_only} checkpoint(s) not in your branch. Your branch has ${graph.work_only} checkpoint(s) not in main. Shared checkpoint${graph.forks.length === 1 ? "" : "s"}: ${graph.forks.map(id => id.slice(0, 7)).join(", ")}.`;
  $("#git-graph-legend").replaceChildren(...graph.lanes.map(lane => {
    const label = node("span", `${lane.id === "work" ? data.rebase ? "Original working branch" : "Your checkout" : lane.id === "main" ? "Main" :
      lane.id === "local-main" ? "Local main" : lane.id === "replay" ? "Paused checkout" : "Your branch on GitHub"}: ${lane.name} (${lane.head.slice(0, 7)})`, `git-graph-key ${lane.id}`);
    return label;
  }));
  $("#git-graph-note").textContent = `Solid lines are real parent links; dashed stubs mean earlier history is outside this view. ${graph.truncated.length ?
    `Showing up to ${graph.limit} recent checkpoints per lane plus the shared branch point, not the entire history. ` : ""}${graph.shallow ?
    "This is a shallow checkout: earlier ancestry may be missing. " : ""}GitHub labels use locally cached server history, not a live feed. Check GitHub to refresh them. The branch point is the latest shared ancestry, not a recorded branch-creation date.`;
  const { ordered, positions, labelX, height } = gitGraphLayout(graph);
  const svg = gitSvg("svg", { viewBox: `0 0 850 ${height}`, width: 850, height,
    role: "img", "aria-label": "Checkpoint ancestry, older at top and newer below. Full checkpoint details are in the list below." });
  svg.append(gitSvg("title", {}, "Main and working-branch checkpoints with actual ancestry"));
  for (const [index, lane] of graph.lanes.entries()) {
    svg.append(gitSvg("line", { x1: 34 + index * 54, x2: 34 + index * 54, y1: 14, y2: height - 25,
      class: `git-graph-rail ${lane.id}` }));
  }
  const edges = gitSvg("g"), marks = gitSvg("g");
  for (const commit of ordered) {
    const position = positions.get(commit.id);
    const lane = graph.lanes.find(item => commit.lanes.includes(item.id));
    for (const parentId of commit.parents) {
      const parent = positions.get(parentId);
      const edge = gitSvg("path", { d: parent ?
        gitGraphEdge(parent, position, positions) :
        `M ${position.x} ${position.y - 24} L ${position.x} ${position.y}`,
        class: `git-graph-edge ${lane.id}${parent ? "" : " boundary"}` });
      edge.append(gitSvg("title", {}, parent ? `Parent ${parentId.slice(0, 7)} -> ${commit.id.slice(0, 7)}` :
        `Earlier parent ${parentId.slice(0, 7)} outside this view`));
      edges.append(edge);
    }
    const references = graph.lanes.filter(item => item.head === commit.id).map(item =>
      `${item.id === "work" ? data.rebase ? "ORIGINAL BRANCH: " : "CHECKED OUT: " : ""}${item.name}`);
    const fork = graph.forks.includes(commit.id);
    const group = gitSvg("g", { class: `git-graph-node ${lane.id}${fork ? " fork" : ""}` });
    group.append(gitSvg("title", {}, `${commit.id}\n${commit.subject}\n${references.join(", ")}${fork ? "\nLatest shared ancestry / branch point" : ""}`));
    if (fork || references.length) group.append(gitSvg("circle", { cx: position.x, cy: position.y, r: 13, class: "git-graph-halo" }));
    group.append(gitSvg("circle", { cx: position.x, cy: position.y, r: fork ? 7 : 5, class: "git-graph-dot" }));
    group.append(gitSvg("text", { x: labelX, y: position.y - 4, class: "git-graph-subject" },
      commit.subject.length > 55 ? commit.subject.slice(0, 52) + "..." : commit.subject));
    const detail = `${commit.id.slice(0, 7)}${fork ? "  SHARED BRANCH POINT" : ""}${references.length ? "  " + references.join(" / ") : ""}`;
    group.append(gitSvg("text", { x: labelX, y: position.y + 15, class: "git-graph-reference" },
      detail.length > 82 ? detail.slice(0, 79) + "..." : detail));
    marks.append(group);
  }
  svg.append(edges, marks);
  const target = graph.lanes.find(lane => lane.name === data.job?.target);
  if (running && target && work && positions.has(work.head) && positions.has(target.head) && work.head !== target.head) {
    const start = positions.get(work.head), end = positions.get(target.head);
    const path = `M ${start.x} ${start.y} C ${start.x + 120} ${start.y}, ${end.x + 120} ${end.y}, ${end.x} ${end.y}`;
    svg.append(gitSvg("path", { d: path, class: "git-graph-replay-path" }));
    const marker = gitSvg("circle", { r: 7, class: "git-graph-replay-marker" });
    marker.append(gitSvg("animateMotion", { dur: "2.4s", repeatCount: "indefinite", path }));
    svg.append(marker);
  }
  $("#git-graph-canvas").replaceChildren(svg);
  $("#git-graph-list").replaceChildren(...ordered.map(commit => node("li",
    `${commit.id.slice(0, 7)} - ${commit.subject}${graph.forks.includes(commit.id) ? " - shared branch point" : ""}. ` +
    graph.lanes.filter(lane => lane.head === commit.id).map(lane =>
      `${lane.name}${lane.id === "work" ? data.rebase ? " (original branch)" : " (checked out)" : ""}`).join(", "))));
}

function gitNotice(message, error = false) {
  const notice = $("#git-action-notice");
  notice.hidden = !message;
  notice.textContent = message;
  notice.className = `notice ${error ? "error" : ""}`;
  for (const dialog of document.querySelectorAll('dialog[id^="git-"]')) {
    if (!dialog.open) continue;
    let local = dialog.querySelector(".git-dialog-notice");
    if (!local) {
      local = node("p", "", "notice git-dialog-notice");
      local.setAttribute("role", "alert");
      dialog.append(local);
    }
    local.textContent = message;
    local.className = `notice git-dialog-notice ${error ? "error" : ""}`;
    local.hidden = !message;
  }
}

async function gitRun(operation) {
  try { await operation(); }
  catch (error) { gitNotice(error.message, true); }
}

function gitDraftBlockers(allowDrafts = false) {
  const detail = { blockers: [], busy: [] };
  window.dispatchEvent(new CustomEvent("workbench-before-git", { detail }));
  if (state.photos.length || state.portraits.length) detail.blockers.push("Convert or remove queued photo uploads first.");
  return allowDrafts ? detail.busy : [...detail.blockers, ...detail.busy];
}

function gitDraftRecoveryGuard() {
  if (gitUI.busy || gitUI.draftBusy || state.git?.busy) throw new Error("Wait for the current Git or draft-download operation.");
  const blockers = gitDraftBlockers(true);
  if (blockers.length) throw new Error(blockers.join(" "));
}

function gitGate() {
  const editable = Boolean(state.git?.editable) && !gitUI.stale && !gitUI.busy;
  document.querySelectorAll("[data-panel]").forEach(panel => {
    if (editingViews.includes(panel.dataset.panel)) panel.inert = !editable;
  });
  for (const view of editingViews) {
    document.querySelectorAll(`a[href="#${view}"]`).forEach(link => {
      link.setAttribute("aria-disabled", String(!editable));
      link.tabIndex = editable ? 0 : -1;
      link.title = editable ? "" : "Editing is locked. Choose a working branch in Git / Start here.";
    });
  }
  if (!editable && $("#person-editor-dialog").open) $("#person-editor-dialog").close();
  if (!editable && editingViews.includes(location.hash.slice(1))) {
    document.querySelectorAll("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== "overview"; });
    $("#breadcrumb").textContent = "Git · Start here";
  } else if (editable && editingViews.includes(location.hash.slice(1)) &&
      document.querySelector(`[data-panel="${location.hash.slice(1)}"]`).hidden) {
    navigate();
  }
  window.dispatchEvent(new Event("workbench-busy"));
  const recoveryBusy = gitUI.busy || gitUI.draftBusy || state.git?.busy || gitDraftBlockers(true).length > 0;
  for (const id of ["git-export-drafts", "git-discard-drafts"]) {
    $("#" + id).disabled = Boolean(recoveryBusy);
    $("#" + id).title = recoveryBusy ? "Wait for the current operation before downloading or discarding drafts." : "";
  }
  refreshGitButtonHints();
}

function gitDots(container, count, pending = false) {
  container.replaceChildren();
  for (let i = 0; i < Math.min(count, 12); i++) container.append(node("span", "", pending ? "pending" : ""));
}

function gitBranches(select, branches) {
  const previous = select.value;
  select.replaceChildren(...branches.map(branch => {
    const option = node("option", `${branch.remote ? "Server" : "Local"} · ${branch.name} · ${branch.head.slice(0, 7)}`);
    option.value = branch.name;
    return option;
  }));
  if (branches.some(branch => branch.name === previous)) select.value = previous;
}

window.updateGitState = function(raw) {
  const data = raw || { available: false, editable: false, reasons: ["Workbench is disconnected. Reconnect before editing."], changes: [], branches: [] };
  const context = `${data.branch || ""}:${data.head || ""}`;
  if (gitUI.context && data.available && !data.busy && gitUI.context !== context &&
      !gitUI.ownedOperation) gitUI.stale = true;
  if (data.available && !data.busy) gitUI.context = context;
  state.git = { ...data, editable: data.editable && !gitUI.stale && !data.busy && !data.manual_terminal };
  const locked = !state.git.editable;
  const branchLabel = data.rebase ? `Rebase: ${data.rebase_branch || data.branch || "paused"}` :
    data.branch || (data.available ? "Detached checkout" : "Git unavailable");
  $("#git-branch-banner").textContent = `${locked ? "LOCKED" : "WORKING BRANCH"} · ${branchLabel}`;
  $("#git-branch-banner").classList.toggle("locked", locked);
  $("#git-lock-notice").hidden = !locked;
  $("#git-lock-notice").textContent = gitUI.stale ?
    "The checkout changed outside this page. Save a copy of any unsaved draft, then reload Workbench before editing." :
    (data.reasons?.length ? data.reasons : ["A Git operation is running. Editing resumes when it finishes."]).join(" ");
  const changes = data.changes || [];
  $("#git-file-count").textContent = `${changes.length} saved file change(s)`;
  $("#git-local-branch").textContent = data.rebase ? `Rebasing ${data.rebase_branch || data.branch || "paused branch"}` : data.branch || "No working branch";
  $("#git-local-sync").textContent = data.head ?
    `${data.head.slice(0, 7)} · ${data.upstream ? `${data.ahead || 0} checkpoint(s) to send` : "No tracked server branch yet"}` : "No checkpoint yet";
  $("#git-server-branch").textContent = data.upstream || "No tracked server branch";
  $("#git-server-sync").textContent = data.upstream ?
    !data.upstream_exists ? "Tracked server branch is missing" :
    data.recovery?.phase === "ready" && data.recovery.expected_remote ?
      "Server still has the previous history. Publish the rebased branch with its recorded lease." :
    data.behind ? `${data.behind} server checkpoint(s) to receive` :
    data.ahead ? "Your local checkpoints have not all been sent" : "Local and last-known server checkpoints match" :
    "First push will publish your working branch";
  $("#git-fetch-note").textContent = data.last_fetch ?
    `Last successful server contact: ${new Date(data.last_fetch).toLocaleString()}. Fetch again to detect newer updates.` :
    "Server state has not been checked in this Workbench session. Fetch to check; cached refs are not live.";
  gitDots($("#git-work-dots"), changes.length, true);
  gitDots($("#git-local-dots"), (data.history || []).length);
  gitDots($("#git-server-dots"), data.behind || (data.upstream ? 1 : 0), Boolean(data.behind));
  $("#git-map").classList.toggle("running", Boolean(data.busy));
  $("#git-map").dataset.operation = data.job?.action || "";
  $("#git-map").setAttribute("aria-busy", String(Boolean(data.busy)));
  const busy = gitUI.busy || data.busy || !data.available || !state.token;
  for (const id of ["git-refresh", "git-fetch", "git-switch", "git-create", "git-pull",
    "git-rebase", "git-review", "git-push", "git-continue", "git-abort"]) $("#" + id).disabled = busy;
  $("#git-fetch").disabled = busy || !(data.remotes?.length || data.remote) || data.rebase || data.merge;
  $("#git-switch").disabled = busy || changes.length > 0 || data.rebase || data.merge;
  $("#git-create").disabled = busy || data.rebase || data.merge || !data.head ||
    (changes.length > 0 && !["main", "master"].includes(data.branch));
  const protectedUpdate = ["main", "master"].includes(data.branch) && !gitUI.stale &&
    data.upstream === `origin/${data.branch}` && data.ahead === 0 && !data.conflicts?.length;
  $("#git-pull").disabled = busy || (locked && !protectedUpdate) || changes.length > 0 ||
    data.rebase || data.merge || !data.upstream?.startsWith("origin/") || !data.upstream_exists;
  $("#git-rebase").disabled = busy || locked || changes.length > 0;
  $("#git-review").disabled = busy || locked || !changes.length;
  $("#git-push").disabled = busy || locked || changes.length > 0 || !data.remote || data.behind > 0;
  const leasedRebase = data.recovery?.phase === "ready" && Boolean(data.recovery.expected_remote);
  if (leasedRebase) {
    $("#git-pull").disabled = true;
    $("#git-rebase").disabled = true;
  }
  $("#git-push-lease").hidden = !leasedRebase;
  $("#git-push-lease").disabled = busy || locked || !data.lease_ready;
  $("#git-lease-note").hidden = !leasedRebase;
  $("#git-lease-note").textContent = data.lease_ready ?
    "Only the server checkpoint recorded before your rebase may be replaced. A newer server update will reject this push, even after Fetch." :
    "Leased publication is locked: finish the rebase, commit saved files, and use the original working branch and origin. External history changes require maintainer review.";
  $("#git-backup-info").hidden = !data.recovery;
  $("#git-backup-description").textContent = data.recovery ?
    `Backup: ${data.recovery.directory}. Original branch: ${data.recovery.branch} at ${data.recovery.original_head.slice(0, 7)}. State: ${data.recovery.phase}. Includes a history bundle, commit patches, binary-capable changes patch and recovery instructions.` : "";
  $("#git-rebase-published").disabled = busy || locked;
  $("#git-continue").disabled = busy || !data.rebase || data.conflicts?.length > 0;
  $("#git-abort").disabled = busy || !data.rebase;
  $("#git-recovery").hidden = !data.rebase;
  $("#git-log").textContent = data.job?.log || "No Git operation yet.";
  if (data.revision !== gitUI.lastRevision && !data.busy) {
    gitUI.lastRevision = data.revision;
    gitBranches($("#git-checkout"), data.branches || []);
    gitBranches($("#git-rebase-target"), (data.branches || []).filter(branch => branch.name !== data.branch));
    const localBranches = (data.branches || []).filter(branch => !branch.remote);
    const represented = new Set(localBranches.map(branch => branch.upstream || `origin/${branch.name}`));
    $("#git-branch-map").replaceChildren(...localBranches.map(branch => {
      const row = node("div", "", "git-branch-row");
      const rebasing = data.rebase && branch.name === data.rebase_branch;
      row.classList.toggle("checked-out", branch.name === data.branch || rebasing);
      const remote = data.branches.find(item => item.remote && item.name === (branch.upstream || `origin/${branch.name}`));
      row.append(node("strong", `${rebasing ? "REBASE IN PROGRESS · " : branch.name === data.branch ? "CHECKED OUT · " : ""}${branch.name}`),
        node("code", `Local ${branch.head.slice(0, 7)}`), node("span", remote ?
          `${remote.head === branch.head ? "=" : "≠"} Server ${remote.head.slice(0, 7)}` : "Local only · not on server"));
      return row;
    }), ...(data.branches || []).filter(branch => branch.remote && !represented.has(branch.name)).map(branch => {
      const row = node("div", "", "git-branch-row");
      row.append(node("strong", branch.name), node("code", `Server ${branch.head.slice(0, 7)}`),
        node("span", "Server only · select this branch to download a local checkout"));
      return row;
    }));
    $("#git-changes").replaceChildren(...changes.map(file => node("p", `${file.status} · ${file.path}`, "git-file-row")));
    $("#git-history").replaceChildren(...(data.history || []).map(commit => node("li", `${commit.id} · ${commit.subject}`)));
    $("#git-conflicts").replaceChildren(...(data.conflicts || []).map(path => {
      const button = node("button", `Review conflict: ${path}`, "secondary");
      button.type = "button";
      button.addEventListener("click", () => gitRun(() => openGitConflict(path)));
      return button;
    }));
    if (gitUI.commitReview && gitUI.commitReview.revision !== data.revision) {
      gitUI.commitReview = null;
      $("#git-commit-confirm").disabled = true;
      gitNotice("Files changed since the commit review. Close it and review the current files again.", true);
    }
  }
  const jobKey = JSON.stringify([data.job?.state, data.job?.action, data.job?.error]);
  if (data.job?.state === "running") gitUI.lastJob = jobKey;
  if (jobKey !== gitUI.lastJob && ["passed", "failed"].includes(data.job?.state)) {
    gitUI.lastJob = jobKey;
    gitNotice(data.job.state === "failed" ?
      `${data.job.action} did not finish: ${data.job.error}${data.rebase ? " Resolve the rebase conflicts below, or abort." : " Refresh and review before retrying."}` :
      `${data.job.action === "terminal" ? "Recovery terminal closed. Inspect the refreshed state; manual Git commands were not audited. " : `${data.job.action} completed. `}${data.job.action === "fetch" ? "All remotes fetched and stale remote-tracking branches pruned; working files were not changed. " : ""}${gitGuidance(data, gitDraftBlockers(), locked).message}`,
    data.job.state === "failed");
    if (gitUI.reloadAction && data.job.state === "passed") {
      gitUI.reloadAction = "";
      location.reload();
    } else if (data.job.state === "failed") {
      if (gitUI.reloadAction === "terminal") location.reload();
      gitUI.reloadAction = "";
    }
    gitUI.ownedOperation = false;
  }
  gitGate();
  renderGitGuidance(state.git);
  renderGitGraph(state.git);
};

async function refreshGit() {
  window.updateGitState(await api("/api/workbench/git"));
}

function openGitConfirmation(action, extra = {}) {
  const blockers = action === "fetch" ? [] : gitDraftBlockers();
  if (blockers.length) throw new Error(blockers.join(" "));
  const descriptions = {
    fetch: "Run git fetch --all --prune: check every configured remote and remove stale remote-tracking references for deleted server branches. Local branches, working files and checkout stay unchanged.",
    checkout: `Switch the entire checkout from ${state.git.branch || "detached"} to ${extra.branch}. Editors will reload.`,
    create: `Create ${extra.branch} from ${state.git.branch}. Existing saved changes on main will stay with the new working branch.`,
    pull: `Receive teammates' changes on ${state.git.upstream}: fetch all remotes with prune, then replay your unpublished checkpoints from ${state.git.branch} on top. Saved files must be checkpointed first. No merge, automatic stash or force push. A local recovery backup is made for working branches. Conflicts pause the update for review, continue or abort; Advanced recovery opens your native terminal if necessary.`,
    terminal: "Open Windows PowerShell in this real checkout for manual recovery. No Git command runs automatically. Your commands can discard files, rewrite main or force-push: GUI protections do NOT apply inside the terminal. Workbench editing, builds and Git operations lock until you close it. Close child editors, type exit, and inspect the reloaded state. Do not restart Workbench while the terminal is open.",
    rebase: extra.allow_published ?
      `Follow ${extra.target} with ${state.git.branch}, including published checkpoints. Workbench will check the server again and save the original history bundle and patches in the Git-excluded .workbench-backups folder BEFORE rewriting. Conflicts may require review. To update your published branch afterwards, separately confirm force-with-lease; main is never rewritten.` :
      `Move unpublished checkpoints on ${state.git.branch} onto ${extra.target}. The original history and patches are backed up locally first. Published checkpoints need explicit permission to follow origin/main.`,
    push: `Send local checkpoints on ${state.git.branch} to origin/${state.git.branch} using an ordinary push. Never merge into main.`,
    "push-lease": `Replace ONLY origin/${state.git.branch} with your rebased branch. The server MUST still be at ${extra.expected_remote}; any newer server checkpoint rejects this push. Recovery backup: ${state.git.recovery?.directory}. This rewrites your published branch, not main. Coordinate with anyone else using this branch before confirming.`,
    continue: "Continue the active rebase using the resolutions you have accepted.",
    abort: "Abort the active rebase and restore its previous branch state. Conflict resolutions made during this rebase will be discarded.",
  };
  gitUI.pending = { action, ...extra, revision: state.git.revision, confirm: true };
  $("#git-lease-confirm-label").hidden = action !== "push-lease";
  $("#git-lease-confirm-branch").value = "";
  $("#git-confirm").disabled = action === "push-lease";
  $("#git-confirm-heading").textContent = `Confirm: ${action}`;
  $("#git-confirm-description").textContent = descriptions[action];
  if (["checkout", "create"].includes(action)) $("#git-branch-dialog").close();
  $("#git-confirm-dialog").showModal();
}

async function startGit(payload) {
  if (gitUI.draftBusy) throw new Error("Wait for the draft download to finish.");
  if (gitUI.busy || state.git?.busy) throw new Error("Wait for the current Git operation to finish.");
  if (payload.action !== "fetch") {
    const blockers = gitDraftBlockers();
    if (blockers.length) throw new Error(blockers.join(" "));
  }
  gitUI.busy = true;
  gitUI.ownedOperation = true;
  gitGate();
  try {
    const result = await api("/api/workbench/git/action", { method: "POST", payload });
    if (["checkout", "create", "pull", "rebase", "continue", "abort", "terminal"].includes(payload.action)) gitUI.reloadAction = payload.action;
    gitUI.lastJob = "";
    window.updateGitState(result);
  } catch (error) {
    gitUI.ownedOperation = false;
    throw error;
  } finally {
    gitUI.busy = false;
    gitGate();
  }
}

function gitFileAction(file) {
  if (file.status === "??" || file.status?.includes("A") || file.status === "added") return "New file";
  if (file.status?.includes("D") || file.status === "removed") return "File removed";
  if (file.from) return "File renamed";
  return "File updated";
}

function updateGitCommitButton() {
  const message = $("#git-commit-message");
  const valid = Boolean(message.value.trim()) && message.value.length <= 2000;
  message.setCustomValidity?.(valid ? "" : "Write a short description of what changed.");
  $("#git-commit-confirm").disabled = !gitUI.commitReview || !valid;
}

function renderGitReview(files) {
  gitUI.reviewFiles = files;
  $("#git-review-file").replaceChildren(...files.map((file, index) => {
    const option = node("option", `${gitFileAction(file)} · ${file.path}`);
    option.value = String(index);
    return option;
  }));
  $("#git-review-navigation").hidden = false;
  showGitReviewFile(0);
}

function showGitReviewFile(index) {
  if (!Number.isInteger(index) || index < 0 || index >= gitUI.reviewFiles.length) return;
  gitUI.reviewIndex = index;
  $("#git-review-file").value = String(index);
  $("#git-review-position").textContent = `File ${index + 1} of ${gitUI.reviewFiles.length}`;
  $("#git-review-previous").disabled = index === 0;
  $("#git-review-next").disabled = index === gitUI.reviewFiles.length - 1;
  $("#git-review-scroll").scrollTop = 0;
  const review = $("#git-friendly-review");
  review.replaceChildren(node("p", "Compare the previous checkpoint with your saved changes below.", "hint"));
  for (const file of [gitUI.reviewFiles[index]]) {
    const card = node("section", "", "git-review-card");
    card.append(node("h3", `${gitFileAction(file)} · ${file.path}`));
    if (file.warning) card.append(node("p", file.warning, "notice"));
    if (file.kind === "image") {
      const pair = node("div", "", "git-review-pair");
      for (const side of ["before", "after"]) {
        const pane = node("div", "", `git-review-${side}`);
        pane.append(node("h4", side === "before" ? "Before" : "After"));
        if (file[side]) {
          const image = node("img", "");
          image.src = file[side];
          image.alt = `${side === "before" ? "Previous" : "New"} image: ${file.path}`;
          pane.append(image);
        } else pane.append(node("p", file.status === (side === "before" ? "added" : "removed") ?
          "This file does not exist in this version." : "Preview unavailable. Inspect the full image before committing.", "hint"));
        pair.append(pane);
      }
      card.append(pair);
    } else {
      for (const [index, section] of (file.sections || []).entries()) {
        card.append(node("p", `Changed area ${index + 1}`, "hint"));
        const pair = node("div", "", "git-review-pair");
        for (const side of ["before", "after"]) {
          const pane = node("div", "", `git-review-${side}`);
          pane.append(node("h4", side === "before" ? "Before" : "After"));
          const lines = section.lines.filter(line => line.kind !== (side === "before" ? "added" : "removed"));
          for (const line of lines) {
            const row = node("div", "", `git-review-line ${line.kind}`);
            if (line.kind !== "same") row.append(node("span", line.kind === "added" ? "Added" : "Removed", "git-review-label"));
            row.append(node("span", line.text || " ", "git-review-text"));
            pane.append(row);
          }
          if (!lines.length) pane.append(node("p", side === "before" ? "Nothing here before." : "This content has been removed.", "hint"));
          pair.append(pane);
        }
        card.append(pair);
      }
    }
    review.append(card);
  }
}

function updateGitCommitSelection() {
  gitUI.selectionVersion++;
  gitUI.commitReview = null;
  gitUI.reviewFiles = [];
  $("#git-review-navigation").hidden = true;
  $("#git-commit-confirm").disabled = true;
  $("#git-diff").textContent = "Selection changed. Review the selected files before creating a checkpoint.";
  $("#git-friendly-review").replaceChildren(node("p", "Selection changed. Review the selected files before creating a checkpoint.", "hint"));
  $("#git-technical-review").hidden = true;
  $("#git-technical-review").open = false;
  $("#git-diff-note").textContent = "";
  const files = Array.from($("#git-commit-files").querySelectorAll("input"));
  const selected = files.filter(input => input.checked).length;
  $("#git-selection-count").textContent = `${selected} of ${files.length} files selected`;
  $("#git-preview-diff").disabled = selected === 0;
}

function openGitCommit() {
  const blockers = gitDraftBlockers();
  if (blockers.length) throw new Error(blockers.join(" "));
  gitUI.commitReview = null;
  $("#git-commit-confirm").disabled = true;
  $("#git-commit-message").value = "";
  $("#git-file-search").value = "";
  $("#git-diff").textContent = "Choose files, then review.";
  $("#git-commit-files").replaceChildren(...state.git.changes.map(file => {
    const label = node("label", "", "git-file-row");
    label.dataset.path = file.path;
    const checkbox = node("input", "");
    checkbox.type = "checkbox";
    checkbox.value = file.path;
    checkbox.addEventListener("change", updateGitCommitSelection);
    label.append(checkbox, node("span", `${gitFileAction(file)} · ${file.path}`));
    return label;
  }));
  updateGitCommitSelection();
  $("#git-commit-dialog").showModal();
}

async function openGitConflict(path) {
  const revision = state.git.revision;
  gitUI.conflict = { ...await api("/api/workbench/git/conflict", { method: "POST", payload: {
    path, revision,
  } }), revision };
  $("#git-conflict-heading").textContent = `Resolve: ${path}`;
  $("#git-conflict-source").value = gitUI.conflict.source;
  $("#git-conflict-dialog").showModal();
}

$("#git-refresh").addEventListener("click", () => gitRun(refreshGit));
$("#git-export-drafts").addEventListener("click", () => gitRun(async () => {
  gitDraftRecoveryGuard();
  gitUI.draftBusy = true;
  gitGate();
  try {
    const detail = { operations: [] };
    window.dispatchEvent(new CustomEvent("workbench-export-drafts", { detail }));
    await Promise.all(detail.operations);
    gitNotice("Any open unsaved editor drafts have been downloaded. Check your Downloads folder before discarding.");
  } finally {
    gitUI.draftBusy = false;
    gitGate();
  }
}));
$("#git-discard-drafts").addEventListener("click", () => gitRun(() => {
  gitDraftRecoveryGuard();
  if (!confirm("Discard unsaved page, person and hero drafts only? Download a copy first if needed. Saved files and Git checkpoints will not be changed.")) return;
  window.dispatchEvent(new Event("workbench-discard-drafts"));
  gitNotice("Unsaved editor drafts discarded. Saved checkout files and checkpoints were not changed.");
}));
for (const [id, operation] of [
  ["git-fetch", () => openGitConfirmation("fetch")],
  ["git-terminal", () => openGitConfirmation("terminal")],
  ["git-switch", () => openGitConfirmation("checkout", { branch: $("#git-checkout").value })],
  ["git-create", () => {
    const branch = $("#git-new-branch").value.trim();
    if (!branch) throw new Error("Enter a name for your new working branch before reviewing it.");
    openGitConfirmation("create", { branch });
  }],
  ["git-pull", () => openGitConfirmation("pull")],
  ["git-rebase", () => openGitConfirmation("rebase", { target: $("#git-rebase-target").value,
    allow_published: $("#git-rebase-published").checked })],
  ["git-push", () => openGitConfirmation("push")],
  ["git-push-lease", () => openGitConfirmation("push-lease", {
    backup_id: state.git.recovery?.id, expected_remote: state.git.recovery?.expected_remote })],
  ["git-continue", () => openGitConfirmation("continue")],
  ["git-abort", () => openGitConfirmation("abort")],
  ["git-review", openGitCommit],
]) $("#" + id).addEventListener("click", () => gitRun(operation));
$("#git-confirm").addEventListener("click", () => gitRun(async () => {
  const payload = { ...gitUI.pending };
  if (payload.action === "push-lease") {
    payload.branch_confirmation = $("#git-lease-confirm-branch").value;
    if (payload.branch_confirmation !== state.git.branch) throw new Error("Type the exact working branch name before publishing rewritten history.");
  }
  await startGit(payload);
  $("#git-confirm-dialog").close();
}));
$("#git-lease-confirm-branch").addEventListener("input", () => {
  $("#git-confirm").disabled = gitUI.pending?.action === "push-lease" &&
    $("#git-lease-confirm-branch").value !== state.git.branch;
});
$("#git-rebase-published").addEventListener("change", () => {
  if (!$("#git-rebase-published").checked) return;
  const base = ["origin/main", "origin/master"].find(name => state.git.branches.some(branch => branch.name === name));
  if (base) $("#git-rebase-target").value = base;
});
$("#git-confirm-cancel").addEventListener("click", () => $("#git-confirm-dialog").close());
$("#git-commit-cancel").addEventListener("click", () => $("#git-commit-dialog").close());
$("#git-commit-message").addEventListener("input", updateGitCommitButton);
$("#git-file-search").addEventListener("input", () => {
  const search = $("#git-file-search").value.trim().toLocaleLowerCase();
  for (const row of $("#git-commit-files").children) row.hidden = !row.dataset.path.toLocaleLowerCase().includes(search);
});
$("#git-review-file").addEventListener("change", () => showGitReviewFile(Number($("#git-review-file").value)));
$("#git-review-previous").addEventListener("click", () => showGitReviewFile(gitUI.reviewIndex - 1));
$("#git-review-next").addEventListener("click", () => showGitReviewFile(gitUI.reviewIndex + 1));
for (const [id, checked] of [["git-select-all", true], ["git-select-none", false]]) {
  $("#" + id).addEventListener("click", () => {
    $("#git-commit-files").querySelectorAll("input").forEach(input => { input.checked = checked; });
    updateGitCommitSelection();
  });
}
$("#git-preview-diff").addEventListener("click", () => gitRun(async () => {
  const paths = Array.from($("#git-commit-files").querySelectorAll("input:checked"), input => input.value);
  const revision = state.git.revision, selectionVersion = gitUI.selectionVersion;
  const review = await api("/api/workbench/git/review", { method: "POST", payload: { paths, revision } });
  if (selectionVersion !== gitUI.selectionVersion || revision !== state.git.revision || !$("#git-commit-dialog").open) return;
  if (!Array.isArray(review.files) || review.files.length !== paths.length) {
    throw new Error("The readable review is unavailable. Restart Workbench and review again before committing.");
  }
  gitUI.commitReview = review;
  renderGitReview(review.files);
  $("#git-technical-review").hidden = false;
  $("#git-diff").textContent = gitUI.commitReview.diff;
  $("#git-diff-note").textContent = gitUI.commitReview.note;
  updateGitCommitButton();
}));
$("#git-commit-confirm").addEventListener("click", () => gitRun(async () => {
  if (!gitUI.commitReview) throw new Error("Review the selected files first.");
  if (!$("#git-commit-message").value.trim()) {
    updateGitCommitButton();
    $("#git-commit-message").reportValidity?.();
    throw new Error("Write a short description of what changed before creating a checkpoint.");
  }
  await startGit({ revision: gitUI.commitReview.revision, paths: gitUI.commitReview.paths,
    action: "commit", message: $("#git-commit-message").value, confirm: true });
  $("#git-commit-dialog").close();
  gitUI.commitReview = null;
}));
$("#git-conflict-cancel").addEventListener("click", () => $("#git-conflict-dialog").close());
$("#git-resolve-confirm").addEventListener("click", () => gitRun(async () => {
  await startGit({ ...gitUI.conflict, action: "resolve",
    source: $("#git-conflict-source").value, confirm: true });
  $("#git-conflict-dialog").close();
}));
document.addEventListener("click", event => {
  const link = event.target.closest("a[aria-disabled=true]");
  if (link) {
    event.preventDefault();
    gitNotice("Editing is locked. Choose a working branch, or finish the Git operation first.", true);
  }
});
$("#git-guidance-action").addEventListener("click", () => {
  const target = $("#" + $("#git-guidance-action").dataset.target);
  if (!target || target.disabled) return;
  if (target.tagName === "BUTTON") target.click();
  else {
    if (target.id === "git-rebase-controls" && state.git?.base_branch) {
      $("#git-rebase-target").value = state.git.base_branch;
    }
    if (target.tagName === "DETAILS") target.open = true;
    target.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
});
$("#git-branch-controls").addEventListener("click", () => openGitBranchDialog());
$("#git-new-branch-open").addEventListener("click", () => openGitBranchDialog(true));
$("#git-branch-close").addEventListener("click", () => $("#git-branch-dialog").close());
searchableSelect($("#git-checkout"), "Git branches");
searchableSelect($("#git-rebase-target"), "rebase base branches");
initGitButtonHints();
gitGate();
