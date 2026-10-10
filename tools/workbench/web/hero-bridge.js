(() => {
  const originalFetch = window.fetch.bind(window);
  const context = originalFetch("/api/workbench/status")
    .then(async response => {
      if (!response.ok) throw new Error("Cannot connect to Site Workbench. Reload the workspace.");
      const status = await response.json();
      return { token: status.token, branch: status.git?.branch };
    });
  let busy = 0;
  window.fetch = async (input, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    if (["POST", "PUT", "DELETE"].includes(method)) {
      const headers = new Headers(options.headers);
      const initial = await context;
      headers.set("X-Workbench-Token", initial.token);
      if (initial.branch) headers.set("X-Workbench-Branch", initial.branch);
      options = { ...options, headers };
      busy++;
      try { return await originalFetch(input, options); }
      finally { busy--; }
    }
    return originalFetch(input, options);
  };
  function heroDraft() {
    const detail = { source: "" };
    window.dispatchEvent(new CustomEvent("workbench-hero-draft", { detail }));
    return detail.source;
  }
  if (window.parent !== window) {
    const listeners = {
      "workbench-before-git": event => {
        if (heroDraft()) event.detail.blockers.push("Save or download and discard the open hero draft first.");
        if (busy) event.detail.busy.push("Wait for the current hero operation.");
      },
      "workbench-export-drafts": event => {
        const source = heroDraft();
        if (source) event.detail.operations.push(Promise.resolve().then(() =>
          window.parent.downloadWorkbenchDraft("hero-draft.json", source, "application/json;charset=utf-8")));
      },
      "workbench-discard-drafts": () => {
        if (heroDraft()) window.dispatchEvent(new Event("workbench-hero-discard"));
      },
    };
    for (const [type, handler] of Object.entries(listeners)) window.parent.addEventListener(type, handler);
    window.addEventListener("pagehide", () => {
      for (const [type, handler] of Object.entries(listeners)) window.parent.removeEventListener(type, handler);
    });
  }
  window.addEventListener("DOMContentLoaded", () => {
    const notice = document.createElement("p");
    notice.textContent = "Workbench mode: Save updates the real slideshow. Remove takes a photo out of the slideshow but keeps its file for existing posts.";
    notice.style.cssText = "padding:12px 18px;margin:0;background:#16303f;color:#f2ede1;font:14px/1.5 system-ui";
    document.body.prepend(notice);
  });
})();
