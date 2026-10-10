"use strict";

const $ = selector => document.querySelector(selector);
const state = { token: "", git: null, photos: [], portraits: [], activePortrait: null, crop: null, image: null, busy: false, preview: null, initialized: false, jobState: "idle" };
const viewNames = { overview: "Git · Start here", content: "Pages & posts", photos: "Site photos", portraits: "People & portraits", hero: "Hero slideshow", social: "Social previews", checks: "Build & checks", help: "Help & workflow" };

function notify(message, kind = "") {
  const element = $("#message");
  element.textContent = message;
  element.className = `notice ${kind}`;
  element.hidden = !message;
  if ($("#person-editor-dialog")?.open && (kind === "error" || kind === true)) {
    const notice = $("#person-dialog-notice");
    $("#person-dialog-error-text").textContent = message;
    notice.hidden = !message;
  }
  if ($("#member-files-dialog")?.open && (kind === "error" || kind === true)) {
    $("#member-files-error-text").textContent = message;
    $("#member-files-error").hidden = !message;
  }
}

async function api(path, { method = "GET", payload, raw, filename, folder, contentPath } = {}) {
  const headers = {};
  if (method !== "GET") headers["X-Workbench-Token"] = state.token;
  if (method !== "GET" && state.git?.branch) headers["X-Workbench-Branch"] = state.git.branch;
  if (filename) headers["X-Filename"] = encodeURIComponent(filename);
  if (folder !== undefined) headers["X-Folder"] = encodeURIComponent(folder);
  if (contentPath !== undefined) headers["X-Content-Path"] = encodeURIComponent(contentPath);
  if (payload) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { method, headers, body: raw || (payload ? JSON.stringify(payload) : undefined) });
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`Workbench request failed (HTTP ${response.status}). Reload the workspace.`); }
  if (!response.ok) throw new Error(result.error || `Request failed (HTTP ${response.status}).`);
  return result;
}

async function action(operation) {
  try { await operation(); }
  catch (error) { notify(error.message, "error"); }
}

