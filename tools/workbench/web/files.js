"use strict";

(() => {
  function controls(path) {
    const group = node("span", "", "file-navigation");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `File actions: ${path}`);
    for (const [operation, label, drawing] of [
      ["open", "Open in VS Code", "M8 5 3 12l5 7 4-4 8 6V3l-8 6-4-4Zm4 4v6M3 12l9-3M3 12l9 3"],
      ["reveal", "Reveal in Explorer", "M3 7h7l2 2h9v11H3V7Zm0 0V4h7l2 3M12 12v5m-2-2 2 2 2-2"],
    ]) {
      const button = node("button", "", "file-navigation-button");
      button.type = "button";
      button.title = label;
      button.setAttribute("aria-label", label);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
      shape.setAttribute("d", drawing);
      svg.append(shape);
      button.append(svg);
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        action(async () => {
          button.disabled = true;
          try {
            const relative = path.startsWith("static/") ? decodeURIComponent(path) : path;
            await api("/api/workbench/files/navigate", { method: "POST", payload: { path: relative, action: operation } });
          } finally { button.disabled = false; }
        });
      });
      group.append(button);
    }
    return group;
  }

  const bindings = new Map();
  function refresh() {
    for (const [target, binding] of bindings) if (!target.isConnected) {
      binding.group.remove();
      if (binding.row && !binding.row.children.length) binding.row.remove();
      bindings.delete(target);
    }
    document.querySelectorAll("[data-workbench-file]").forEach(target => {
      const path = target.dataset.workbenchFile;
      const old = bindings.get(target);
      if (old?.row && old.row.hidden !== target.hidden) old.row.hidden = target.hidden;
      if (old?.path === path) return;
      old?.group.remove();
      bindings.delete(target);
      if (!path) return;
      const group = controls(path);
      let row = null;
      if (target.matches("button, a, input, code, label")) {
        if (target.matches("button, label") && !target.parentElement.classList.contains("file-navigation-row")) {
          row = node("div", "", "file-navigation-row");
          target.before(row);
          row.append(target);
        }
        if (target.matches("button, label")) {
          row = target.parentElement;
          row.hidden = target.hidden;
        }
        (target.matches("input") ? target.closest("label") || target : target).after(group);
      } else target.append(group);
      bindings.set(target, { path, group, row });
    });
  }
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; refresh(); });
  }).observe(document.body, { subtree: true, childList: true, attributes: true,
    attributeFilter: ["data-workbench-file", "hidden"] });
  window.workbenchFiles = { controls, refresh };
  refresh();
})();
