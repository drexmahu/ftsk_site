"use strict";

(() => {
  function saveCurrent() {
    const dialogs = [...document.querySelectorAll("dialog[open]")];
    const dialog = document.activeElement?.closest("dialog[open]") || dialogs.at(-1);
    const report = message => {
      // Toasts are hosted inside the open dialog, so one notification serves dialogs and pages alike.
      if (dialog?.id?.startsWith("git-")) gitNotice(message, true);
      else notify(message, "error", { key: "save-shortcut" });
    };
    const focused = document.activeElement?.closest("[data-save-target]");
    const scope = dialog || focused || document.querySelector(`[data-panel="${location.hash.slice(1).split("/")[0] || "overview"}"]`);
    if (!dialog && location.hash === "#hero") {
      const frame = document.querySelector("#hero-frame");
      if (frame?.contentWindow) frame.contentWindow.dispatchEvent(new Event("workbench-save"));
      else report("Open the hero editor before saving.");
      return;
    }
    const id = scope?.dataset.saveTarget;
    if (!id) {
      report("There is no save action in this view. Image conversion, deletion and publication require their explicit review buttons.");
      return;
    }
    const button = document.getElementById(id);
    if (!button || button.disabled || button.hidden || button.closest("[hidden], [inert]") || button.matches(":disabled")) {
      report("Saving is unavailable here. Wait for the current operation or resolve the validation/branch lock before saving.");
      return;
    }
    button.click();
  }
  window.workbenchSave = saveCurrent;
  window.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) saveCurrent();
  }, true);
})();