function navigate() {
  let view = location.hash.slice(1) || "overview";
  if (!viewNames[view]) view = "overview";
  if (["content", "photos", "portraits", "hero"].includes(view) && !state.git?.editable) view = "overview";
  document.querySelectorAll("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== view; });
  document.querySelectorAll("[data-view]").forEach(link => {
    const active = link.dataset.view === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $("#breadcrumb").textContent = viewNames[view];
  document.title = `${viewNames[view]} | FTSK Site Workbench`;
  if (view === "hero" && !$("#hero-frame").getAttribute("src")) $("#hero-frame").src = "/hero/hero_focus_picker.html";
  if (view === "social" && !$("#social-frame").getAttribute("src")) renderSocial();
}

function renderSocial() {
  const url = $("#social-url").value.trim();
  $("#social-frame").src = `/social?${new URLSearchParams({ url })}`;
  $("#social-export").href = `/social?${new URLSearchParams({ url, download: "1" })}`;
}

function node(tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}

function downloadWorkbenchDraft(filename, source, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([source], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function currentPortraitOwner() {
  return window.memberEditor?.editing ? window.memberEditor.queueOwner : "standalone";
}

function portraitQueue() {
  return state.portraits.filter(entry => (entry.owner || "standalone") === currentPortraitOwner());
}

function queueView(kind) {
  const entries = kind === "portraits" ? portraitQueue() : state[kind];
  const container = $(`#${kind === "photos" ? "photo" : "portrait"}-queue`);
  container.replaceChildren();
  renderUploadPreviews($(`#${kind === "photos" ? "photo" : "portrait"}-files`), entries.map(entry => ({
    name: entry.name, url: `/api/workbench/uploads/${entry.id}`, selected: state.activePortrait?.id === entry.id,
    choose: kind === "portraits" ? () => action(() => selectPortrait(entry)) : null,
  })), index => action(async () => {
      const entry = entries[index];
      await api(`/api/workbench/uploads/${entry.id}`, { method: "DELETE" });
      state[kind] = state[kind].filter(item => item.id !== entry.id);
      if (state.activePortrait?.id === entry.id) clearCrop();
      queueView(kind);
  }));
}

function setBusy(busy) {
  state.busy = busy;
  $("#convert-photos").disabled = busy;
  $("#convert-portrait").disabled = busy;
  $("#skip-portrait").disabled = busy;
  $("#photo-files").disabled = busy;
  $("#portrait-files").disabled = busy;
  document.querySelectorAll(".upload-previews button").forEach(button => { button.disabled = busy; });
  document.querySelectorAll("#crop-panel input, #reset-crop").forEach(input => { input.disabled = busy; });
  queueView("photos");
  queueView("portraits");
  window.dispatchEvent(new Event("workbench-busy"));
}

async function upload(files, kind) {
  if (state.busy || window.memberEditor?.busy) throw new Error("Wait for the current image operation.");
  if (!files.length) throw new Error("Choose or drop at least one photo.");
  const owner = kind === "portraits" ? currentPortraitOwner() : "";
  setBusy(true);
  const failures = [];
  const progress = conversionProgress(kind === "portraits" ? "portrait-files" : "photo-files", files.length);
  let finished = false;
  try {
    for (const [index, file] of Array.from(files).entries()) {
      progress.update(index, `Uploading ${file.name}…`);
      notify(`Uploading ${index + 1}/${files.length}: ${file.name}`, "busy");
      try {
        const entry = await api("/api/workbench/uploads", { method: "POST", raw: file, filename: file.name });
        if (kind === "portraits") entry.owner = owner;
        state[kind].push(entry);
        sessionStorage.setItem(`workbench-${entry.id}`, kind);
        if (kind === "portraits") sessionStorage.setItem(`workbench-owner-${entry.id}`, owner);
      } catch (error) { failures.push(`${file.name}: ${error.message}`); }
    }
    queueView(kind);
    if (kind === "portraits" && !state.activePortrait && portraitQueue().length) await selectPortrait(portraitQueue()[0]);
    notify(failures.length ? `Some uploads failed:\n${failures.join("\n")}` : "Photos queued. Originals are temporary; conversion writes the final files.", failures.length ? "error" : "");
    progress.finish(`Uploaded ${files.length - failures.length}/${files.length} photos.${failures.length ? " See errors above." : " Choose a photo to convert."}`, failures.length > 0);
    finished = true;
  } finally {
    if (!finished) progress.finish("Upload interrupted. See the error above.", true);
    setBusy(false);
  }
}

function options(prefix) {
  const result = { folder: $(`#${prefix}-folder`).value.trim() };
  for (const key of ["width", "height", "quality"]) {
    const input = $(`#${prefix}-${key}`);
    if (!input.reportValidity()) throw new Error(`Check ${prefix} ${key}.`);
    result[key] = Number(input.value);
  }
  if (!result.folder) throw new Error("Choose an output folder.");
  return result;
}

function showResults(prefix, result) {
  const panel = $(`#${prefix}-results`);
  panel.hidden = false;
  for (const file of result.files) {
    const row = node("div", "", "result-item");
    const image = document.createElement("img");
    image.src = file.url;
    image.alt = "Converted image";
    const text = node("div", "");
    text.dataset.workbenchFile = `static${file.url}`;
    text.append(node("code", file.url), node("small", `${file.width} × ${file.height} · ${(file.bytes / 1024).toFixed(0)} KiB`));
    const copy = node("button", "Copy URL", "secondary");
    copy.addEventListener("click", () => action(async () => {
      await navigator.clipboard.writeText(file.url);
      notify(`Copied ${file.url}`);
    }));
    const open = node("a", "Open ↗");
    open.href = file.url;
    open.target = "_blank";
    open.rel = "noopener";
    row.append(image, text, copy, open);
    panel.querySelector(".results").append(row);
  }
}

function conversionProgress(buttonId, total) {
  const button = document.getElementById(buttonId);
  let panel = document.getElementById(`${buttonId}-progress`);
  if (!panel) {
    panel = node("div", "", "conversion-progress");
    panel.id = `${buttonId}-progress`;
    const label = node("p", "", "hint");
    label.id = `${panel.id}-label`;
    label.setAttribute("role", "status");
    label.setAttribute("aria-live", "polite");
    const bar = document.createElement("progress");
    bar.setAttribute("aria-labelledby", label.id);
    panel.append(label, bar);
    const anchor = button.closest?.(".upload-drop-area, .dropzone, .actions") || button;
    anchor.insertAdjacentElement("afterend", panel);
  }
  const label = panel.querySelector("p");
  const bar = panel.querySelector("progress");
  panel.classList.remove("error");
  panel.hidden = false;
  panel.setAttribute("aria-busy", "true");
  bar.max = total;
  bar.removeAttribute("value");
  const update = (completed, message) => {
    label.textContent = `${completed}/${total} processed · ${message}`;
    if (total > 1) bar.value = completed;
  };
  update(0, "Preparing conversion…");
  return {
    update,
    finish(message, failed = false) {
      panel.setAttribute("aria-busy", "false");
      panel.classList.toggle("error", failed);
      bar.value = failed ? Number(bar.value) : total;
      label.textContent = message;
    },
  };
}

async function convertPhotos() {
  if (state.busy) return;
  if (!state.photos.length) throw new Error("Choose photos to convert first.");
  const settings = options("photo");
  const entries = [...state.photos];
  setBusy(true);
  const failures = [];
  let completed = 0;
  const progress = conversionProgress("convert-photos", entries.length);
  let finished = false;
  try {
    for (const [index, entry] of entries.entries()) {
      progress.update(index, `Converting ${entry.name}…`);
      notify(`Converting ${index + 1}/${entries.length}: ${entry.name}`, "busy");
      try {
        const result = await api("/api/workbench/convert", { method: "POST", payload: { ...settings, id: entry.id } });
        showResults("photo", result);
        completed++;
        state.photos = state.photos.filter(item => item.id !== entry.id);
        await api(`/api/workbench/uploads/${entry.id}`, { method: "DELETE" });
      } catch (error) { failures.push(`${entry.name}: ${error.message}`); }
      progress.update(index + 1, `${completed} converted${failures.length ? ` · ${failures.length} errors` : ""}`);
    }
    notify(`Converted ${completed}/${entries.length} photos.${failures.length ? `\n${failures.join("\n")}` : " Copy the resulting URLs below."}`, failures.length ? "error" : "");
    progress.finish(`Converted ${completed}/${entries.length} photos.${failures.length ? " Some operations failed; see errors above." : " Ready to use."}`, failures.length > 0);
    finished = true;
  } finally {
    if (!finished) progress.finish("Conversion interrupted. See the error message for details.", true);
    setBusy(false);
  }
}

function clearCrop() {
  state.activePortrait = null;
  state.image = null;
  state.crop = null;
  $("#crop-panel").hidden = true;
}

async function selectPortrait(entry) {
  if ((entry.owner || "standalone") !== currentPortraitOwner()) throw new Error("This photo belongs to another editor. Select a photo uploaded for this person.");
  const image = new Image();
  image.src = `/api/workbench/uploads/${entry.id}`;
  await image.decode();
  if ((entry.owner || "standalone") !== currentPortraitOwner()) throw new Error("The person changed while loading this photo. Select a photo for the current editor.");
  state.activePortrait = entry;
  state.image = image;
  state.crop = { x: entry.width / 2, y: entry.height / 2, side: Math.round(Math.min(entry.width, entry.height) * 0.65) };
  $("#crop-size").value = "65";
  $("#crop-name").textContent = entry.name;
  $("#crop-panel").hidden = false;
  drawCrop();
  queueView("portraits");
}

function cropBox() {
  const entry = state.activePortrait;
  const crop = state.crop;
  crop.side = Math.max(1, Math.min(Math.min(entry.width, entry.height), Math.round(crop.side)));
  const radius = crop.side / 2;
  crop.x = Math.max(radius, Math.min(entry.width - radius, crop.x));
  crop.y = Math.max(radius, Math.min(entry.height - radius, crop.y));
  const left = Math.max(0, Math.min(entry.width - crop.side, Math.round(crop.x - radius)));
  const top = Math.max(0, Math.min(entry.height - crop.side, Math.round(crop.y - radius)));
  return [left, top, left + crop.side, top + crop.side];
}

function drawCrop() {
  if (!state.image) return;
  const image = state.image;
  const entry = state.activePortrait;
  const box = cropBox();
  const canvas = $("#crop-canvas");
  const context = canvas.getContext("2d");
  canvas.height = Math.max(280, Math.min(800, Math.round(canvas.width * image.height / image.width)));
  const scale = Math.min(canvas.width / entry.width, canvas.height / entry.height);
  const x = (canvas.width - entry.width * scale) / 2;
  const y = (canvas.height - entry.height * scale) / 2;
  context.fillStyle = "#091219";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, x, y, entry.width * scale, entry.height * scale);
  context.fillStyle = "rgba(0,0,0,.5)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const left = x + box[0] * scale;
  const top = y + box[1] * scale;
  const side = (box[2] - box[0]) * scale;
  context.save();
  context.beginPath();
  context.arc(left + side / 2, top + side / 2, side / 2, 0, 2 * Math.PI);
  context.clip();
  context.drawImage(image, x, y, entry.width * scale, entry.height * scale);
  context.restore();
  context.strokeStyle = "#bea070";
  context.lineWidth = 3;
  context.strokeRect(left, top, side, side);
  context.beginPath();
  context.arc(left + side / 2, top + side / 2, side / 2, 0, 2 * Math.PI);
  context.stroke();
  const avatar = $("#avatar-canvas").getContext("2d");
  avatar.clearRect(0, 0, 180, 180);
  avatar.drawImage(image, box[0] / entry.width * image.width, box[1] / entry.height * image.height,
    (box[2] - box[0]) / entry.width * image.width, (box[3] - box[1]) / entry.height * image.height, 0, 0, 180, 180);
  $("#crop-x").value = (state.crop.x / entry.width * 100).toFixed(1);
  $("#crop-y").value = (state.crop.y / entry.height * 100).toFixed(1);
  $("#crop-size-label").textContent = `${$("#crop-size").value}%`;
}

function moveCrop(event) {
  if (!state.image || state.busy) return;
  const canvas = $("#crop-canvas");
  const rect = canvas.getBoundingClientRect();
  const entry = state.activePortrait;
  const scale = Math.min(canvas.width / entry.width, canvas.height / entry.height);
  state.crop.x = ((event.clientX - rect.left) * canvas.width / rect.width - (canvas.width - entry.width * scale) / 2) / scale;
  state.crop.y = ((event.clientY - rect.top) * canvas.height / rect.height - (canvas.height - entry.height * scale) / 2) / scale;
  drawCrop();
}

async function nextPortrait() {
  clearCrop();
  if (portraitQueue().length) await selectPortrait(portraitQueue()[0]);
  queueView("portraits");
}

async function convertPortrait() {
  if (state.busy) return;
  if (window.memberEditor?.busy) throw new Error("Wait for the member operation to finish.");
  if (!state.activePortrait) throw new Error("Choose a portrait first.");
  if ((state.activePortrait.owner || "standalone") !== currentPortraitOwner()) throw new Error("Select a portrait uploaded for the current person before converting.");
  const thumb = $("#portrait-thumb");
  if (!thumb.reportValidity()) throw new Error("Check thumbnail size.");
  const payload = { ...options("portrait"), thumb: Number(thumb.value), id: state.activePortrait.id, crop: cropBox() };
  if (window.memberEditor?.editing) {
    payload.person = window.memberEditor.portraitPerson;
    payload.folder = `members/${payload.person}`;
    const plan = await api("/api/workbench/members/portrait-upload-plan", { method: "POST", payload: { person: payload.person } });
    if (plan.files.length && !confirm(`Replace the existing portrait files for ${payload.person}?\n\n${plan.files.map(file => file.url).join("\n")}\n\nThis overwrites files immediately, even if you later discard the person draft.`)) return;
    payload.overwrite_files = plan.files;
    payload.confirm_overwrite = plan.files.length > 0;
  }
  setBusy(true);
  const progress = conversionProgress("convert-portrait", 1);
  let finished = false;
  try {
    progress.update(0, "Converting portrait and thumbnail…");
    const result = await api("/api/workbench/portrait", { method: "POST", payload });
    progress.update(0, "Portrait exported; assigning files and cleaning up…");
    showResults("portrait", result);
    window.memberEditor?.exported(result);
    const assigned = window.memberEditor?.editing;
    if (assigned) window.memberEditor.attach(result);
    state.portraits = state.portraits.filter(entry => entry.id !== payload.id);
    await api(`/api/workbench/uploads/${payload.id}`, { method: "DELETE" });
    await nextPortrait();
    notify(assigned ? "Portrait exported and assigned to the open member draft. Save member to persist the assignments." :
      "Portrait exported. Select a member and use the existing portrait pair, or copy the URLs below.");
    progress.finish("Portrait and thumbnail converted. Ready to use.");
    finished = true;
  } finally {
    if (!finished) progress.finish("Portrait operation failed. Check the error and any exported files below.", true);
    setBusy(false);
  }
}

function updateStatus(status) {
  state.token = status.token;
  if (window.updateGitState) window.updateGitState(status.git);
  if (!state.initialized) {
    for (const entry of status.uploads) {
      const stored = sessionStorage.getItem(`workbench-${entry.id}`);
      if (stored === "cv") continue;
      const kind = stored === "portraits" ? "portraits" : "photos";
      if (kind === "portraits") entry.owner = sessionStorage.getItem(`workbench-owner-${entry.id}`) || "standalone";
      state[kind].push(entry);
    }
    state.initialized = true;
    setBusy(false);
    if (portraitQueue().length) action(() => selectPortrait(portraitQueue()[0]));
  }
  state.preview = status.preview;
  const preview = status.preview;
  const label = preview.responsive ? (preview.owned ? "Preview running" : "Existing preview") : preview.state === "starting" ? "Starting preview" : "Preview offline";
  $("#preview-state").textContent = label;
  $("#preview-state").className = `badge ${preview.responsive ? "running" : ""}`;
  $("#open-site").href = preview.url;
  document.querySelectorAll('[data-action="stop-preview"]').forEach(button => { button.disabled = !preview.owned; });
  document.querySelectorAll('[data-action="start-preview"]').forEach(button => { button.disabled = preview.owned || status.job.state === "running"; });
  $("#preview-log").textContent = preview.log || "No owned server log.";
  const job = status.job;
  if (state.jobState === "running" && ["passed", "failed"].includes(job.state)) {
    notify(`${job.action}: ${job.state}. See Build & checks for the complete log.`, job.state === "failed" ? "error" : "");
  }
  state.jobState = job.state;
  $("#job-state").textContent = job.state === "idle" ? "Idle" : `${job.action}: ${job.state}`;
  $("#job-state").className = `badge ${job.state}`;
  $("#job-log").textContent = job.log || "Choose a check above. One job runs at a time.";
  document.querySelectorAll("[data-job]").forEach(button => { button.disabled = job.state === "running"; });
  window.dispatchEvent(new CustomEvent("workbench-status", { detail: status }));
}

async function poll() {
  try {
    updateStatus(await api("/api/workbench/status"));
    if ($("#message").dataset.disconnected) { notify(""); delete $("#message").dataset.disconnected; }
  } catch (error) {
    if (window.updateGitState) window.updateGitState(null);
    notify(`Workspace disconnected: ${error.message}`, "error");
    $("#message").dataset.disconnected = "true";
  } finally { setTimeout(poll, 2000); }
}

function setupFileDrop(id, receive) {
  const input = $(id);
  const accept = files => action(async () => {
    if (input.disabled || state.busy || window.memberEditor?.busy) throw new Error("Wait for the current image operation before selecting another photo.");
    await receive(files);
  });
  input.addEventListener("change", () => accept(input.files));
  renderUploadPreviews(input);
  const dropzone = input.closest(".upload-drop-area");
  dropzone.addEventListener("dragover", event => { event.preventDefault(); dropzone.classList.add("dragging"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
  dropzone.addEventListener("drop", event => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("dragging");
    return accept(event.dataTransfer.files);
  });
}

function setupUploads(id, kind) {
  setupFileDrop(id, async files => {
    await upload(files, kind);
    $(id).value = "";
  });
}

window.addEventListener("hashchange", navigate);
$("#social-form").addEventListener("submit", event => { event.preventDefault(); renderSocial(); });
$("#social-url").addEventListener("input", () => { $("#social-export").href = `/social?${new URLSearchParams({ url: $("#social-url").value.trim(), download: "1" })}`; });
$("#reload-hero").addEventListener("click", () => {
  if (confirm("Reload the hero editor? Unsaved changes in the editor will be discarded.")) $("#hero-frame").src = "/hero/hero_focus_picker.html";
});
$("#convert-photos").addEventListener("click", () => action(convertPhotos));
$("#convert-portrait").addEventListener("click", () => action(convertPortrait));
$("#skip-portrait").addEventListener("click", () => action(async () => {
  if (!state.activePortrait || state.busy) return;
  const identifier = state.activePortrait.id;
  await api(`/api/workbench/uploads/${identifier}`, { method: "DELETE" });
  state.portraits = state.portraits.filter(entry => entry.id !== identifier);
  await nextPortrait();
  notify("Portrait skipped. No output files were written.");
}));
$("#crop-size").addEventListener("input", () => {
  if (!state.crop) return;
  state.crop.side = Math.round(Math.min(state.activePortrait.width, state.activePortrait.height) * Number($("#crop-size").value) / 100);
  drawCrop();
});
for (const axis of ["x", "y"]) $(`#crop-${axis}`).addEventListener("change", () => {
  if (!state.crop) return;
  const input = $(`#crop-${axis}`);
  if (!input.reportValidity()) return;
  state.crop[axis] = Number(input.value) / 100 * state.activePortrait[axis === "x" ? "width" : "height"];
  drawCrop();
});
$("#reset-crop").addEventListener("click", () => action(() => selectPortrait(state.activePortrait)));
$("#crop-canvas").addEventListener("pointerdown", event => {
  if (state.busy) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.focus();
  moveCrop(event);
});
$("#crop-canvas").addEventListener("pointermove", event => { if (event.buttons === 1) moveCrop(event); });
$("#crop-canvas").addEventListener("keydown", event => {
  if (!state.crop || state.busy) return;
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (!directions[event.key]) return;
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  state.crop.x += directions[event.key][0] * step;
  state.crop.y += directions[event.key][1] * step;
  drawCrop();
});
document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => action(async () => {
  const starting = button.dataset.action === "start-preview";
  await api(`/api/workbench/preview/${starting ? "start" : "stop"}`, { method: "POST" });
  updateStatus(await api("/api/workbench/status"));
  if (!starting) notify("Owned preview stopped. External servers were left alone.");
})));
document.querySelectorAll("[data-job]").forEach(button => button.addEventListener("click", () => action(async () => {
  await api("/api/workbench/jobs", { method: "POST", payload: { action: button.dataset.job } });
  updateStatus(await api("/api/workbench/status"));
  notify("Check started. Watch the activity log for the result.");
})));
setupUploads("#photo-files", "photos");
setupUploads("#portrait-files", "portraits");
navigate();
setBusy(true);
poll();
