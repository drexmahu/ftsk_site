"use strict";

(() => {
  const script = document.currentScript;
  const generation = Number(script?.dataset.generation || 0);
  const maintenance = document.body.hasAttribute("data-runtime-maintenance");
  const originalFetch = window.fetch.bind(window);
  let current = null, downloading = false, draftNotice = "";
  const lockedElements = new Map();
  window.fetch = (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin === location.origin && url.pathname !== "/api/workbench/runtime") {
      const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
      headers.set("X-Workbench-Generation", String(generation));
      options = { ...options, headers };
    }
    return originalFetch(input, options);
  };

  const style = document.createElement("style");
  style.textContent = `
    .runtime-banner{position:fixed;bottom:16px;right:16px;z-index:900;max-width:min(520px,calc(100vw - 32px));padding:14px 18px;border:1px solid #70c0bf;border-radius:12px;background:#142732;color:#edf3f3;font:14px/1.5 system-ui;box-shadow:0 12px 35px #0006}
    .runtime-banner p{margin:0 0 8px}.runtime-version{display:inline-block;margin:6px 10px;color:#9bcac9;font:12px system-ui}
    .runtime-dialog{width:min(580px,calc(100vw - 32px));box-sizing:border-box;border:1px solid #70c0bf;border-radius:16px;background:#142732;color:#edf3f3;padding:26px;font:15px/1.6 system-ui}
    .runtime-dialog::backdrop{background:#081016cf}.runtime-dialog h2{margin-top:0}.runtime-dialog button,.runtime-banner button{margin:6px 8px 0 0;padding:10px 14px;border:1px solid #70c0bf;border-radius:9px;background:#70c0bf;color:#10232d;cursor:pointer;font:600 14px system-ui}
    .runtime-dialog[data-state=failed],.runtime-dialog[data-state=blocked]{border-color:#ed9da7}
    .runtime-dialog button:disabled,.runtime-banner button:disabled{opacity:.5;cursor:not-allowed}.runtime-dialog p{overflow-wrap:anywhere}
    body[data-runtime-maintenance]{margin:0;min-height:100vh;background:#0d1b24;color:#edf3f3;font:16px/1.6 system-ui;padding:30px;box-sizing:border-box}
  `;
  document.head.append(style);
  const make = (tag, text, className = "") => {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  };
  const version = make("span", "", "runtime-version");
  version.setAttribute("role", "status");
  (document.querySelector(".topbar") || document.body).append(version);
  const banner = make("section", "", "runtime-banner");
  banner.hidden = true;
  banner.setAttribute("role", "status");
  const bannerText = make("p", "");
  const restart = make("button", "Restart editor");
  banner.append(bannerText, restart);
  const dialog = make("dialog", "", "runtime-dialog");
  const title = make("h2", "Loading the matching editor");
  title.id = "runtime-heading";
  dialog.setAttribute("aria-labelledby", title.id);
  const detail = make("p", "");
  detail.setAttribute("role", "status");
  const drafts = make("p", "");
  const download = make("button", "Download unsaved drafts");
  const reload = make("button", "I saved my drafts · reload");
  const retry = make("button", "Retry startup");
  dialog.append(title, detail, drafts, download, reload, retry);
  document.body.append(banner, dialog);
  dialog.addEventListener("cancel", event => event.preventDefault());

  function blockers() {
    const detail = { blockers: [], busy: [] };
    window.dispatchEvent(new CustomEvent("workbench-before-git", { detail }));
    if (typeof state !== "undefined") {
      if (state.photos?.length || state.portraits?.length) detail.blockers.push("Remove queued photo uploads before reloading.");
      if (state.busy) detail.busy.push("Wait for the current image operation.");
    }
    return detail;
  }

  function lockWorkspace(locked) {
    for (const selector of [".sidebar", ".workspace", ".skip-link"]) {
      const element = document.querySelector(selector);
      if (element && locked) {
        if (!lockedElements.has(element)) lockedElements.set(element, element.inert);
        element.inert = true;
      }
    }
    if (!locked) {
      for (const [element, previous] of lockedElements) element.inert = previous;
      lockedElements.clear();
    }
  }

  async function requestRestart() {
    const blocked = blockers();
    if (!["failed", "blocked"].includes(current.state) && (blocked.blockers.length || blocked.busy.length)) {
      bannerText.textContent = "Save browser drafts and remove queued uploads before restarting.";
      return;
    }
    const response = await originalFetch("/api/workbench/runtime", {
      method: "POST", headers: { "X-Workbench-Runtime-Token": current.token },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The editor restart was rejected.");
    render(result);
  }

  function render(data) {
    current = data;
    version.textContent = `Editor ${data.version || data.target_version || "starting"}${data.developer ? " · developer mode" : ""}`;
    version.title = data.fingerprint ? `Source ${data.fingerprint.slice(0, 12)}` : "";
    banner.hidden = !["development", "pending", "blocked"].includes(data.state);
    bannerText.textContent = data.message;
    restart.hidden = data.state !== "development";
    const blocked = blockers();
    restart.disabled = Boolean(blocked.blockers.length || blocked.busy.length);
    const changed = data.state === "ready" && data.generation !== generation;
    const waiting = ["starting", "restarting", "failed", "blocked"].includes(data.state);
    if (changed && !blocked.blockers.length && !blocked.busy.length) {
      location.reload();
      return;
    }
    if (!waiting && !changed) {
      if (dialog.open) dialog.close();
      lockWorkspace(false);
      return;
    }
    lockWorkspace(true);
    dialog.dataset.state = data.state;
    dialog.setAttribute("aria-busy", String(["starting", "restarting"].includes(data.state)));
    title.textContent = data.state === "failed" || data.state === "blocked" ? "Editor update needs attention" :
      changed ? "The matching editor is ready" : "Loading the matching editor";
    detail.textContent = changed ? "The checkout now has a different editor. Save a copy of browser-only drafts before reloading. Saved files and Git checkpoints are preserved." : data.message;
    drafts.textContent = draftNotice || [...blocked.blockers, ...blocked.busy].join(" ");
    download.hidden = !blocked.blockers.length;
    download.disabled = downloading || Boolean(blocked.busy.length);
    reload.hidden = !changed;
    reload.disabled = downloading || Boolean(blocked.busy.length);
    retry.hidden = !["failed", "blocked"].includes(data.state);
    if (!dialog.open) dialog.showModal();
  }

  download.addEventListener("click", async () => {
    downloading = true;
    download.disabled = true;
    try {
      const detail = { operations: [] };
      window.dispatchEvent(new CustomEvent("workbench-export-drafts", { detail }));
      if (!detail.operations.length) {
        draftNotice = drafts.textContent = "No downloadable drafts were found. Keep original queued photos safe before reloading.";
        return;
      }
      await Promise.all(detail.operations);
      draftNotice = drafts.textContent = "Draft downloads completed. Check your Downloads folder, then reload when your work is safe.";
    } catch (error) {
      draftNotice = drafts.textContent = `Draft download failed: ${error.message}. Do not reload until you have saved a copy.`;
    } finally {
      downloading = false;
      download.disabled = false;
    }
  });
  reload.addEventListener("click", () => {
    if (blockers().busy.length) return;
    window.dispatchEvent(new Event("workbench-discard-drafts"));
    location.reload();
  });
  for (const button of [restart, retry]) button.addEventListener("click", async () => {
    try { await requestRestart(); }
    catch (error) { detail.textContent = bannerText.textContent = error.message; }
  });
  async function poll() {
    try {
      const response = await originalFetch("/api/workbench/runtime", { cache: "no-store" });
      if (!response.ok) throw new Error(`Runtime status failed (HTTP ${response.status}).`);
      render(await response.json());
    } catch (error) {
      banner.hidden = false;
      restart.hidden = true;
      bannerText.textContent = `Editor launcher disconnected: ${error.message}. Keep drafts safe; reopen site_editor.bat if its window was closed.`;
      if (maintenance) detail.textContent = bannerText.textContent;
    } finally {
      setTimeout(poll, 1000);
    }
  }
  poll();
})();
