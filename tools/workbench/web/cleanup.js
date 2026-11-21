"use strict";

const cleanupUI = { scan: null, selected: new Set(), busy: false, job: null, error: "", progress: null, disconnected: false };

function cleanupRenderProgress(progress) {
  if (!["idle", "running", "passed", "failed", "disconnected"].includes(progress.state)) {
    throw new Error("Cleanup returned invalid progress data. Refresh the editor and try again.");
  }
  const panel = $("#cleanup-progress");
  panel.hidden = progress.state === "idle";
  if (panel.hidden) return;
  const failed = ["failed", "disconnected"].includes(progress.state);
  panel.className = `panel conversion-progress cleanup-progress${failed ? " error" : ""}`;
  const title = `${progress.state === "disconnected" ? "Live progress disconnected" : failed ? "Discovery stopped" : progress.state === "passed" ? "Discovery complete" : "Discovering unused files"} · Step ${progress.step} of ${progress.steps}: ${progress.label}`;
  if ($("#cleanup-progress-title").textContent !== title) $("#cleanup-progress-title").textContent = title;
  $("#cleanup-progress-message").textContent = progress.error || progress.explanation;
  const overall = $("#cleanup-progress-overall");
  overall.max = progress.steps;
  overall.value = progress.state === "passed" ? progress.steps : progress.step - 1;
  const bar = $("#cleanup-progress-current");
  if (progress.total !== null && progress.total > 0) {
    bar.max = progress.total;
    bar.value = progress.completed;
  } else if (progress.state === "running") {
    bar.removeAttribute("value");
  } else {
    bar.max = 1;
    bar.value = 0;
  }
  $("#cleanup-progress-counts").textContent = `${progress.total !== null ? `${progress.completed}/${progress.total} files checked · ` : ""}${progress.state === "running" ? `${progress.elapsed_seconds}s in this stage` : progress.state === "passed" ? "Nothing was deleted. Review the candidates below." : progress.state === "disconnected" ? "Review is paused until reconnection; discovery may still be running." : "No candidates are approved by this interrupted discovery."}`;
  $("#cleanup-progress-path").textContent = progress.current;
  $("#cleanup-progress-path").hidden = !progress.current;
}

function cleanupBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function cleanupVisible() {
  const query = $("#cleanup-search").value.trim().toLocaleLowerCase();
  const kind = $("#cleanup-kind").value;
  return (cleanupUI.scan?.files || []).filter(file =>
    (file.media || $("#cleanup-advanced").checked) &&
    (kind === "all" || file.kind === kind) && file.path.toLocaleLowerCase().includes(query));
}

function cleanupBlocker() {
  if (cleanupUI.disconnected) return "Wait for live progress to reconnect before reviewing files.";
  if (cleanupUI.busy || state.git?.busy || state.jobState === "running") return "Wait for the current operation.";
  if (!state.git?.editable) return "Choose an editable working branch in Save & sync before deleting.";
  if (!cleanupUI.scan || cleanupUI.scan.branch !== state.git.branch || cleanupUI.scan.head !== state.git.head) return "The checkout changed. Run discovery again.";
  const drafts = gitDraftBlockers();
  if (state.busy || drafts.length) return drafts.join(" ") || "Wait for the current image operation.";
  return "";
}

function cleanupButtons() {
  const running = cleanupUI.busy || cleanupUI.disconnected || state.git?.busy || state.jobState === "running" ||
    cleanupUI.job?.state === "running";
  $("#cleanup-scan").disabled = Boolean(running || !state.token || !state.git?.available);
  $("#cleanup-select").disabled = Boolean(running || !cleanupVisible().some(file => !file.protected));
  $("#cleanup-clear").disabled = Boolean(cleanupUI.busy || !cleanupUI.selected.size);
  const blocker = cleanupBlocker();
  $("#cleanup-review").disabled = Boolean(blocker || !cleanupUI.selected.size);
  $("#cleanup-review").title = blocker;
  $("#cleanup-confirm").disabled = Boolean(blocker || !cleanupUI.selected.size);
  $("#cleanup-cancel").disabled = cleanupUI.busy;
  const selected = (cleanupUI.scan?.files || []).filter(file => cleanupUI.selected.has(file.path));
  $("#cleanup-selected").textContent = selected.length ?
    `${selected.length} selected · ${cleanupBytes(selected.reduce((sum, file) => sum + file.bytes, 0))}` : "No files selected";
}

