"use strict";

(() => {
  let request = 0, nextOffset = null, searching = false;
  const kinds = {page: "Page content", config: "Shared configuration", data: "Shared site data", i18n: "Shared translation", layouts: "Shared template"};
  function status(message, error = false) {
    $("#site-search-status").textContent = message;
    $("#site-search-status").className = error ? "notice error" : "notice";
  }
  function resultCard(file, query) {
    const card = node("article", "", "site-search-result");
    card.dataset.workbenchFile = file.path;
    const heading = node("div", "", "section-heading");
    heading.append(node("h2", file.title), node("span", kinds[file.kind], "badge"));
    card.append(heading, node("code", file.path));
    if (file.error) card.append(node("p", `Needs attention: ${file.error}`, "notice error"));
    if (file.kind !== "page") {
      card.append(node("p", "This text is shared, not owned by one page. A page editor is not available for this file yet; use the file actions below to open its source.", "hint"));
      const tool = {"data/people.yaml": ["People & portraits", "#portraits"], "data/hero_images.yaml": ["Hero slideshow", "#hero"]}[file.path];
      if (tool) { const link = node("a", `Open ${tool[0]}`); link.href = tool[1]; card.append(link); }
    }
    const extra = node("details"), summary = node("summary", `Show ${Math.max(0, file.matches.length - 1)} more match previews`);
    extra.append(summary);
    for (const [index, match] of file.matches.entries()) {
      const row = node("div", "", "site-search-match");
      row.append(node("small", `Line ${match.line}${match.lines > 1 ? `–${match.line + match.lines - 1}` : ""}`),
        node("blockquote", match.excerpt));
      if (file.kind === "page") {
        const open = node("button", "Edit this match", "secondary");
        open.type = "button"; open.disabled = !state.git?.editable;
        open.addEventListener("click", () => action(async () => {
          try { await window.workbenchContent.openMatch(file, match, query); }
          catch (error) { status(`Could not open this match: ${error.message}`, true); throw error; }
        }));
        row.append(open);
      }
      if (index) extra.append(row); else card.append(row);
    }
    if (file.matches.length > 1) card.append(extra);
    if (file.count > file.matches.length) card.append(node("p", `${file.count} matches in this file; showing the first ${file.matches.length}. Open the page/source to review the rest.`, "hint"));
    return card;
  }
  async function search(append = false) {
    const query = $("#site-search-query").value.trim(), scope = $("#site-search-scope").value;
    if (!query) throw new Error("Enter a word, heading or sentence from the site.");
    const sequence = ++request, offset = append ? nextOffset : 0;
    notify("");
    searching = true;
    if (!append) $("#site-search-results").replaceChildren();
    $("#site-search-more").hidden = true;
    $("#site-search-submit").disabled = true;
    $("#site-search-progress").hidden = false;
    status(`Searching saved page text and shared site sources for “${query}”… Your open draft is kept.`);
    try {
      const result = await api(`/api/workbench/content/search?${new URLSearchParams({query, scope, offset})}`);
      if (sequence !== request) return;
      $("#site-search-results").append(...result.files.map(file => resultCard(file, result.query)));
      nextOffset = result.next_offset;
      $("#site-search-more").hidden = nextOffset === null;
      $("#site-search-title").textContent = `Results for “${result.query}”`;
      status(`${result.total_matches} matches in ${result.total_files} files.${!result.total_files ? " Try a shorter phrase or a different scope." : ""}${!state.git?.editable ? " Choose a working branch on Start here before editing a page." : ""}${result.warnings.length ? `\n${result.warnings.join("\n")}` : ""}`, Boolean(result.warnings.length));
      if (!append && result.total_files) $("#site-search-status").scrollIntoView({block: "start"});
    } catch (error) {
      if (sequence !== request) return;
      $("#site-search-more").hidden = !append || nextOffset === null;
      status(`Search failed: ${error.message}. Your draft is safe. Try ${append ? "Load more" : "Search"} again.`, true);
      throw error;
    } finally {
      if (sequence === request) {
        searching = false; $("#site-search-progress").hidden = true; $("#site-search-submit").disabled = false;
      }
    }
  }
  $("#site-search-form").addEventListener("submit", event => { event.preventDefault(); action(() => search()); });
  $("#site-search-more").addEventListener("click", () => { if (!searching && nextOffset !== null) action(() => search(true)); });
  $("#start-site-search-form").addEventListener("submit", event => {
    event.preventDefault();
    $("#site-search-query").value = $("#start-site-search-query").value;
    $("#site-search-scope").value = "all";
    location.hash = "#search";
    action(() => search());
  });
  $("#site-search-form").addEventListener("input", () => {
    ++request; searching = false; nextOffset = null;
    $("#site-search-title").textContent = "Search results";
    $("#site-search-more").hidden = true; $("#site-search-results").replaceChildren();
    $("#site-search-progress").hidden = true; $("#site-search-submit").disabled = false;
    status("Press Search to find this text in saved files. Unsaved browser drafts are not searched.");
  });
  window.addEventListener("workbench-status", () => {
    $("#site-search-results").querySelectorAll("button").forEach(button => {
      if (button.textContent === "Edit this match") button.disabled = !state.git?.editable;
    });
  });
})();
