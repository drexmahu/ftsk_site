(() => {
  const originalFetch = window.fetch.bind(window);
  const token = originalFetch("/api/workbench/status")
    .then(async response => {
      if (!response.ok) throw new Error("Cannot connect to Site Workbench. Reload the workspace.");
      return (await response.json()).token;
    });
  window.fetch = async (input, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    if (["POST", "PUT", "DELETE"].includes(method)) {
      const headers = new Headers(options.headers);
      headers.set("X-Workbench-Token", await token);
      options = { ...options, headers };
    }
    return originalFetch(input, options);
  };
  window.addEventListener("DOMContentLoaded", () => {
    const notice = document.createElement("p");
    notice.textContent = "Workbench mode: Save updates the real slideshow. Remove takes a photo out of the slideshow but keeps its file for existing posts.";
    notice.style.cssText = "padding:12px 18px;margin:0;background:#16303f;color:#f2ede1;font:14px/1.5 system-ui";
    document.body.prepend(notice);
  });
})();