function cleanupRenderFiles() {
  const rows = cleanupVisible();
  const container = $("#cleanup-files");
  container.replaceChildren();
  if (!rows.length) container.append(node("p", cleanupUI.scan ?
    "No candidates match these filters. Referenced files remain protected." : "Run discovery to find candidates.", "hint"));
  for (const file of rows) {
    const row = node("div", "", `cleanup-row${file.protected ? " protected" : ""}`);
    const label = node("label", "");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = cleanupUI.selected.has(file.path);
    checkbox.disabled = Boolean(file.protected || cleanupUI.busy);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) cleanupUI.selected.add(file.path);
      else cleanupUI.selected.delete(file.path);
      cleanupButtons();
    });
    label.append(checkbox);
    if (file.kind === "image") {
      const image = document.createElement("img");
      image.src = file.url; image.alt = ""; image.loading = "lazy";
      label.append(image);
    }
    const text = node("span", "");
    text.append(node("code", file.path), node("small", `${cleanupBytes(file.bytes)} · ${file.protected || "No internal references found"}`));
    label.append(text); row.append(label);
    if (["image", "pdf"].includes(file.kind)) {
      const link = node("a", "Inspect file ↗");
      link.href = file.url; link.target = "_blank"; link.rel = "noopener";
      row.append(link);
    } else if (window.workbenchFiles) {
      row.append(window.workbenchFiles.controls(file.path.split("/").map(encodeURIComponent).join("/")));
    }
    container.append(row);
  }
  $("#cleanup-advanced-note").hidden = !$("#cleanup-advanced").checked;
  cleanupButtons();
}

async function cleanupRefresh() {
  const progress = await api("/api/workbench/cleanup/progress");
  cleanupUI.progress = progress;
  cleanupRenderProgress(progress);
  $("#cleanup-log").textContent = progress.log || "No cleanup scan yet.";
  if (progress.state === "running") {
    cleanupUI.disconnected = false;
    cleanupUI.job = { state: "running", action: "cleanup-scan" };
    $("#cleanup-notice").className = `notice${cleanupUI.error ? " error" : ""}`;
    $("#cleanup-notice").textContent = cleanupUI.error || "Discovery is running. Follow the stages below; nothing is being deleted.";
    cleanupButtons();
    $("#cleanup-summary").textContent = "Discovery is in progress. Candidates are only approved after the final checkout verification.";
    return;
  }
  const data = await api("/api/workbench/cleanup");
  cleanupUI.disconnected = false;
  cleanupUI.job = data.job;
  const changed = data.scan?.id !== cleanupUI.scan?.id;
  cleanupUI.scan = data.scan;
  if (changed) { cleanupUI.selected.clear(); cleanupRenderFiles(); }
  const job = data.job.action === "cleanup-scan" ? data.job : null;
  $("#cleanup-log").textContent = job?.log || "No cleanup scan yet.";
  $("#cleanup-notice").className = `notice${cleanupUI.error || job?.state === "failed" ? " error" : ""}`;
  $("#cleanup-notice").textContent = cleanupUI.error || (job?.state === "running" ? "Discovering references and building the site. Nothing is being deleted." :
    job?.state === "failed" ? "Discovery failed. No candidates are approved for deletion. Read the build details and try again." :
    data.scan ? "Discovery complete. Review candidates carefully; files with uncommitted changes stay protected." : "Run discovery to begin. Nothing is deleted automatically.");
  $("#cleanup-summary").textContent = data.scan ?
    `${data.scan.checked} static files checked · ${data.scan.used} referenced · ${data.scan.files.length} candidates before filters · branch ${data.scan.branch}` :
    "No current scan. Content pages, application source and build/cache folders are never deletion targets.";
  cleanupButtons();
}

async function cleanupOperation(operation) {
  if (cleanupUI.busy) return;
  cleanupUI.busy = true; cleanupUI.error = ""; cleanupButtons();
  try { await operation(); }
  catch (error) {
    const notice = $("#cleanup-dialog").open ? $("#cleanup-dialog-notice") : $("#cleanup-notice");
    if (!$("#cleanup-dialog").open) cleanupUI.error = cleanupUI.job?.action === "cleanup-scan" && cleanupUI.job.state === "running" ? "" : error.message;
    if (!$("#cleanup-dialog").open && cleanupUI.progress?.state === "running") {
      cleanupUI.disconnected = true;
      cleanupRenderProgress({ ...cleanupUI.progress, state: "disconnected", error: error.message });
    }
    notice.textContent = error.message; notice.className = "notice error"; notice.hidden = false;
  } finally { cleanupUI.busy = false; cleanupButtons(); }
}

