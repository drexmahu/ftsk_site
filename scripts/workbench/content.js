"use strict";

(() => {
  const studio = {
    catalog: null, page: null, original: "", revision: "", savedSource: "", savedPath: "",
    changes: {}, tab: "write", helpOrigin: "", dirty: false, busy: false, selection: [0, 0],
    assets: [], selected: new Map(), deletePlan: null, previewSource: "", previewPath: "",
    previewURL: "", previewID: "", initialized: false, lastJob: "idle", restoreKey: ""
  };
  const rootAPI = "/api/workbench/content/";
  const feedback = (message, error = false) => {
    const element = $("#content-feedback");
    element.hidden = !message;
    element.textContent = message;
    element.className = `notice ${error ? "error" : ""}`;
  };
  const run = operation => action(async () => {
    try { await operation(); }
    catch (error) { feedback(error.message, true); throw error; }
  });
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalized = value => value.replaceAll("\r\n", "\n");
  const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
  const currentMeta = () => ({ ...studio.page.metadata, ...studio.changes });
  const suggestedFolder = path => path.replace(/(?:\/index)?\.md$/, "").replace(/\/_index$/, "") || "gallery";
  const activePath = () => $("#post-path").value.trim();

  function setBusy(value) {
    studio.busy = value;
    $("#content-editor").inert = value;
    $(".content-library").inert = value;
    for (const selector of ["#save-page", "#validate-page", "#delete-page", "#new-page", "#new-page-toolbar", "#new-page-empty", "#reload-page", "#confirm-delete-page"]) {
      $(selector).disabled = value;
    }
    $("#delete-page").disabled = value || !studio.original;
  }

  function setLibraryCollapsed(collapsed, persist = false) {
    $("#content-library").hidden = collapsed;
    $(".content-shell").classList.toggle("library-collapsed", collapsed);
    $("#toggle-content-library").textContent = collapsed ? "Show page library" : "Hide page library";
    $("#toggle-content-library").setAttribute("aria-expanded", String(!collapsed));
    $("#new-page-toolbar").hidden = !collapsed;
    if (persist) {
      try { localStorage.setItem("ftsk-content-library-collapsed", String(collapsed)); }
      catch (error) { feedback(`Library preference could not be stored: ${error.message}`, true); }
    }
  }

  function persistDraft() {
    if (!studio.page) return;
    try {
      localStorage.setItem("ftsk-content-draft", JSON.stringify({
        page: studio.page, original: studio.original, revision: studio.revision,
        savedSource: studio.savedSource, savedPath: studio.savedPath,
        changes: studio.changes, body: $("#post-body").value, path: activePath(),
        folder: $("#post-image-folder").value, dirty: studio.dirty,
        editingSource: studio.tab === "source" || (studio.tab === "syntax" && studio.helpOrigin === "source")
      }));
    } catch (error) {
      feedback(`Browser draft backup could not be stored: ${error.message}. Download the Markdown draft before closing.`, true);
    }
  }

  function markDirty() {
    if (!studio.page) return;
    studio.dirty = studio.page.source !== studio.savedSource ||
      $("#post-body").value !== normalized(studio.page.body) ||
      activePath() !== studio.savedPath || Object.keys(studio.changes).length > 0 || !studio.original;
    $("#editor-state").textContent = studio.dirty ? "Unsaved draft" : "Saved";
    $("#editor-state").className = `badge ${studio.dirty ? "unsaved" : "passed"}`;
    $("#editing-title").textContent = currentMeta().title || "Untitled";
    $("#editing-path").textContent = activePath();
    $("#word-count").textContent = `${$("#post-body").value.trim().split(/\s+/).filter(Boolean).length} words`;
    if (studio.previewURL) $("#content-preview-state").textContent =
      studio.previewSource === bodySource() && studio.previewPath === activePath() && !Object.keys(studio.changes).length ?
        "Preview matches the current editor source." : "Preview is from an earlier draft. Render again to see current changes.";
    persistDraft();
  }

  function change(path, value) {
    const [root, ...nested] = path.split(".");
    if (nested.length) {
      const result = clone(currentMeta()[root] || {});
      let pointer = result;
      for (const key of nested.slice(0, -1)) {
        pointer[key] = pointer[key] || {};
        pointer = pointer[key];
      }
      pointer[nested[nested.length - 1]] = value;
      studio.changes[root] = result;
    } else studio.changes[root] = value;
    if (JSON.stringify(studio.page.metadata[root]) === JSON.stringify(studio.changes[root])) delete studio.changes[root];
    markDirty();
    updateSocialNote();
  }

  const definitions = {
    "metadata-fields": [
      ["title", "Page title", "text"], ["date", "Date (ISO date or date-time)", "text", "2026-08-14T00:00:00Z"],
      ["draft", "Draft — excluded from normal production builds", "boolean"],
      ["article_image_width", "Default body photo width (%)", "number", "100"],
      ["publishDate", "Publication date (optional)", "text"], ["expiryDate", "Expiry date (optional)", "text"]
    ],
    "people-fields": [
      ["author", "Author", "text"], ["participants", "Participants — one per line", "list"],
      ["categories", "Categories — one per line", "list"]
    ],
    "page-image-fields": [
      ["thumbImg.image_path", "Card thumbnail URL", "image"], ["featuredImg.image_path", "Page banner URL", "image"]
    ],
    "seo-fields": [
      ["seo.page_description", "Search / sharing description", "textarea"],
      ["seo.canonical_url", "Canonical URL override (optional)", "text"],
      ["seo.featured_image", "Social-card photo override (optional)", "image"],
      ["seo.open_graph_type", "Open Graph type", "text", "article"],
      ["seo.author_twitter_handle", "Author X/Twitter handle (optional)", "text", "@name"],
      ["seo.no_index", "No index — ask search engines not to index", "boolean"]
    ],
    "placement-fields": [
      ["slug", "Slug override (optional)", "text"], ["url", "Public URL override (optional)", "text"],
      ["aliases", "Old public URLs — one per line", "list"]
    ],
    "course-fields": [["current", "Current course — hides previous-course related cards", "boolean"]]
  };

  function field(definition, meta, onChange, prefix = "") {
    const [path, title, type, placeholder] = definition;
    const wrapper = node("label", title);
    const input = document.createElement(["list", "textarea"].includes(type) ? "textarea" : "input");
    input.dataset.field = path;
    input.id = `field-${prefix}${path.replaceAll(".", "-")}`;
    if (type === "boolean") {
      input.type = "checkbox";
      input.checked = Boolean(get(meta, path));
      wrapper.classList.add("check-label");
      wrapper.replaceChildren(input, node("span", title));
    } else {
      if (type === "number") { input.type = "number"; input.min = "10"; input.max = "100"; }
      if (["list", "textarea"].includes(type)) input.rows = type === "list" ? 5 : 3;
      input.value = type === "list" ? (get(meta, path) || []).join("\n") : (get(meta, path) ?? "");
      if (placeholder) input.placeholder = placeholder;
      if (path === "author") input.setAttribute("list", "member-names");
      wrapper.append(input);
    }
    input.addEventListener("input", () => {
      const value = type === "boolean" ? input.checked : type === "list" ?
        input.value.split("\n").map(line => line.trim()).filter(Boolean) :
        type === "number" ? (input.value ? Number(input.value) : null) : input.value;
      onChange(path, value);
    });
    if (type === "image") {
      const choose = node("button", "Choose / convert photo…", "secondary small-button");
      choose.type = "button";
      choose.addEventListener("click", () => run(async () => {
        await showTab("media");
        feedback(`Select a photo below, then choose "${path === "seo.featured_image" ? "Social override" : path.startsWith("thumb") ? "Card thumbnail" : "Page banner"}".`);
      }, `${key}-${index}-`));
      wrapper.append(choose);
    }
    return wrapper;
  }

  const repeaters = {
    milestones: { label: "Course milestones", course: true, fields: [["label", "Phase label"], ["date", "Date (YYYY-MM-DD)"], ["estimated", "Estimated date", "boolean"]] },
    contacts: { label: "Course contacts", course: true, fields: [["name", "Name"], ["role", "Role"], ["email", "Email"], ["phone", "Phone"]] },
    flyer_images: { label: "Course flyers", course: true, fields: [["image_path", "Local flyer image URL", "image"]] },
    faq: { label: "Frequently asked questions", fields: [["question", "Question"], ["answer", "Answer (Markdown)", "textarea"]] }
  };

  function addRepeater(key) {
    const config = repeaters[key];
    const existing = currentMeta()[key] || [];
    if (!Array.isArray(existing)) throw new Error(`Invalid ${key} data. Fix it in Full source before adding an entry.`);
    const defaults = Object.fromEntries(config.fields.map(([name, , type]) => [name, type === "boolean" ? false : ""]));
    change(key, [...existing, defaults]);
    renderRepeaters();
    $(`#field-${key}-${existing.length}-${config.fields[0][0]}`).focus();
  }

  function renderRepeaters() {
    const container = $("#repeaters");
    container.replaceChildren();
    const course = activePath().startsWith("tanfolyamok/");
    for (const [key, config] of Object.entries(repeaters)) {
      if (config.course && !course) continue;
      const section = node("section", "", "repeater");
      const header = node("div", "", "section-heading");
      const add = node("button", "+ Add", "secondary");
      header.append(node("h3", config.label), add);
      section.append(header);
      const list = currentMeta()[key] || [];
      if (!Array.isArray(list)) {
        section.append(node("p", `Invalid ${key} data. Fix it in Full source.`, "notice error"));
        container.append(section);
        continue;
      }
      add.addEventListener("click", () => run(async () => addRepeater(key)));
      list.forEach((entry, index) => {
        const row = node("div", "", "repeater-row");
        const fields = node("div", "", "form-grid");
        for (const [name, label, type = "text"] of config.fields) {
          fields.append(field([name, label, type], entry, (path, value) => {
            const updated = clone(currentMeta()[key]);
            updated[index][path] = value;
            change(key, updated);
          }, `${key}-${index}-`));
        }
        const controls = node("div", "", "actions");
        for (const [text, direction] of [["↑", -1], ["↓", 1], ["Remove", 0]]) {
          const button = node("button", text, "secondary");
          button.setAttribute("aria-label", `${text === "Remove" ? "Remove" : direction < 0 ? "Move up" : "Move down"} ${key} entry ${index + 1}`);
          button.disabled = direction !== 0 && (index + direction < 0 || index + direction >= list.length);
          button.addEventListener("click", () => {
            const updated = clone(currentMeta()[key]);
            if (!direction) updated.splice(index, 1);
            else [updated[index], updated[index + direction]] = [updated[index + direction], updated[index]];
            change(key, updated);
            renderRepeaters();
          });
          controls.append(button);
        }
        row.append(fields, controls);
        section.append(row);
      });
      if (!list.length) section.append(node("p", "No entries. This section will not appear on the page.", "hint"));
      container.append(section);
    }
  }

  function renderForms() {
    const meta = currentMeta();
    for (const [container, fields] of Object.entries(definitions)) {
      $( "#" + container).replaceChildren(...fields.map(definition => field(definition, meta, change)));
    }
    const suggestions = node("div", "", "folder-chips");
    for (const category of studio.catalog?.categories || []) {
      const button = node("button", `+ ${category}`, "secondary");
      button.type = "button";
      button.addEventListener("click", () => {
        change("categories", [...new Set([...(currentMeta().categories || []), category])]);
        renderForms();
      });
      suggestions.append(button);
    }
    $("#people-fields").append(suggestions);
    const course = activePath().startsWith("tanfolyamok/");
    $("#course-fields").hidden = !course;
    $("#course-note").hidden = !course;
    renderRepeaters();
    updateSocialNote();
  }

  function updateSocialNote() {
    if (!studio.page) return;
    const meta = currentMeta();
    $("#social-source-note").textContent = `Social photo: ${meta.seo?.featured_image ||
      (studio.page.guided ? meta.featuredImg?.image_path : "") ||
      "a suitable landscape hero photo, selected by Hugo at build time"}.`;
  }

  async function refreshCatalog() {
    studio.catalog = await api(rootAPI + "catalog");
    $("#image-folders").replaceChildren(...studio.catalog.folders.map(folder => {
      const option = document.createElement("option"); option.value = folder; return option;
    }));
    $("#member-names").replaceChildren(...studio.catalog.members.map(name => {
      const option = document.createElement("option"); option.value = name; return option;
    }));
    $("#new-page-template").replaceChildren(...studio.catalog.templates.map(template => {
      const option = node("option", template.name); option.value = template.id; return option;
    }));
    renderLibrary();
  }

  function renderLibrary() {
    if (!studio.catalog) return;
    const search = $("#content-search").value.trim().toLocaleLowerCase();
    const type = $("#content-filter").value;
    const status = $("#content-status-filter").value;
    const sort = $("#content-sort").value;
    let pages = studio.catalog.pages.filter(page =>
      `${page.title} ${page.path} ${page.date}`.toLocaleLowerCase().includes(search) &&
      (!type || (type === "other" ? !["turak", "tanfolyamok"].includes(page.section) : page.section === type)) &&
      (!status || (status === "draft" ? page.draft : !page.draft)));
    pages.sort((a, b) => sort === "date" ? String(b.date).localeCompare(String(a.date)) :
      String(a[sort]).localeCompare(String(b[sort]), "hu"));
    $("#content-count").textContent = `${pages.length} / ${studio.catalog.pages.length} pages. “Not draft” may still be future/expired.`;
    $("#content-list").replaceChildren();
    for (const page of pages) {
      const button = node("button", "", "content-list-item");
      button.classList.toggle("selected", page.path === studio.original);
      button.append(node("strong", page.title), node("code", page.path),
        node("small", `${String(page.date).slice(0, 10)} · ${page.draft ? "Draft" : "Not draft"}${page.current ? " · Current course" : ""}${page.error ? " · Source error" : ""}`));
      button.addEventListener("click", () => run(() => openPage(page.path)));
      $("#content-list").append(button);
    }
  }

  function allowDiscard() {
    return !studio.dirty || confirm("Discard the current unsaved page draft? Download it or save first if you want to keep it.");
  }

  async function openPage(path) {
    if (studio.busy || !allowDiscard()) return;
    setBusy(true);
    try { loadPage(await api(`${rootAPI}page?${new URLSearchParams({ path })}`), true); }
    finally { setBusy(false); }
  }

  function loadPage(page, saved) {
    studio.page = page;
    studio.original = saved ? page.path : "";
    studio.revision = saved ? page.revision : "";
    studio.savedSource = saved ? page.source : "";
    studio.savedPath = saved ? page.path : "";
    studio.changes = {};
    studio.selected.clear();
    studio.previewURL = "";
    studio.previewSource = "";
    studio.previewPath = "";
    studio.previewID = "";
    $("#content-preview-frame").hidden = true;
    $("#content-social-frame").hidden = true;
    $("#preview-external").hidden = true;
    $("#content-preview-state").textContent = "Render an unsaved preview to see the actual site.";
    $("#content-empty").hidden = true;
    $("#content-editor").hidden = false;
    $("#post-path").value = page.path;
    $("#post-body").value = page.body;
    $("#post-source").value = page.source;
    $("#post-image-folder").value = suggestedFolder(page.path);
    $("#content-image-folder").value = $("#post-image-folder").value;
    $("#pdf-folder").value = suggestedFolder(page.path);
    $("#asset-folder").value = $("#post-image-folder").value;
    studio.selection = [0, 0];
    $("#body-warning").textContent = page.guided ? "The title, author and participant cards come from frontmatter; do not repeat them in the story." :
      "This is a source-mode page. Component-driven pages may render content_blocks rather than the Markdown body; edit the complete YAML in Full source.";
    for (const tab of ["metadata", "course", "seo"]) {
      $(`[data-editor-tab="${tab}"]`).disabled = !page.guided || Boolean(page.error);
    }
    document.querySelectorAll("[data-add-faq]").forEach(button => { button.disabled = !page.guided || Boolean(page.error); });
    $(`[data-editor-tab="write"]`).disabled = Boolean(page.error);
    if (!page.error) renderForms();
    setBusy(false);
    switchPanel(page.guided && !page.error ? "write" : "source");
    feedback(page.error || (page.warnings || []).join("\n"), Boolean(page.error));
    markDirty();
    renderLibrary();
  }

  function bodySource() {
    if (!studio.page) return "";
    const source = studio.page.source;
    if (studio.tab === "source") {
      const raw = $("#post-source").value;
      return raw === normalized(source) ? source : raw.replaceAll("\n", studio.page.newline || "\n");
    }
    if ($("#post-body").value === normalized(studio.page.body)) return source;
    const match = source.match(/^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m);
    return match ? source.slice(0, match[0].length) + $("#post-body").value.replaceAll("\n", studio.page.newline || "\n") : source;
  }

  async function sync() {
    if (!studio.page) throw new Error("Open a page first.");
    if (studio.busy) throw new Error("Wait for the current editor operation to finish.");
    setBusy(true);
    try {
      const composed = await api(rootAPI + "compose", { method: "POST", payload: {
        source: bodySource(), changes: studio.changes
      } });
      studio.page = { ...studio.page, ...composed, path: activePath(), guided: ["turak", "tanfolyamok"].includes(activePath().split("/")[0]) && !activePath().endsWith("_index.md"), error: "" };
      studio.changes = {};
      $("#post-body").value = composed.body;
      $("#post-source").value = composed.source;
      markDirty();
      return { path: activePath(), original: studio.original, revision: studio.revision, source: composed.source };
    } finally { setBusy(false); }
  }

  function switchPanel(tab) {
    studio.tab = tab;
    document.querySelectorAll("[data-editor-panel]").forEach(panel => { panel.hidden = panel.dataset.editorPanel !== tab; });
    document.querySelectorAll("[data-editor-tab]").forEach(button => {
      const active = button.dataset.editorTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (tab === "source") $("#post-source").value = studio.page.source;
  }

  async function showTab(tab) {
    if (!studio.page || studio.busy) return;
    if (tab === "syntax") {
      if (studio.tab !== "syntax") studio.helpOrigin = studio.tab;
      switchPanel(tab);
      return;
    }
    if (tab === "source" && studio.tab === "syntax" && studio.helpOrigin === "source") {
      switchPanel(tab);
      return;
    }
    await sync();
    renderForms();
    switchPanel(tab);
    if (tab === "media") await browseAssets();
  }

  async function validatePage() {
    const payload = await sync();
    const result = await api(rootAPI + "validate", { method: "POST", payload });
    feedback(["Metadata validated. Render preview to validate Hugo templates and shortcodes.", ...result.warnings].join("\n"));
  }

  async function savePage() {
    if (studio.busy) return;
    const payload = await sync();
    if (payload.original && payload.original !== payload.path &&
        !confirm(`Move ${payload.original} to ${payload.path}? Existing assets and incoming links will NOT be moved or rewritten.`)) return;
    setBusy(true);
    try {
      const previous = {
        tab: studio.tab, folder: $("#post-image-folder").value,
        assetFolder: $("#asset-folder").value, pdfFolder: $("#pdf-folder").value,
        selected: new Map(studio.selected),
        socialShown: !$("#content-social-frame").hidden,
        previewSource: studio.previewSource, previewPath: studio.previewPath, previewURL: studio.previewURL,
        previewID: studio.previewID,
        selection: [...studio.selection]
      };
      const result = await api(rootAPI + "save", { method: "POST", payload });
      loadPage(result, true);
      switchPanel(previous.tab);
      $("#post-image-folder").value = previous.folder;
      $("#content-image-folder").value = previous.folder;
      $("#asset-folder").value = previous.assetFolder;
      $("#pdf-folder").value = previous.pdfFolder;
      studio.selected = previous.selected;
      studio.selection = previous.selection;
      $("#post-body").setSelectionRange(...previous.selection);
      if (previous.previewSource === result.source && previous.previewPath === result.path) {
        studio.previewSource = previous.previewSource;
        studio.previewPath = previous.previewPath;
        studio.previewURL = previous.previewURL;
        studio.previewID = previous.previewID;
        $("#content-preview-frame").hidden = !previous.previewURL;
        $("#preview-external").hidden = !previous.previewURL;
        $("#content-social-frame").hidden = !previous.socialShown;
      }
      markDirty();
      feedback([`Saved ${result.path}.`, ...(result.warnings || [])].join("\n"));
      await refreshCatalog();
    } finally { setBusy(false); }
  }

  async function renderPreview() {
    if (studio.busy) return;
    const payload = await sync();
    setBusy(true);
    try {
      const job = await api(rootAPI + "preview", { method: "POST", payload });
      studio.previewID = job.preview_id;
    }
    finally { setBusy(false); }
    studio.previewSource = payload.source;
    studio.previewPath = payload.path;
    studio.previewURL = "";
    $("#content-preview-frame").hidden = true;
    $("#content-social-frame").hidden = true;
    $("#preview-external").hidden = true;
    $("#content-preview-state").textContent = "Building an isolated snapshot. The page has not been saved.";
    switchPanel("preview");
    feedback("Rendering the actual Hugo page. Your unsaved Markdown stays out of the checkout.");
  }

  function previewStatus(status) {
    const preview = status.contentPreview;
    if (!preview || !studio.page) return;
    const running = status.job.state === "running";
    $("#preview-page").disabled = running;
    $("#preview-page-again").disabled = running;
    $("#content-preview-log").textContent = status.job.action === "content-preview" ? status.job.log || "Preparing Hugo…" : $("#content-preview-log").textContent;
    if (preview.id !== studio.previewID || preview.path !== studio.previewPath || !studio.previewSource) return;
    if (preview.state === "failed") {
      $("#content-preview-state").textContent = `Preview failed: ${preview.error}. Fix the source and render again.`;
      $("#content-preview-frame").hidden = true;
      $("#content-social-frame").hidden = true;
      $("#preview-external").hidden = true;
      studio.previewURL = "";
      return;
    }
    if (preview.state === "ready" && studio.previewURL !== preview.url) {
      studio.previewURL = preview.url;
      // Only the separate read-only render origin gets a non-opaque iframe.
      $("#content-preview-frame").sandbox.add("allow-same-origin");
      $("#content-preview-frame").src = preview.url;
      $("#content-preview-frame").hidden = false;
      $("#preview-external").href = preview.url;
      $("#preview-external").hidden = false;
      markDirty();
    }
  }

  async function showNewPage() {
    if (studio.busy || !allowDiscard()) return;
    if (!studio.catalog) await refreshCatalog();
    $("#new-page-dialog").showModal();
    $("#new-page-slug").focus();
  }

  function selectTemplate() {
    const template = studio.catalog.templates.find(item => item.id === $("#new-page-template").value);
    $("#new-page-folder").value = template.section;
    $("#new-page-bundle").checked = false;
    $("#new-page-bundle").disabled = template.id === "pdf";
    if (template.id === "pdf" && !$("#new-page-slug").value.startsWith("legacy-")) $("#new-page-slug").value = "legacy-";
    if (template.id.startsWith("course") && !$("#new-page-slug").value) $("#new-page-slug").value = "tanfolyam-";
  }

  async function createPage(event) {
    event.preventDefault();
    const slug = $("#new-page-slug").value.trim();
    const folder = $("#new-page-folder").value.trim().replace(/\/$/, "");
    const path = (folder ? folder + "/" : "") + slug + ($("#new-page-bundle").checked ? "/index.md" : ".md");
    const page = await api(rootAPI + "template", { method: "POST", payload: { path, template: $("#new-page-template").value } });
    if (studio.catalog.pages.some(item => item.path === path)) throw new Error("That page already exists. Open it or choose a different path.");
    $("#new-page-dialog").close();
    loadPage(page, false);
    feedback("New draft loaded from the site template. Replace placeholders; nothing has been written yet.");
  }

  async function browseAssets() {
    const folder = $("#asset-folder").value.trim().replace(/\/$/, "");
    const result = await api(`/api/workbench/assets?${new URLSearchParams({ folder })}`);
    studio.assets = result.files;
    $("#asset-folders").replaceChildren(...result.folders.map(name => {
      const button = node("button", name.split("/").pop(), "secondary");
      button.addEventListener("click", () => run(async () => { $("#asset-folder").value = name; await browseAssets(); }));
      return button;
    }));
    renderAssets();
  }

  function renderAssets() {
    const search = $("#asset-search").value.toLocaleLowerCase();
    const files = studio.assets.filter(file => file.name.toLocaleLowerCase().includes(search));
    $("#asset-grid").replaceChildren();
    for (const file of files) {
      const card = node("label", "", "asset-card");
      const check = document.createElement("input");
      check.type = "checkbox"; check.checked = studio.selected.has(file.url);
      const image = document.createElement("img");
      image.src = file.url; image.alt = file.name; image.loading = "lazy";
      const name = node("span", file.name);
      card.append(check, image, name, node("small", `${Math.round(file.bytes / 1024)} KiB`));
      check.addEventListener("change", () => {
        if (check.checked) studio.selected.set(file.url, { ...file, alt: "", caption: "" });
        else studio.selected.delete(file.url);
        renderSelection();
      });
      $("#asset-grid").append(card);
    }
    $("#asset-count").textContent = `${files.length} images · ${studio.selected.size} selected across folders`;
    renderSelection();
  }

  function renderSelection() {
    const container = $("#selected-photo-details");
    container.replaceChildren();
    const selected = [...studio.selected.values()];
    selected.forEach((entry, index) => {
      const row = node("div", "", "selected-asset");
      const image = document.createElement("img"); image.src = entry.url; image.alt = entry.name;
      const details = node("div", "");
      details.append(node("code", `${index + 1}. ${entry.url}`));
      const alt = node("label", "Alt text for this photo");
      const altInput = document.createElement("input"); altInput.value = entry.alt;
      altInput.addEventListener("input", () => { entry.alt = altInput.value; });
      alt.append(altInput);
      const caption = node("label", "Caption");
      const captionInput = document.createElement("input"); captionInput.value = entry.caption;
      captionInput.addEventListener("input", () => { entry.caption = captionInput.value; });
      caption.append(captionInput);
      details.append(alt, caption);
      const controls = node("div", "", "actions");
      for (const [label, path] of [["Card thumbnail", "thumbImg.image_path"], ["Page banner", "featuredImg.image_path"], ["Social override", "seo.featured_image"]]) {
        const button = node("button", label, "secondary");
        button.disabled = !studio.page.guided;
        button.addEventListener("click", () => {
          change(path, entry.url);
          renderForms();
          feedback(`${label} set to ${entry.url}. Save page to persist frontmatter.`);
        });
        controls.append(button);
      }
      for (const [label, direction] of [["↑", -1], ["↓", 1], ["Deselect", 0]]) {
        const button = node("button", label, "secondary");
        button.setAttribute("aria-label", `${label} ${entry.name}`);
        button.disabled = direction !== 0 && (index + direction < 0 || index + direction >= selected.length);
        button.addEventListener("click", () => {
          if (!direction) studio.selected.delete(entry.url);
          else {
            const ordered = [...studio.selected.entries()];
            [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
            studio.selected = new Map(ordered);
          }
          renderAssets();
        });
        controls.append(button);
      }
      details.append(controls);
      row.append(image, details);
      container.append(row);
    });
  }

  function rememberCursor() { studio.selection = [$("#post-body").selectionStart, $("#post-body").selectionEnd]; }
  function insertText(text) {
    const area = $("#post-body");
    const [start, end] = studio.selection;
    area.setRangeText(text, start, end, "end");
    studio.selection = [area.selectionStart, area.selectionEnd];
    switchPanel("write");
    area.focus();
    markDirty();
  }

  const shortcodeEscape = value => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\r", "").replaceAll("\n", " ");
  const attr = (key, value) => `${key}="${shortcodeEscape(value)}"`;

  function insertPhotos() {
    const selected = [...studio.selected.values()];
    if (!selected.length) throw new Error("Select photos from the library first.");
    const layout = $("#insert-layout").value;
    if (layout !== "gallery" && selected.length !== 1) throw new Error("Select exactly one photo for this layout, or choose Gallery.");
    const alt = $("#insert-alt").value.trim();
    const caption = $("#insert-caption").value.trim();
    const width = Number($("#insert-width").value);
    const mobile = Number($("#insert-mobile-width").value);
    const font = Number($("#insert-font").value);
    for (const selector of ["#insert-width", "#insert-mobile-width", "#insert-font"]) {
      if (!$(selector).reportValidity()) throw new Error("Check layout dimensions.");
    }
    if (layout === "media" && (width > 90 || $("#insert-side").value === "center")) {
      throw new Error("Media needs left/right placement and an image width from 10 to 90%.");
    }
    const snippets = selected.map(entry => {
      const description = entry.alt.trim() || (selected.length === 1 ? alt : "");
      const label = entry.caption.trim() || (selected.length === 1 ? caption : "");
      if (!description) throw new Error(`Add an alt description for ${entry.name}. Each gallery photo needs its own description.`);
      const attributes = [attr("src", entry.url), attr("alt", description), ...(label ? [attr("caption", label)] : [])];
      if (layout === "markdown") {
        if (/[\[\]\n]/.test(description)) throw new Error("For Markdown image alt text, omit square brackets or use the image shortcode.");
        return `![${description}](${entry.url}${label ? ` "${shortcodeEscape(label)}"` : ""})`;
      }
      if (layout === "gallery") return `{{< photo ${attributes.join(" ")} >}}`;
      if (layout === "media") return `{{< media ${[...attributes, attr("image-side", $("#insert-side").value), attr("image-width", width), attr("mobile-width", mobile), attr("font-size", font)].join(" ")} >}}\n\nWrite the story beside this photo.\n\n{{< /media >}}`;
      return `{{< image ${[...attributes, attr("width", width), attr("mobile-width", mobile), attr("align", $("#insert-side").value)].join(" ")} >}}`;
    });
    const snippet = layout === "gallery" ? `{{< gallery >}}\n${snippets.join("\n")}\n{{< /gallery >}}` : snippets[0];
    $("#shortcode-output").textContent = snippet;
    $("#shortcode-output").hidden = false;
    insertText(`\n\n${snippet}\n\n`);
    feedback("Image layout inserted at the remembered Markdown cursor position. Render the draft to verify placement.");
  }

  async function convertImages() {
    const input = $("#content-image-files");
    const files = [...input.files];
    if (!files.length) throw new Error("Choose original photos first.");
    for (const file of files) {
      if (!file.size || file.size > 30 * 1024 * 1024) throw new Error(`${file.name}: choose a non-empty image up to 30 MiB.`);
    }
    const folder = $("#content-image-folder").value.trim();
    const name = $("#content-image-name").value.trim();
    if (name && files.length !== 1) throw new Error("Custom output name is for a single photo. Leave it blank for a batch.");
    const settings = { folder, name };
    for (const key of ["width", "height", "quality"]) {
      const field = $(`#content-image-${key}`);
      if (!field.reportValidity()) throw new Error(`Check image ${key}.`);
      settings[key] = Number(field.value);
    }
    const failures = [];
    setBusy(true);
    $("#content-convert").disabled = true;
    const results = [];
    try {
      for (const [index, file] of files.entries()) {
        let entry;
        let converted = false;
        $("#content-conversion-results").textContent = `Converting ${index + 1}/${files.length}: ${file.name}`;
        try {
          entry = await api("/api/workbench/uploads", { method: "POST", raw: file, filename: file.name });
          const result = await api("/api/workbench/convert", { method: "POST", payload: { ...settings, id: entry.id } });
          for (const image of result.files) {
            const item = { ...image, name: image.url.split("/").pop(), alt: "", caption: "" };
            studio.selected.set(image.url, item);
            results.push(image.url);
          }
          converted = true;
        } catch (error) { failures.push(`${file.name}: ${error.message}`); }
        finally {
          if (entry) {
            try { await api(`/api/workbench/uploads/${entry.id}`, { method: "DELETE" }); }
            catch (error) { failures.push(`${file.name}: ${converted ? "Export succeeded, but temporary original cleanup failed" : "Temporary original cleanup failed"}: ${error.message}`); }
          }
        }
      }
      $("#post-image-folder").value = folder;
      $("#asset-folder").value = folder;
      await browseAssets();
      $("#content-conversion-results").textContent = [`${results.length} converted files:`, ...results, ...failures].join("\n");
      feedback(failures.length ? failures.join("\n") : "Photos converted into your chosen folder and selected. Set image metadata or insert them into the story.", failures.length > 0);
      input.value = "";
      persistDraft();
    } finally { $("#content-convert").disabled = false; setBusy(false); }
  }

  async function deletionDialog() {
    if (!studio.original || studio.busy) return;
    if (studio.dirty && !confirm("Delete the saved page? The current unsaved draft will also be discarded after deletion.")) return;
    studio.deletePlan = await api(rootAPI + "delete-plan", { method: "POST", payload: { path: studio.original, revision: studio.revision } });
    $("#delete-page-path").textContent = `Markdown to delete: content/${studio.original}`;
    $("#delete-assets").replaceChildren();
    for (const asset of studio.deletePlan.assets) {
      const label = node("label", "", "delete-asset");
      const check = document.createElement("input"); check.type = "checkbox"; check.value = asset.url;
      check.disabled = asset.missing || asset.references.length > 0;
      const details = node("div", "");
      details.append(node("code", asset.url));
      details.append(node("small", asset.missing ? asset.error :
        asset.references.length ? `Protected: referenced by ${asset.references.join(", ")}` : `${Math.round(asset.bytes / 1024)} KiB · optional deletion (unchecked)`));
      label.append(check, details);
      $("#delete-assets").append(label);
    }
    if (!studio.deletePlan.assets.length) $("#delete-assets").append(node("p", "No linked local images/PDFs found."));
    $("#delete-incoming").textContent = studio.deletePlan.incoming.length ?
      `Incoming references to review: ${studio.deletePlan.incoming.join(", ")}` : "Review navigation and incoming links after deletion; run the link check.";
    $("#delete-confirm").value = "";
    $("#delete-page-dialog").showModal();
  }

  async function deletePage() {
    const assets = [...$("#delete-assets").querySelectorAll("input:checked")].map(input => {
      const asset = studio.deletePlan.assets.find(item => item.url === input.value);
      return { url: asset.url, revision: asset.revision };
    });
    const result = await api(rootAPI + "delete", { method: "POST", payload: {
      path: studio.original, revision: studio.revision, confirm: $("#delete-confirm").value, assets
    } });
    $("#delete-page-dialog").close();
    studio.page = null; studio.dirty = false;
    localStorage.removeItem("ftsk-content-draft");
    $("#content-editor").hidden = true; $("#content-empty").hidden = false;
    await refreshCatalog();
    notify(`${result.message}\nDeleted ${result.deleted}${assets.length ? ` and ${assets.length} selected assets` : "; all assets kept"}.`);
  }

  function syntaxHelp() {
    const examples = [
      ["Headings, emphasis, lists & links", "## Section title\n\n**Bold** and *italic*.\n\n- First item\n- Second item\n\n[Another report](/turak/report/)\n\n> A quotation."],
      ["Ordered list & horizontal rule", "1. First step\n2. Second step\n\n---\n\nNext section."],
      ["Markdown table", "| Day | Location |\n| --- | --- |\n| 1 | Cave entrance |\n| 2 | Survey area |"],
      ["Fenced code block", "```text\nA literal example, without Markdown formatting.\n```"],
      ["Simple Markdown image", '![Describe the photo](/images/turak/slug/photo.webp "Optional caption")'],
      ["Standalone photo · width 10–100, mobile-width 10–100", '{{< image src="/images/turak/slug/photo.webp" alt="Describe the photo" caption="Optional caption" width="60" mobile-width="100" align="center" >}}'],
      ["Text beside photo · width 10–90, side left/right, font 0.8–1.5", '{{< media src="/images/turak/slug/photo.webp" alt="Describe the photo" image-side="right" image-width="40" font-size="1" >}}\n## An experience\n\nYour **Markdown** story here.\n{{< /media >}}'],
      ["Gallery · each photo needs its own alt", '{{< gallery >}}\n{{< photo src="/images/turak/slug/01.webp" alt="First photo" caption="Caption" >}}\n{{< photo src="/images/turak/slug/02.webp" alt="Second photo" >}}\n{{< /gallery >}}'],
      ["Archived PDF", '{{< pdf src="/pdfs/turak/legacy-slug.pdf" title="Full report" >}}'],
      ["Frontmatter lists & FAQ", 'participants:\n  - Real Name\nfaq:\n  - question: "A real question?"\n    answer: |-\n      Answer with **Markdown**.\nseo:\n  featured_image: /images/turak/slug/share.webp\n  no_index: false']
    ];
    for (const container of ["#syntax-examples", "#syntax-dialog-examples"]) {
      $(container).replaceChildren(...examples.map(([title, code]) => {
        const group = node("section", "", "syntax-example");
        group.dataset.syntaxSearch = `${title}\n${code}`.toLocaleLowerCase();
        const controls = node("div", "", "actions");
        const copy = node("button", "Copy syntax", "secondary");
        copy.setAttribute("aria-label", `Copy ${title}`);
        const message = node("span", "", "hint");
        message.setAttribute("role", "status");
        copy.addEventListener("click", () => run(async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
            await navigator.clipboard.writeText(code);
            message.textContent = "Copied. Paste into the appropriate Markdown or YAML field.";
          } catch (error) {
            message.textContent = `Copy failed: ${error.message} Select the example and press Ctrl+C instead.`;
            throw new Error(message.textContent);
          }
        }));
        controls.append(copy, message);
        group.append(node("h3", title), controls, node("pre", code));
        return group;
      }));
    }
    filterSyntax();
  }

  function filterSyntax() {
    const query = $("#syntax-search").value.trim().toLocaleLowerCase();
    const examples = [...$("#syntax-dialog-examples").children];
    examples.forEach(example => { example.hidden = !example.dataset.syntaxSearch.includes(query); });
    $("#syntax-result-count").textContent = `${examples.filter(example => !example.hidden).length} / ${examples.length} examples`;
  }

  async function openLayout(layout) {
    if (!studio.page || studio.busy) throw new Error("Open a page and wait for the current editor operation first.");
    if ($("#syntax-help-dialog").open) $("#syntax-help-dialog").close();
    await showTab("media");
    if (layout === "pdf") {
      $("#pdf-file").closest("details").open = true;
      $("#insert-pdf-url").focus();
    } else {
      $("#insert-layout").value = layout;
      if (layout === "media" && $("#insert-side").value === "center") $("#insert-side").value = "right";
      $("#asset-folder").focus();
    }
    feedback("Choose or convert photos in your preferred folder, then insert at the remembered Markdown cursor. Gallery order follows the selected photos.");
  }

  async function initialize() {
    if (studio.initialized) return;
    studio.initialized = true;
    try { setLibraryCollapsed(localStorage.getItem("ftsk-content-library-collapsed") === "true"); }
    catch (error) { feedback(`Library preference could not be read: ${error.message}`, true); }
    try { await refreshCatalog(); }
    catch (error) { studio.initialized = false; throw error; }
    let draft;
    try { draft = JSON.parse(localStorage.getItem("ftsk-content-draft") || "null"); }
    catch (error) { feedback(`Stored browser draft cannot be read: ${error.message}`, true); return; }
    if (draft?.dirty && confirm(`Restore the browser's unsaved draft for ${draft.path}? Disk revisions will still be checked before saving.`)) {
      loadPage(draft.page, Boolean(draft.original));
      studio.original = draft.original; studio.revision = draft.revision;
      studio.savedSource = draft.savedSource; studio.savedPath = draft.savedPath;
      studio.changes = draft.changes; $("#post-body").value = draft.body; $("#post-path").value = draft.path;
      $("#post-image-folder").value = draft.folder; $("#content-image-folder").value = draft.folder;
      if (draft.editingSource) switchPanel("source");
      renderForms(); markDirty();
      feedback("Browser draft restored. It has not overwritten any disk file.");
    }
  }

  $("#post-body").addEventListener("input", markDirty);
  $("#post-body").addEventListener("select", rememberCursor);
  $("#post-body").addEventListener("keyup", rememberCursor);
  $("#post-body").addEventListener("click", rememberCursor);
  $("#post-body").addEventListener("blur", rememberCursor);
  $("#post-source").addEventListener("input", () => {
    studio.page.source = $("#post-source").value.replaceAll("\n", studio.page.newline || "\n");
    markDirty();
  });
  $("#post-path").addEventListener("input", markDirty);
  $("#post-image-folder").addEventListener("input", () => { $("#content-image-folder").value = $("#post-image-folder").value; persistDraft(); });
  document.querySelectorAll("[data-editor-tab]").forEach(button => button.addEventListener("click", () => run(() => showTab(button.dataset.editorTab))));
  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  for (const selector of ["#content-search", "#content-filter", "#content-sort", "#content-status-filter"]) $(selector).addEventListener("input", renderLibrary);
  $("#refresh-content").addEventListener("click", () => run(refreshCatalog));
  $("#new-page").addEventListener("click", () => run(showNewPage));
  $("#new-page-toolbar").addEventListener("click", () => run(showNewPage));
  $("#toggle-content-library").addEventListener("click", () => setLibraryCollapsed(!$("#content-library").hidden, true));
  $("#new-page-empty").addEventListener("click", () => run(showNewPage));
  $("#new-page-template").addEventListener("change", selectTemplate);
  $("#new-page-form").addEventListener("submit", event => run(() => createPage(event)));
  $("#validate-page").addEventListener("click", () => run(validatePage));
  $("#save-page").addEventListener("click", () => run(savePage));
  for (const id of ["#preview-page", "#preview-page-again"]) $(id).addEventListener("click", () => run(renderPreview));
  $("#delete-page").addEventListener("click", () => run(deletionDialog));
  $("#confirm-delete-page").addEventListener("click", () => run(deletePage));
  document.querySelectorAll("[data-open-syntax]").forEach(button => button.addEventListener("click", () => {
    $("#syntax-help-dialog").querySelectorAll("[data-insert-layout], [data-add-faq]").forEach(control => {
      control.disabled = !studio.page || studio.busy || Boolean(studio.page.error) ||
        (control.hasAttribute("data-add-faq") && !studio.page.guided);
    });
    $("#syntax-help-dialog").showModal();
    $("#syntax-search").focus();
  }));
  $("#syntax-search").addEventListener("input", filterSyntax);
  document.querySelectorAll("[data-insert-layout]").forEach(button => button.addEventListener("click", () => run(() => openLayout(button.dataset.insertLayout))));
  document.querySelectorAll("[data-add-faq]").forEach(button => button.addEventListener("click", () => run(async () => {
    if (!studio.page?.guided || studio.busy) throw new Error("FAQ controls require an open trip/course page and an idle editor.");
    if ($("#syntax-help-dialog").open) $("#syntax-help-dialog").close();
    await showTab("course");
    addRepeater("faq");
    feedback("Fill the new FAQ question and Markdown answer. FAQ cards come from frontmatter and appear in the page's FAQ section, not at the story cursor.");
  })));
  $("#suggest-image-folder").addEventListener("click", () => {
    $("#post-image-folder").value = suggestedFolder(activePath());
    $("#content-image-folder").value = $("#post-image-folder").value;
    persistDraft();
  });
  $("#use-page-folder").addEventListener("click", () => run(async () => {
    $("#asset-folder").value = $("#post-image-folder").value; await browseAssets();
  }));
  $("#browse-assets").addEventListener("click", () => run(browseAssets));
  $("#asset-search").addEventListener("input", renderAssets);
  $("#asset-parent").addEventListener("click", () => run(async () => {
    $("#asset-folder").value = $("#asset-folder").value.split("/").slice(0, -1).join("/"); await browseAssets();
  }));
  $("#content-convert").addEventListener("click", () => run(convertImages));
  const dropzone = $("#content-image-files").closest(".dropzone");
  dropzone.addEventListener("dragover", event => { event.preventDefault(); dropzone.classList.add("dragging"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
  dropzone.addEventListener("drop", event => {
    event.preventDefault(); dropzone.classList.remove("dragging");
    $("#content-image-files").files = event.dataTransfer.files;
    feedback(`${event.dataTransfer.files.length} original photos chosen. Review the destination, then click Convert.`);
  });
  $("#insert-photos").addEventListener("click", () => run(async () => insertPhotos()));
  $("#insert-pdf").addEventListener("click", () => run(async () => {
    const url = $("#insert-pdf-url").value.trim();
    if (!url.startsWith("/pdfs/")) throw new Error("Use a local /pdfs/... URL.");
    insertText(`\n\n{{< pdf ${attr("src", url)} ${attr("title", $("#insert-pdf-title").value || "Full report")} >}}\n\n`);
  }));
  $("#upload-pdf").addEventListener("click", () => run(async () => {
    const file = $("#pdf-file").files[0];
    if (!file) throw new Error("Choose a PDF first.");
    if (!file.size || file.size > 30 * 1024 * 1024) throw new Error("Choose a non-empty PDF up to 30 MiB.");
    const response = await fetch(rootAPI + "pdf", { method: "POST", headers: {
      "X-Workbench-Token": state.token, "X-Filename": encodeURIComponent(file.name),
      "X-Folder": encodeURIComponent($("#pdf-folder").value.trim())
    }, body: file });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    $("#insert-pdf-url").value = result.url;
    feedback(`Uploaded ${result.url}. Use Insert PDF to add the shortcode.`);
  }));
  $("#content-preview-width").addEventListener("change", () => { $("#content-preview-frame").style.width = $("#content-preview-width").value; });
  $("#preview-social").addEventListener("click", () => {
    if (!studio.previewURL) { feedback("Render a successful page preview first.", true); return; }
    $("#content-social-frame").src = `/social?${new URLSearchParams({ url: studio.previewURL })}`;
    $("#content-social-frame").hidden = false;
  });
  $("#download-source").addEventListener("click", () => run(async () => {
    // Raw download remains available even while YAML is invalid.
    const source = studio.tab === "source" ? $("#post-source").value : (await sync()).source;
    const url = URL.createObjectURL(new Blob([source], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = activePath().split("/").pop();
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  $("#reload-page").addEventListener("click", () => run(async () => {
    if (!studio.original) throw new Error("This new page has not been saved yet.");
    if (!allowDiscard()) return;
    loadPage(await api(`${rootAPI}page?${new URLSearchParams({ path: studio.original })}`), true);
  }));
  document.querySelectorAll("[data-markdown]").forEach(button => button.addEventListener("click", () => {
    const area = $("#post-body"); const text = area.value.slice(...studio.selection) || "text";
    const snippets = { heading: `\n## ${text}\n`, bold: `**${text}**`, italic: `*${text}*`,
      link: `[${text}](/turak/)`, list: `\n- ${text}\n- Next item\n`, quote: `\n> ${text}\n`,
      day: "\n## N. nap - YYYY-MM-DD (weekday)\n\n" };
    insertText(snippets[button.dataset.markdown]);
  }));
  document.querySelectorAll("[data-content-guide]").forEach(button => button.addEventListener("click", () => run(async () => {
    const guide = await api(`${rootAPI}help?${new URLSearchParams({ document: button.dataset.contentGuide })}`);
    $("#content-guide").textContent = guide.source; $("#content-guide").hidden = false;
  })));
  window.addEventListener("beforeunload", event => {
    if (!studio.dirty) return;
    persistDraft(); event.preventDefault(); event.returnValue = "";
  });
  window.addEventListener("keydown", event => {
    if (location.hash !== "#content" || !studio.page) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); run(savePage); }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") { event.preventDefault(); run(renderPreview); }
  });
  window.addEventListener("workbench-status", event => {
    if (state.token && !studio.initialized) run(initialize);
    previewStatus(event.detail);
  });
  syntaxHelp();
})();