$("#cleanup-scan").addEventListener("click", () => cleanupOperation(async () => {
  cleanupUI.progress = { state: "running", step: 1, steps: 5, label: "Preparing discovery",
    explanation: "Starting a safe scan of saved files. Nothing is deleted.", completed: 0,
    total: null, current: "", elapsed_seconds: 0 };
  cleanupRenderProgress(cleanupUI.progress);
  cleanupUI.job = await api("/api/workbench/jobs", { method: "POST", payload: { action: "cleanup-scan" } });
  cleanupUI.scan = null; cleanupUI.selected.clear(); cleanupRenderFiles();
  await cleanupRefresh();
}));
for (const id of ["cleanup-search", "cleanup-kind", "cleanup-advanced"]) {
  $("#" + id).addEventListener(id === "cleanup-search" ? "input" : "change", () => {
    if (!$("#cleanup-advanced").checked) for (const file of cleanupUI.scan?.files || []) {
      if (!file.media) cleanupUI.selected.delete(file.path);
    }
    $("#cleanup-kind option[value=all]").textContent = $("#cleanup-advanced").checked ? "All static file types" : "All media & downloads";
    $("#cleanup-kind option[value=file]").textContent = $("#cleanup-advanced").checked ? "Other files" : "Other downloads";
    cleanupRenderFiles();
  });
}
$("#cleanup-select").addEventListener("click", () => {
  for (const file of cleanupVisible()) if (!file.protected) cleanupUI.selected.add(file.path);
  cleanupRenderFiles();
});
$("#cleanup-clear").addEventListener("click", () => { cleanupUI.selected.clear(); cleanupRenderFiles(); });
$("#cleanup-review").addEventListener("click", () => {
  const blocker = cleanupBlocker();
  if (blocker) { notify(blocker, "error"); return; }
  if (!cleanupUI.selected.size) return;
  $("#cleanup-dialog-notice").hidden = true;
  const list = $("#cleanup-dialog-files"); list.replaceChildren();
  for (const file of cleanupUI.scan.files) if (cleanupUI.selected.has(file.path)) list.append(node("li", file.path));
  $("#cleanup-dialog-summary").textContent = `${$("#cleanup-selected").textContent}. These exact files will be removed.`;
  $("#cleanup-dialog").showModal();
});
$("#cleanup-cancel").addEventListener("click", () => $("#cleanup-dialog").close());
$("#cleanup-dialog").addEventListener("cancel", event => { if (cleanupUI.busy) event.preventDefault(); });
$("#cleanup-confirm").addEventListener("click", () => {
  const blocker = cleanupBlocker();
  if (blocker) { $("#cleanup-dialog-notice").textContent = blocker; $("#cleanup-dialog-notice").hidden = false; return; }
  cleanupOperation(async () => {
    $("#cleanup-delete-progress").hidden = false;
    let result;
    try {
      result = await api("/api/workbench/cleanup/delete", { method: "POST", payload: {
        scan: cleanupUI.scan.id, paths: [...cleanupUI.selected],
        advanced: $("#cleanup-advanced").checked, confirm: true,
      } });
    } finally {
      $("#cleanup-delete-progress").hidden = true;
    }
    $("#cleanup-dialog").close(); cleanupUI.scan = null; cleanupUI.selected.clear();
    cleanupRenderFiles();
    notify(`Deleted ${result.deleted.length} file(s) · ${cleanupBytes(result.bytes)}. Review the deletions in Save & sync and create a checkpoint. Nothing was published.`);
    await refreshGit();
    await cleanupRefresh();
  });
});
window.addEventListener("workbench-busy", cleanupButtons);
async function cleanupPoll() {
  if (location.hash === "#cleanup" && state.token && !cleanupUI.busy) {
    try { await cleanupRefresh(); }
    catch (error) {
      cleanupUI.disconnected = true;
      $("#cleanup-notice").textContent = error.message; $("#cleanup-notice").className = "notice error";
      if (cleanupUI.progress && cleanupUI.progress.state !== "idle") {
        cleanupRenderProgress({ ...cleanupUI.progress, state: "disconnected",
          error: `Live progress is unavailable: ${error.message}. The last reported stage is preserved; wait for reconnection before reviewing files.` });
      }
      cleanupButtons();
    }
  }
  setTimeout(cleanupPoll, cleanupUI.progress?.state === "running" ? 1000 : 2000);
}
cleanupPoll();
