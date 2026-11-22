"use strict";

(() => {
  const studio = {
    catalog: null, page: null, original: "", revision: "", savedSource: "", savedPath: "",
    changes: {}, tab: "write", contentTab: "write", helpOrigin: "", dirty: false, busy: false, selection: [0, 0],
    assets: [], selected: new Map(), deletePlan: null, previewSource: "", previewPath: "",
    previewURL: "", previewID: "", initialized: false, lastJob: "idle", restoreKey: "",
    mediaTarget: null, pickerFiles: [], pageMedia: [], mediaReview: null, assetDelete: null,
    pdfImport: null, pdfApplied: false, screen: "library", section: "", assetRead: 0, pickerRead: 0,
    navigationResolve: null, newSlugTouched: false, routeEditing: "", searchOrigin: false
  };
  const rootAPI = "/api/workbench/content/";
  const feedback = (message, error = false) => {
    const element = $("#content-feedback");
    element.hidden = !message;
    element.textContent = message;
    element.className = `notice ${error ? "error" : ""}`;
    for (const [dialog, notice] of [["#new-page-dialog", "#new-page-error"], ["#content-draft-dialog", "#content-draft-error"], ["#media-picker", "#media-picker-error"]]) {
      if ($(dialog).open) {
        $(notice).hidden = !message || !error;
        $(notice).textContent = error ? message : "";
      }
    }
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
  function pageAssetFolder(page) {
    return suggestedFolder(page.path);
  }
  function updateOwnedMediaFolders() {
    const folder = pageAssetFolder({ path: activePath() });
    for (const selector of ["#post-image-folder", "#content-image-folder", "#pdf-folder", "#pdf-import-folder"]) $(selector).value = folder;
    return folder;
  }

  function setBusy(value) {
    studio.busy = value;
    $("#content-image-files").disabled = value;
    document.querySelectorAll("#content-image-files").forEach(input => {
      input.closest(".upload-drop-area")?.querySelectorAll("button").forEach(button => { button.disabled = value; });
    });
    $("#content-editor").inert = value;
    $(".content-library").inert = value;
    $("#content-category-navigation").inert = value;
    for (const selector of ["#save-page", "#validate-page", "#delete-page", "#new-page", "#new-page-empty", "#reload-page", "#confirm-delete-page", "#back-content-library", "#content-resume-page", "#content-draft-save", "#content-draft-discard", "#content-draft-cancel"]) {
      $(selector).disabled = value;
    }
    $("#delete-page").disabled = value || !studio.original;
  }

  function showContentScreen(screen) {
    studio.screen = screen;
    $('[data-panel="content"]').dataset.saveTarget = screen === "editor" ? "save-page" : "";
    $("#content-library").hidden = screen !== "library";
    $("#content-library-heading").hidden = screen !== "library";
    $(".content-detail").hidden = screen !== "editor";
    $("#back-content-library").textContent = studio.searchOrigin ? "Back to results" : "Back to library";
    renderLibrary();
    if (location.hash.startsWith("#content")) $("#main").scrollIntoView({block: "start"});
  }

  function renderCategoryNavigation() {
    const categories = window.workbenchContentLibrary.categories(studio.catalog);
    const build = category => {
      const link = node("a", "");
      link.href = category.href;
      link.dataset.view = "content"; link.dataset.contentLabel = category.label;
      link.append(node("span", category.icon), node("span", category.label), node("small", String(category.count)));
      link.addEventListener("click", event => {
        if (!state.git?.editable || studio.busy) {
          event.preventDefault(); feedback("Choose a working branch and finish the current operation before opening content.", true); return;
        }
        showContentScreen("library");
      });
      return link;
    };
    $("#content-category-navigation").replaceChildren(...categories.map(build));
    $("#content-categories").replaceChildren(...categories.map(category => {
      const link = build(category); link.className = "content-category-card";
      link.append(node("p", category.description)); return link;
    }));
    const category = categories.find(item => item.href === location.hash);
    studio.section = category?.id || "";
    $("#content-category-title").textContent = category?.label || "Content library";
    $("#content-category-description").textContent = category?.description || "Choose a category, find a page, or start a new draft. Saving changes local files only.";
    $("#content-categories").hidden = Boolean(category);
    $("#content-all-categories").hidden = !category;
    if (location.hash.startsWith("#content/") && !category) feedback("This content category no longer exists. Choose one of the available categories.", true);
    navigate();
  }

  function activateEditorRoute() {
    const path = activePath(), section = path.includes("/") ? path.split("/")[0] : "pages";
    const route = window.workbenchContentLibrary.categories(studio.catalog).find(category => category.id === section)?.href || "#content";
    if (location.hash !== route) { studio.routeEditing = route; location.hash = route; }
  }

  async function openSearchMatch(file, match, query) {
    if (!state.git?.editable || studio.busy) throw new Error("Choose a working branch and finish current operations before editing a search result.");
    const path = file.path.replace(/^content\//, "");
    if (!studio.catalog?.pages.some(page => page.path === path)) await refreshCatalog();
    if (activePath() !== path || !studio.dirty) await openPage(path);
    if (activePath() !== path || !studio.page) return false;
    studio.searchOrigin = true;
    activateEditorRoute();
    showContentScreen("editor");
    if (!studio.page.error) { await sync(); renderForms(); }
    const find = window.workbenchContentLibrary.findTextRange;
    const sourceText = normalized(studio.page.source);
    const sourceRange = find(sourceText, query, match.line);
    let tab = "source", target = $("#post-source"), range = sourceRange;
    const bodyStart = sourceText.length - normalized(studio.page.body).length;
    if (!studio.page.error && sourceRange && sourceRange.start >= bodyStart) {
      tab = "write"; target = $("#post-body");
      const headerLines = sourceText.slice(0, bodyStart).split("\n").length - 1;
      range = find(target.value, query, Math.max(1, sourceRange.line - headerLines));
    } else if (studio.page.guided && !studio.page.error && sourceRange) {
      const lines = sourceText.split("\n"), matchLine = lines[sourceRange.line - 1];
      const rootField = matchLine.trimStart().startsWith("#") ? "" :
        lines.slice(0, sourceRange.line).reverse().map(line => /^([\w-]+)\s*:/.exec(line)?.[1]).find(Boolean);
      const candidates = [...document.querySelectorAll("[data-editor-panel] [data-field]")].filter(input => {
        const section = input.closest("[data-editor-panel]").dataset.editorPanel;
        return rootField && input.dataset.field.split(".")[0] === rootField &&
          ["metadata", "contacts", "course", "seo"].includes(section) && input.type !== "checkbox" && find(input.value, query);
      });
      const candidate = candidates.length === 1 ? candidates[0] : null;
      if (candidate) {
        tab = candidate.closest("[data-editor-panel]").dataset.editorPanel;
        target = candidate; range = find(target.value, query);
      }
    }
    switchPanel(tab);
    $("#content-match-note").hidden = false;
    $("#content-match-description").textContent = range ?
      `Search match in ${$("#editor-tool-title").textContent}. Saving here changes the page, not your search results.` :
      "This text was found in saved files but no longer matches this draft. Your unsaved work was kept; review the source before changing it.";
    $("#content-match-note").className = range ? "notice" : "notice busy";
    if (range) {
      target.focus();
      if (target.tagName === "TEXTAREA" || ["text", "search", "url", "email", "tel"].includes(target.type))
        target.setSelectionRange(range.start, range.end);
      (target.closest(".monaco-source") || target).scrollIntoView({block: "center"});
    }
    return true;
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
    $("#editing-title").textContent = currentMeta().title || studio.page.title || "Untitled";
    $("#editing-path").textContent = activePath();
    $("#word-count").textContent = `${$("#post-body").value.trim().split(/\s+/).filter(Boolean).length} words`;
    $("#content-resume").hidden = !studio.page;
    $("#content-resume-title").textContent = currentMeta().title || studio.page.title || "Untitled page";
    $("#content-resume-state").textContent = studio.dirty ? "Unsaved changes are kept here. Continue editing when you are ready." : "Your last opened page. You can return without reopening it.";
    if (studio.previewURL) {
      const matches = studio.previewSource === bodySource() && studio.previewPath === activePath() && !Object.keys(studio.changes).length;
      $("#content-preview-state").textContent = matches ?
        "Ready — this preview matches your draft. It is not saved or published." : "Outdated preview — your draft has changed. Build it again to see those changes.";
      $("#content-preview-state").className = matches ? "notice" : "notice busy";
    }
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
    updateReportPreview();
  }

  const definitions = {
    "metadata-fields": [
      ["title", "Page title", "text"], ["date", "Date (ISO date or date-time)", "text", "2026-08-14T00:00:00Z"],
      ["draft", "Draft — excluded from normal production builds", "boolean"],
      ["article_image_width", "Default body photo width (%)", "number", "100"],
      ["publishDate", "Publication date (optional)", "text"], ["expiryDate", "Expiry date (optional)", "text"]
    ],
    "people-fields": [
      ["categories", "Categories — one per line", "list"]
    ],
    "page-image-fields": [
      ["thumbImg.image_path", "Card thumbnail URL", "image"], ["featuredImg.image_path", "Page banner URL", "image"],
      ["featuredImg.width", "Featured image width (%) — blank means 100%", "number", "100"]
    ],
    "seo-fields": [
      ["seo.page_description", "Search description (also the default share description)", "textarea"],
      ["seo.social_title", "Share title override (blank uses the page title)", "text"],
      ["seo.social_description", "Share description override (blank uses the search description)", "textarea"],
      ["seo.social_image", "Exact social preview image (optional; no crop, logo or overlay)", "image"],
      ["seo.canonical_url", "Canonical URL override (optional)", "text"],
      ["seo.featured_image", "Generated-card background override (ignored when an exact social image is set)", "image"],
      ["seo.open_graph_type", "Open Graph type", "text", "article"],
      ["seo.author_twitter_handle", "Author X/Twitter handle (optional)", "text", "@name"],
      ["seo.no_index", "No index — ask search engines not to index", "boolean"]
    ],
    "placement-fields": [
      ["slug", "Slug override (optional)", "text"], ["url", "Public URL override (optional)", "text"],
      ["aliases", "Old public URLs — one per line", "list"]
    ],
    "course-fields": [["current", "Current course — hides previous-course related cards", "boolean"]],
    "report-fields": [
      ["archive", "Archive / legacy report (Archív)", "boolean"],
      ["article_paragraph_spacing", "Paragraph spacing — gap below paragraphs (rem)", "number", "1.5"],
      ["article_text_align", "Paragraph alignment (szövegigazítás)", "select", [
        ["", "Default — left (balra)"], ["left", "Left (balra)"], ["right", "Right (jobbra)"],
        ["center", "Centered (középre)"], ["justify", "Justified (sorkizárt)"]
      ]]
    ]
  };

  function field(definition, meta, onChange, prefix = "") {
    const [path, title, type, placeholder] = definition;
    const wrapper = node("label", title);
    const input = document.createElement(type === "select" ? "select" : ["list", "textarea", "markdown"].includes(type) ? "textarea" : "input");
    if (type === "markdown") input.dataset.monacoLanguage = "markdown";
    input.dataset.field = path;
    input.id = `field-${prefix}${path.replaceAll(".", "-")}`;
    if (type === "boolean") {
      input.type = "checkbox";
      input.checked = Boolean(get(meta, path));
      wrapper.classList.add("check-label");
      wrapper.replaceChildren(input, node("span", title));
    } else {
      if (type === "number") { input.type = "number"; input.min = "10"; input.max = "100"; }
      if (path === "article_paragraph_spacing") { input.min = "0"; input.max = "4"; input.step = "0.25"; }
      if (path === "featuredImg.width") input.step = "any";
      if (type === "select") for (const [value, label] of placeholder) {
        const option = node("option", label); option.value = value; input.append(option);
      }
      if (["list", "textarea", "markdown"].includes(type)) input.rows = type === "list" ? 5 : 3;
      input.value = type === "list" ? (get(meta, path) || []).join("\n") : (get(meta, path) ?? "");
      if (placeholder && type !== "select") input.placeholder = placeholder;
      wrapper.append(input);
    }
    input.addEventListener("input", () => {
      const value = type === "boolean" ? input.checked : type === "list" ?
        input.value.split("\n").map(line => line.trim()).filter(Boolean) :
        type === "number" ? (input.value ? Number(input.value) : null) :
        type === "select" ? (input.value || null) : input.value;
      onChange(path, value);
    });
    if (path === "role") attachSuggestions(input, {
      choices: () => (studio.catalog?.role_catalog?.roles || []).map(role => ({ label: role.label })),
      select: item => {
        input.value = item.label;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
    });
    if (type === "image") {
      const choose = node("button", "Choose image…", "secondary small-button");
      choose.type = "button";
      choose.addEventListener("click", () => run(async () => {
        const imageTitle = {
          "thumbImg.image_path": "Card thumbnail", "featuredImg.image_path": "Page banner",
          "seo.social_image": "Social preview image", "seo.featured_image": "Social card background",
        }[path] || title;
        await openMediaPicker("images", imageTitle, input.value, url => { input.value = url; onChange(path, url); update(); });
      }));
      wrapper.append(choose);
      const preview = node("img", "", "content-field-image");
      preview.alt = `${title} preview`; preview.hidden = true;
      const status = node("span", "", "hint");
      const update = () => {
        status.className = "hint";
        preview.hidden = !input.value.startsWith("/images/");
        status.textContent = !input.value ? "No image selected." : preview.hidden ? "Choose a local image to preview it here." : "Preview of the selected image. Save the page to keep changes.";
        if (!preview.hidden) preview.src = input.value;
      };
      preview.addEventListener("error", () => { preview.hidden = true; status.textContent = "This image could not be loaded. Choose another file or check its path."; status.className = "notice error"; });
      input.addEventListener("change", update);
      wrapper.append(preview, status); update();
    }
    return wrapper;
  }

  function personLabel(id) {
    const person = studio.catalog?.people?.find(person => person.id === id);
    return person ? `${person.name}${person.nickname ? ` (${person.nickname})` : ""} [${person.id}] · ${personMembershipLabel(person)}${person.needs_review ? " · Needs manual clarification" : ""}` :
      `${id} · Unknown registry identity — check Full source`;
  }

  function personTag(id) {
    const tag = node("button", "", "person-identity secondary");
    tag.type = "button";
    tag.dataset.personId = id;
    tag.addEventListener("click", () => window.dispatchEvent(
      new CustomEvent("workbench-open-person", { detail: { id: tag.dataset.personId } })));
    updatePersonTag(tag);
    return tag;
  }

  function updatePersonTag(tag) {
    const id = tag.dataset.personId;
    const person = studio.catalog?.people?.find(person => person.id === id);
    tag.disabled = !person;
    tag.setAttribute("aria-label", person ? `Edit person: ${person.name} [${id}]` : `Unknown person: ${id}`);
    const initials = (person?.name || id).trim().split(/\s+/).slice(0, 2)
      .map(word => Array.from(word)[0]).join("").toLocaleUpperCase("hu");
    const avatar = node("span", initials, "person-identity-avatar");
    avatar.setAttribute("aria-hidden", "true");
    if (person?.image?.startsWith("/images/")) {
      const image = document.createElement("img");
      image.src = person.image;
      image.alt = "";
      image.loading = "lazy";
      avatar.replaceChildren(image);
    }
    tag.replaceChildren(avatar, node("span", personLabel(id), "person-identity-label"));
  }

  function personPicker(title, selected, onSelect, excluded = () => []) {
    const wrapper = node("div", "", "person-picker");
    wrapper.dataset.pickerTitle = title;
    const searchLabel = node("label", `${title} — search people`);
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search name, nickname or stable ID";
    searchLabel.append(search);
    const filterLabel = node("label", "Membership filter");
    const filter = document.createElement("select");
    for (const [value, label] of [["all", "All people"], ["current", "Current members"], ["nonmembers", "Not current members"], ["review", "Needs clarification"]]) {
      const option = node("option", label); option.value = value; filter.append(option);
    }
    filterLabel.append(filter);
    const choiceLabel = node("label", title);
    const choice = document.createElement("select");
    choiceLabel.append(choice);
    const update = () => {
      const id = selected();
      const term = search.value.trim().toLocaleLowerCase("hu");
      const people = (studio.catalog?.people || []).filter(person =>
        person.id === id || (!excluded().includes(person.id) &&
          (filter.value !== "current" || person.membership) &&
          (filter.value !== "nonmembers" || !person.membership) &&
          (filter.value !== "review" || person.needs_review) &&
          [person.name, person.id, person.nickname, ...(person.aliases || [])].filter(Boolean).join(" ").toLocaleLowerCase("hu").includes(term)));
      const placeholder = node("option", people.length ? "Choose a person…" : "No matching people — change search or filter");
      placeholder.value = "";
      choice.replaceChildren(placeholder, ...people.map(person => {
        const option = node("option", personLabel(person.id)); option.value = person.id; return option;
      }));
      if (id && !people.some(person => person.id === id)) {
        const missing = node("option", personLabel(id)); missing.value = id; choice.append(missing);
      }
      choice.value = id || "";
    };
    search.addEventListener("input", update);
    filter.addEventListener("change", update);
    choice.addEventListener("change", () => onSelect(choice.value));
    wrapper.append(searchLabel, filterLabel, choiceLabel);
    const suggestions = attachSuggestions(search, {
      choices: () => {
        const term = search.value.trim().toLocaleLowerCase("hu");
        return (studio.catalog?.people || []).filter(person =>
          !excluded().includes(person.id) &&
          (filter.value !== "current" || person.membership) &&
          (filter.value !== "nonmembers" || !person.membership) &&
          (filter.value !== "review" || person.needs_review) &&
          [person.name, person.id, person.nickname, ...(person.aliases || [])].filter(Boolean)
            .join(" ").toLocaleLowerCase("hu").includes(term)).map(person => ({
              value: person.id, label: personLabel(person.id),
              search: [person.name, person.id, person.nickname, ...(person.aliases || [])].filter(Boolean).join(" "),
              person,
            }));
      },
      select: item => {
        onSelect(item.value);
        if (wrapper.isConnected === false) {
          const next = Array.from(document.querySelectorAll(".person-picker"))
            .find(picker => picker.dataset.pickerTitle === title);
          next?.querySelector("input")?.focus();
        }
      },
      render: (option, item) => {
        const avatar = node("span", "", "person-identity-avatar");
        avatar.setAttribute("aria-hidden", "true");
        if (item.person.image?.startsWith("/images/")) {
          const image = document.createElement("img");
          image.src = item.person.image;
          image.alt = "";
          image.loading = "lazy";
          avatar.append(image);
        } else avatar.textContent = item.person.name.trim().split(/\s+/).slice(0, 2)
          .map(word => Array.from(word)[0]).join("").toLocaleUpperCase("hu");
        option.append(avatar, node("span", item.label));
      },
    });
    filter.addEventListener("change", suggestions.refresh);
    wrapper.refreshPeople = () => { update(); suggestions.refresh(); };
    wrapper.append(node("p", "“Needs manual clarification” means the identity is unconfirmed. Do not guess a match or assign based only on a similar name.", "hint"));
    update();
    return wrapper;
  }

  function refreshPeoplePickers() {
    document.querySelectorAll(".person-picker").forEach(picker => picker.refreshPeople());
    document.querySelectorAll("[data-person-id]").forEach(updatePersonTag);
    refreshParticipantContexts();
  }

  function refreshParticipantContexts() {
    document.querySelectorAll("[data-participant-context]").forEach(label => {
      const person = studio.catalog?.people?.find(person => person.id === label.dataset.participantContext);
      const section = activePath().split("/")[0];
      const entry = (currentMeta().participant_ids || []).find(value => (typeof value === "string" ? value : value.person) === person?.id);
      label.textContent = personParticipationLabel(person, section, entry?.roles || entry?.role || "",
        studio.catalog?.role_catalog?.roles || []);
    });
  }

  function assignParticipants(values) {
    change("participant_ids", values);
    change("participants", []);
    renderAssignments();
  }

  function renderAssignments() {
    const container = $("#people-assignments");
    container.replaceChildren();
    const meta = currentMeta();
    const author = node("section", "", "repeater");
    author.append(personPicker("Author for this page", () => currentMeta().author_id || "", id => {
      change("author_id", id);
      change("author", "");
      renderAssignments();
    }));
    if (meta.author_id) {
      author.append(personTag(meta.author_id));
      const remove = node("button", "Remove author", "secondary");
      remove.type = "button";
      remove.addEventListener("click", () => {
        change("author_id", "");
        change("author", "");
        renderAssignments();
      });
      author.append(remove);
    }
    if (meta.author) author.append(node("p", `Legacy author (read-only; Full source): ${meta.author}. Choosing a registry author clears this name-only value.`, "hint"));
    const participants = node("section", "", "repeater");
    participants.append(node("h3", "Participants for this page (ordered)"));
    const manageRoles = node("button", "Manage global participant roles", "secondary");
    manageRoles.type = "button";
    manageRoles.addEventListener("click", () => window.dispatchEvent(new Event("workbench-open-roles")));
    participants.append(manageRoles, node("p", "Manual roles override automatic classification on this page. With no role, the configurable rules in Manage roles use membership and course participation. Membership stays separate.", "hint"));
    const values = meta.participant_ids || [];
    if (!Array.isArray(values)) {
      participants.append(node("p", "Invalid participant_ids. Fix it in Full source.", "notice error"));
    } else {
      const personID = value => typeof value === "string" ? value : value?.person;
      values.forEach((entry, index) => {
        const row = node("div", "", "person-assignment");
        const identity = node("div", "", "person-assignment-identity");
        const id = personID(entry) || "(missing ID)";
        const context = node("span", "", "person-participation-status");
        context.dataset.participantContext = id;
        identity.append(personTag(id), context);
        row.append(identity);
        row.append(participantRolePicker(entry, index));
        const controls = node("div", "", "actions");
        for (const [text, direction] of [["↑", -1], ["↓", 1], ["Remove", 0]]) {
          const button = node("button", text, "secondary");
          button.type = "button";
          button.setAttribute("aria-label", `${direction ? direction < 0 ? "Move up" : "Move down" : "Remove"} participant ${index + 1}`);
          button.disabled = Boolean(direction && (index + direction < 0 || index + direction >= values.length));
          button.addEventListener("click", () => {
            const updated = clone(currentMeta().participant_ids);
            if (!direction) updated.splice(index, 1);
            else [updated[index], updated[index + direction]] = [updated[index + direction], updated[index]];
            assignParticipants(updated);
          });
          controls.append(button);
        }

        row.append(controls);
        participants.append(row);
      });
      participants.append(personPicker("Add participant", () => "", id => {
        if (!id) return;
        const existing = currentMeta().participant_ids || [];
        if (!existing.some(entry => personID(entry) === id)) assignParticipants([...existing, id]);
      }, () => (currentMeta().participant_ids || []).map(personID)));
      if (!values.length) participants.append(node("p", "No registry participants assigned to this page.", "hint"));
    }
    if (meta.participants?.length) participants.append(node("p",
      `Legacy participants (read-only; Full source): ${Array.isArray(meta.participants) ? meta.participants.join(", ") : meta.participants}. Using registry assignments clears these name-only values.`, "hint"));
    container.append(author, participants);
    refreshParticipantContexts();
  }

  function participantRolePicker(entry, index) {
    const definitions = studio.catalog?.role_catalog?.roles || [];
    return createRolePicker(entry, definitions, ids => {
      const values = clone(currentMeta().participant_ids);
      const id = typeof values[index] === "string" ? values[index] : values[index].person;
      values[index] = ids.length ? { person: id, roles: ids } : id;
      assignParticipants(values);
    }, `participant-role-search-${index}`, "Roles on this page");
  }

  const repeaters = {
    milestones: { label: "Course milestones", course: true, fields: [["label", "Phase label"], ["date", "Date (YYYY-MM-DD)"], ["estimated", "Estimated date", "boolean"]] },
    flyer_images: { label: "Course flyers", course: true, fields: [["image_path", "Local flyer image URL", "image"]], hint: "Posters and leaflets appear as overlapping cards in the page heading. Click a flyer to open the original image. They do not replace the banner or social image. Choose an existing image or upload a new one." },
    faq: { label: "Frequently asked questions", fields: [["question", "Question"], ["answer", "Answer (Markdown)", "markdown"]] }
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
    $("#report-formatting").hidden = !activePath().startsWith("turak/");
    updateReportPreview();
    for (const [key, config] of Object.entries(repeaters)) {
      if (config.course && !course) continue;
      const section = node("section", "", "repeater");
      const header = node("div", "", "section-heading");
      const add = node("button", "+ Add", "secondary");
      header.append(node("h3", config.label), add);
      section.append(header);
      if (config.hint) section.append(node("p", config.hint, "hint"));
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

  function renderContactAssignments() {
    const container = $("#contact-assignments");
    container.replaceChildren(node("p",
      "Assign registry people here; edit shared contact details and profile visibility in People & portraits by clicking their badge. Roles and ordering belong to this page.", "hint"));
    const groups = [];
    if (activePath().startsWith("tanfolyamok/") || currentMeta().contacts) {
      groups.push({ title: "Course / page contacts", prefix: "page-contacts",
        get: () => currentMeta().contacts || [], set: value => change("contacts", value) });
    }
    const blocks = currentMeta().content_blocks || [];
    if (!Array.isArray(blocks)) {
      container.append(node("p", "Invalid content_blocks list. Fix it in Full source.", "notice error"));
      return;
    }
    blocks.forEach((block, index) => {
      if (!block || !["contact/info", "global/richtext"].includes(block._bookshop_name)) return;
      if (block._bookshop_name === "global/richtext" && !Object.hasOwn(block, "contacts")) return;
      groups.push({ title: block.heading || `Contact block ${index + 1}`, prefix: `block-${index}-contacts`,
        get: () => currentMeta().content_blocks[index].contacts || [],
        set: value => {
          const blocks = clone(currentMeta().content_blocks);
          blocks[index].contacts = value;
          change("content_blocks", blocks);
        } });
    });
    for (const group of groups) {
      const section = node("section", "", "repeater");
      const header = node("div", "", "section-heading");
      const add = node("button", "+ Add contact", "secondary");
      add.type = "button";
      add.addEventListener("click", () => run(async () => {
        if (!Array.isArray(group.get())) throw new Error("Invalid contacts list. Fix it in Full source.");
        group.set([...group.get(), { role: "" }]);
        renderContactAssignments();
      }));
      header.append(node("h3", group.title), add);
      section.append(header);
      const list = group.get();
      if (!Array.isArray(list)) {
        section.append(node("p", "Invalid contacts list. Fix it in Full source.", "notice error"));
        container.append(section);
        continue;
      }
      list.forEach((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          section.append(node("p", `Invalid contact entry ${index + 1}. Fix it in Full source.`, "notice error"));
          return;
        }
        const row = node("div", "", "repeater-row");
        const fields = node("div", "", "form-grid");
        fields.append(personPicker(`Contact ${index + 1}`, () => group.get()[index].person || "", id => {
          const updated = clone(group.get());
          if (id) {
            updated[index].person = id;
            delete updated[index].name;
            delete updated[index].email;
            delete updated[index].phone;
          } else delete updated[index].person;
          group.set(updated);
          renderContactAssignments();
        }));
        if (entry.person) {
          fields.append(personTag(entry.person));
          const person = studio.catalog?.people?.find(person => person.id === entry.person);
          fields.append(node("p", person ?
            [person.email, person.phone].filter(Boolean).join(" · ") || "No shared email or phone. Click the person badge to add agreed contact details." :
            "Unknown person ID. Choose an existing registry person.", "hint"));
        }
        if (entry.name || entry.email || entry.phone) fields.append(node("p",
          `Legacy contact details: ${[entry.name, entry.email, entry.phone].filter(Boolean).join(" · ")}. Move these to the person profile before choosing a registry person; selecting a person clears inline details.`, "notice"));
        fields.append(field(["role", "Contact role"], entry, (key, value) => {
          const updated = clone(group.get());
          updated[index][key] = value;
          group.set(updated);
        }, `${group.prefix}-${index}-`));
        const controls = node("div", "", "actions");
        for (const [text, direction] of [["↑", -1], ["↓", 1], ["Remove", 0]]) {
          const button = node("button", text, "secondary");
          button.type = "button";
          button.setAttribute("aria-label", `${text === "Remove" ? "Remove" : direction < 0 ? "Move up" : "Move down"} contact ${index + 1}`);
          button.disabled = direction !== 0 && (index + direction < 0 || index + direction >= list.length);
          button.addEventListener("click", () => {
            const updated = clone(group.get());
            if (!direction) updated.splice(index, 1);
            else [updated[index], updated[index + direction]] = [updated[index + direction], updated[index]];
            group.set(updated);
            renderContactAssignments();
          });
          controls.append(button);
        }
        row.append(fields, controls);
        section.append(row);
      });
      if (!list.length) section.append(node("p", "No contact assignments. This contact list will not appear on the page.", "hint"));
      container.append(section);
    }
    if (!groups.length) container.append(node("p",
      "This page has no contact-card section. Course pages use contacts; component pages use contact/info or global/richtext blocks with contacts configured in Full source.", "hint"));
  }

  function renderForms() {
    const meta = currentMeta();
    renderContactAssignments();
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
    const categoryLabel = node("label", "Add a saved page category — type to search");
    const categoryInput = document.createElement("input");
    categoryInput.type = "search";
    categoryInput.placeholder = "Search saved page categories";
    categoryLabel.append(categoryInput);
    $("#people-fields").append(categoryLabel);
    attachSuggestions(categoryInput, {
      choices: () => (studio.catalog?.categories || []).filter(category =>
        !(currentMeta().categories || []).includes(category)).map(category => ({ label: category })),
      select: item => {
        change("categories", [...new Set([...(currentMeta().categories || []), item.label])]);
        renderForms();
      },
    });
    renderAssignments();
    const course = activePath().startsWith("tanfolyamok/");
    $("#course-fields").hidden = !course;
    $("#course-note").hidden = !course;
    renderRepeaters();
    updateSocialNote();
  }

  function updateSocialNote() {
    if (!studio.page) return;
    const meta = currentMeta();
    $("#social-source-note").textContent = meta.seo?.social_image
      ? `Exact social image: ${meta.seo.social_image}. Used unchanged; no crop, logo or overlay. Share title: ${meta.seo.social_title || meta.title || studio.page.title}. Share description: ${meta.seo.social_description || meta.seo.page_description || "site-wide description"}.`
      : `Generated social-card background: ${meta.seo?.featured_image ||
      (studio.page.guided ? meta.featuredImg?.image_path : "") ||
      "a suitable landscape hero photo, selected by Hugo at build time"}.`;
  }

  function updateReportPreview() {
    if (!studio.page) return;
    const meta = currentMeta();
    const preview = $("#report-type-preview");
    const gap = meta.article_paragraph_spacing ?? 1.5;
    preview.style.textAlign = ["left", "right", "center", "justify"].includes(meta.article_text_align) ? meta.article_text_align : "left";
    for (const paragraph of preview.querySelectorAll("p")) {
      paragraph.style.margin = "0";
      paragraph.style.lineHeight = "1.9";
    }
    preview.querySelector("p").style.marginBottom = `${Number.isFinite(gap) && gap >= 0 && gap <= 4 ? gap : 1.5}rem`;
  }

  async function refreshCatalog() {
    studio.catalog = await api(rootAPI + "catalog");
    $("#image-folders").replaceChildren(...studio.catalog.folders.map(folder => {
      const option = document.createElement("option"); option.value = folder; return option;
    }));
    renderMemberNames();
    refreshPeoplePickers();
    $("#new-page-template").replaceChildren(...studio.catalog.templates.map(template => {
      const option = node("option", template.name); option.value = template.id; return option;
    }));
    renderCategoryNavigation();
    renderLibrary();
  }

  function renderMemberNames() {
    $("#member-names").replaceChildren(...(studio.catalog.members || []).map(name => {
      const option = document.createElement("option"); option.value = name; return option;
    }));
  }

  function renderLibrary() {
    if (!studio.catalog) return;
    const pages = window.workbenchContentLibrary.filter(studio.catalog.pages, {
      section: studio.section, search: $("#content-search").value, status: $("#content-status-filter").value, sort: $("#content-sort").value,
    });
    const count = studio.catalog.pages.filter(page => !studio.section || page.section === studio.section).length;
    $("#content-count").textContent = `${pages.length} of ${count} pages`;
    $("#content-empty").hidden = pages.length > 0;
    $("#content-list").replaceChildren();
    for (const page of pages) {
      const button = node("button", "", "content-list-item");
      button.type = "button";
      button.dataset.workbenchFile = `content/${page.path}`;
      button.classList.toggle("selected", page.path === studio.original);
      if (page.image) { const image = node("img", "", "content-card-image"); image.src = page.image; image.alt = ""; image.loading = "lazy"; button.append(image); }
      button.append(node("strong", page.title),
        node("small", `${String(page.date).slice(0, 10)}${page.date ? " · " : ""}${page.draft ? "Draft" : "Not a draft"}${page.current ? " · Current course" : ""}${page.archive ? " · Archive" : ""}`));
      if (page.error) button.append(node("span", "Needs attention — open to review the source", "content-card-error"));
      button.append(node("code", page.path));
      button.addEventListener("click", () => run(() => openPage(page.path)));
      $("#content-list").append(button);
    }
  }

  async function allowDiscard() {
    if (!studio.dirty) return true;
    if (studio.navigationResolve) throw new Error("Finish the current draft decision first.");
    $("#content-draft-title").textContent = currentMeta().title || studio.page.title || "Untitled page";
    $("#content-draft-error").hidden = true;
    $("#content-draft-dialog").showModal();
    return new Promise(resolve => { studio.navigationResolve = resolve; });
  }

  function finishDraftDecision(proceed) {
    if (studio.busy) return;
    const resolve = studio.navigationResolve;
    studio.navigationResolve = null;
    $("#content-draft-dialog").close();
    if (!proceed) {
      if ($("#new-page-dialog").open) $("#new-page-dialog").close();
      showContentScreen("editor");
      if (location.hash === "#search") activateEditorRoute();
    }
    if (resolve) resolve(proceed);
  }

  async function openPage(path) {
    if (studio.busy || !await allowDiscard()) return;
    setBusy(true);
    try {
      const page = await api(`${rootAPI}page?${new URLSearchParams({ path })}`);
      studio.searchOrigin = false;
      loadPage(page, true);
    }
    finally { setBusy(false); }
  }

  function loadPage(page, saved) {
    if (studio.page?.path !== page.path) $("#content-match-note").hidden = true;
    if (studio.page?.path !== page.path) studio.searchOrigin = false;
    studio.page = page;
    studio.original = saved ? page.path : "";
    studio.revision = saved ? page.revision : "";
    studio.savedSource = saved ? page.source : "";
    studio.savedPath = saved ? page.path : "";
    studio.changes = {};
    cancelMediaPicker();
    studio.selected.clear();
    studio.previewURL = "";
    studio.previewSource = "";
    studio.previewPath = "";
    studio.previewID = "";
    $("#content-preview-frame").hidden = true;
    $("#content-social-frame").hidden = true;
    $("#preview-external").hidden = true;
    $("#content-preview-state").textContent = "Render an unsaved preview to see the actual site.";
    $("#content-editor").hidden = false;
    $("#post-path").value = page.path;
    $("#post-path").dataset.workbenchFile = saved ? `content/${page.path}` : "";
    $("#post-body").value = page.body;
    $("#post-source").value = page.source;
    $("#post-image-folder").value = pageAssetFolder(page);
    $("#content-image-folder").value = $("#post-image-folder").value;
    $("#pdf-folder").value = pageAssetFolder(page);
    $("#pdf-import-folder").value = pageAssetFolder(page);
    $("#pdf-import-url").value = page.source.match(/\/pdfs\/[^\s"'<>}]+\.pdf/)?.[0] || "";
    $("#pdf-import-source").value = $("#pdf-import-url").value ? "existing" : "upload";
    $("#pdf-import-file").value = "";
    const matchingPDF = studio.pdfImport?.path === page.path;
    $("#pdf-import-review").hidden = !matchingPDF;
    pdfStatus(matchingPDF ? "This page's PDF extraction is still available below." : "");
    updatePDFSource();
    $("#page-media-image-folder").value = $("#post-image-folder").value;
    $("#page-media-pdf-folder").value = $("#pdf-folder").value;
    studio.pageMedia = [];
    studio.mediaReview = null;
    studio.assetDelete = null;
    studio.contentTab = "write";
    $("#asset-folder").value = $("#post-image-folder").value;
    studio.selection = [0, 0];
    $("#body-warning").textContent = page.guided ? "The title, author and participant cards come from frontmatter; do not repeat them in the story." :
      "This is a source-mode page. Component-driven pages may render content_blocks rather than the Markdown body; edit the complete YAML in Full source.";
    for (const tab of ["metadata", "course", "seo"]) {
      $(`[data-editor-tab="${tab}"]`).disabled = !page.guided || Boolean(page.error);
    }
    $(`[data-editor-tab="contacts"]`).disabled = Boolean(page.error);
    $("#page-people-editing").hidden = !page.guided || Boolean(page.error);
    document.querySelectorAll("[data-add-faq]").forEach(button => { button.disabled = !page.guided || Boolean(page.error); });
    $(`[data-editor-tab="write"]`).disabled = Boolean(page.error);
    if (!page.error) renderForms();
    setBusy(false);
    switchPanel(page.guided && !page.error ? "write" : "source");
    feedback(page.error || (page.warnings || []).join("\n"), Boolean(page.error));
    markDirty();
    renderLibrary();
    showContentScreen("editor");
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
    const content = ["write", "metadata", "contacts", "course", "seo"].includes(tab);
    if (content) studio.contentTab = tab;
    $("#editor-content-navigation").hidden = false;
    $("#editor-return-content").hidden = content;
    $("#content-editor").dataset.workspace = content ? "edit" : tab;
    $("#editor-workspace-kind").textContent = content ? "Editing mode" : "Page tool mode";
    $("#editor-workspace-badge").textContent = content ? "EDITING" : "TOOL ACTIVE";
    $("#editor-workspace-detail").textContent = content ? "Changes stay in this draft until you save. Use Preview to check the actual page." :
      "Your story and settings are kept while you use this tool. Save page applies all sections.";
    $("#editor-tool-title").textContent = {
      "page-media": "Files & usage", media: "Add images & PDFs", "pdf-import": "Read a PDF",
      placement: "File & URL placement", source: "Full source",
      preview: "Whole-page preview", syntax: "Syntax help",
      write: "Story", metadata: "Page details & cover", contacts: "People & contacts", course: "Course & FAQ", seo: "Sharing & search"
    }[tab] || "Edit page";
    const back = $(`[data-editor-tab="${studio.contentTab}"]`);
    $("#editor-return-content").disabled = Boolean(back?.disabled);
    $("#editor-return-content").classList.toggle("active", content);
    $("#editor-return-content").setAttribute("aria-pressed", String(content));
    $("#editor-return-content").textContent = "Return to editing";
    document.querySelectorAll("[data-editor-panel]").forEach(panel => { panel.hidden = panel.dataset.editorPanel !== tab; });
    document.querySelectorAll("[data-editor-tab]").forEach(button => {
      const active = button.dataset.editorTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-editor-tool]").forEach(button => {
      const active = button.dataset.editorTool === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (tab === "source") $("#post-source").value = studio.page.source;
  }

  async function showTab(tab) {
    if (!studio.page || studio.busy) return;
    if (studio.mediaTarget && tab !== "media") cancelMediaPicker();
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
    if (tab === "page-media") await refreshPageMedia();
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
        tab: studio.tab, contentTab: studio.contentTab, assetFolder: $("#asset-folder").value,
        mediaImageFolder: $("#page-media-image-folder").value, mediaPdfFolder: $("#page-media-pdf-folder").value,
        selected: new Map(studio.selected),
        socialShown: !$("#content-social-frame").hidden,
        previewSource: studio.previewSource, previewPath: studio.previewPath, previewURL: studio.previewURL,
        previewID: studio.previewID,
        selection: [...studio.selection]
      };
      const result = await api(rootAPI + "save", { method: "POST", payload });
      loadPage(result, true);
      studio.contentTab = previous.contentTab;
      switchPanel(previous.tab);
      updateOwnedMediaFolders();
      $("#asset-folder").value = previous.assetFolder;
      $("#page-media-image-folder").value = previous.mediaImageFolder;
      $("#page-media-pdf-folder").value = previous.mediaPdfFolder;
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
      const message = [`Saved ${result.path}. Changes are local, not published.`, ...(result.warnings || [])].join("\n");
      feedback(message);
      notify(message);
      await refreshCatalog();
    } finally { setBusy(false); }
    if (studio.tab === "page-media") await refreshPageMedia();
  }

  async function renderPreview() {
    if (studio.busy) return;
    const payload = await sync();
    switchPanel("preview");
    $("#content-preview-state").className = "notice busy";
    $("#content-preview-state").textContent = "Starting an isolated Hugo build from your unsaved draft. No site files are being changed.";
    $("#content-preview-progress").hidden = false;
    $("#content-preview-frame").hidden = true;
    $("#content-social-frame").hidden = true;
    $("#preview-external").hidden = true;
    studio.previewURL = ""; studio.previewSource = payload.source; studio.previewPath = payload.path;
    setBusy(true);
    try {
      const job = await api(rootAPI + "preview", { method: "POST", payload });
      studio.previewID = job.preview_id;
      $("#content-preview-state").textContent = "Building the actual page and checking its URL. Larger sites can take a little longer; the technical log below shows Hugo's output.";
      feedback("Rendering the actual Hugo page. Your unsaved Markdown stays out of the checkout.");
    } catch (error) {
      $("#content-preview-progress").hidden = true;
      $("#content-preview-state").className = "notice error";
      $("#content-preview-state").textContent = `Preview could not start: ${error.message}. Your draft is safe. Review the details and try Build current draft again.`;
      throw error;
    }
    finally { setBusy(false); }
  }

  function previewStatus(status) {
    const preview = status.contentPreview;
    if (!preview || !studio.page) return;
    const running = status.job.state === "running";
    $("#preview-page").disabled = running;
    $("#preview-page-again").disabled = running;
    $("#content-preview-log").textContent = status.job.action === "content-preview" ? status.job.log || "Preparing Hugo…" : $("#content-preview-log").textContent;
    if (preview.id !== studio.previewID || preview.path !== studio.previewPath || !studio.previewSource) return;
    $("#content-preview-progress").hidden = preview.state === "ready" || preview.state === "failed";
    if (preview.state === "failed") {
      $("#content-preview-state").className = "notice error";
      $("#content-preview-state").textContent = `Preview failed: ${preview.error}. Your draft has not been lost. Review the technical log, fix the reported content, then Build current draft again.`;
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
    if (studio.busy) return;
    if (!studio.catalog) await refreshCatalog();
    const choices = studio.catalog.templates.filter(template => studio.section ?
      template.section === studio.section || (!template.section && !["turak", "tanfolyamok"].includes(studio.section)) : true);
    $("#new-page-template").replaceChildren(...choices.map(template => { const option = node("option", template.name); option.value = template.id; return option; }));
    $("#new-page-title").value = ""; $("#new-page-slug").value = ""; studio.newSlugTouched = false;
    $("#new-page-error").hidden = true;
    selectTemplate();
    $("#new-page-dialog").showModal();
    $("#new-page-title").focus();
  }

  function selectTemplate() {
    const template = studio.catalog.templates.find(item => item.id === $("#new-page-template").value);
    $("#new-page-folder").value = template.section || (studio.section === "pages" ? "" : studio.section);
    $("#new-page-bundle").checked = false;
    suggestNewSlug();
  }

  function suggestNewSlug() {
    if (studio.newSlugTouched) return;
    const slug = window.workbenchContentLibrary.slug($("#new-page-title").value);
    $("#new-page-slug").value = $("#new-page-template").value === "pdf" && slug ? `legacy-${slug}` : slug;
  }

  async function createPage(event) {
    event.preventDefault();
    const slug = $("#new-page-slug").value.trim();
    const folder = $("#new-page-folder").value.trim().replace(/\/$/, "");
    const path = (folder ? folder + "/" : "") + slug + ($("#new-page-bundle").checked ? "/index.md" : ".md");
    const title = $("#new-page-title").value.trim();
    if (!title || !slug) throw new Error("Give this page a title and a usable filename in Advanced placement.");
    if (studio.catalog.pages.some(item => item.path === path)) throw new Error("A page already uses this filename. Change it in Advanced placement, or cancel and open the existing page.");
    let page = await api(rootAPI + "template", { method: "POST", payload: { path, template: $("#new-page-template").value } });
    page = {...page, ...await api(rootAPI + "compose", {method: "POST", payload: {source: page.source, changes: {title}}})};
    if (!await allowDiscard()) return;
    $("#new-page-dialog").close();
    loadPage(page, false);
    feedback("New draft loaded from the site template. Replace placeholders; nothing has been written yet.");
  }

  async function openMediaPicker(kind, title, value, assign) {
    studio.mediaTarget = { kind, title, assign, origin: studio.tab };
    $("#media-picker-title").textContent = `Choose existing file: ${title}`;
    $("#media-picker-folder-label").textContent = `Folder under static/${kind}/`;
    const folder = updateOwnedMediaFolders();
    if (typeof value === "string" && value.startsWith(`/${kind}/`)) {
      studio.mediaTarget.borrowedFolder = decodeURIComponent(value.slice(kind.length + 2).split("/").slice(0, -1).join("/"));
    }
    $("#media-picker-folder").value = folder;
    $("#media-picker-search").value = "";
    $("#media-picker-image-upload").hidden = kind !== "images";
    $("#media-picker-image-files").value = "";
    renderUploadPreviews($("#media-picker-image-files"));
    $("#media-picker").showModal();
    await browsePicker();
  }

  async function browsePicker() {
    const target = studio.mediaTarget;
    if (!target) return;
    const request = ++studio.pickerRead;
    $("#media-picker-status").textContent = "Loading files…";
    $("#media-picker-error").hidden = true;
    studio.pickerFiles = [];
    $("#media-picker-files").replaceChildren();
    $("#media-picker-folders").replaceChildren();
    try {
      const folder = $("#media-picker-folder").value.trim().replace(/\/$/, "");
      renderFolderTrail("#media-picker-breadcrumbs", folder, target.kind, name => {
        $("#media-picker-folder").value = name; return browsePicker();
      });
      $("#media-picker-parent").disabled = !folder;
      const result = await api(`/api/workbench/assets?${new URLSearchParams({ folder, kind: target.kind })}`);
      if (request !== studio.pickerRead || studio.mediaTarget !== target || $("#media-picker-folder").value.trim().replace(/\/$/, "") !== folder) return;
      studio.pickerFiles = result.files;
      $("#media-picker-folders").replaceChildren(...result.folders.map(name => {
        const button = node("button", `Folder · ${name.split("/").pop()}`, "secondary");
        button.type = "button";
        button.addEventListener("click", () => run(async () => {
          $("#media-picker-folder").value = name;
          await browsePicker();
        }));
        return button;
      }));
      renderPicker();
    } catch (error) {
      if (request !== studio.pickerRead || studio.mediaTarget !== target) return;
      $("#media-picker-status").textContent = `Could not load files: ${error.message}`;
      $("#media-picker-error").hidden = false;
      $("#media-picker-error").textContent = `Folder could not be opened: ${error.message}. Try Refresh folder or go up one folder.`;
      throw error;
    }
  }

  function renderPicker() {
    if (!studio.mediaTarget) return;
    const search = $("#media-picker-search").value.toLocaleLowerCase();
    const files = studio.pickerFiles.filter(file => file.name.toLocaleLowerCase().includes(search));
    $("#media-picker-files").replaceChildren();
    for (const file of files) {
      const button = node("button", "", "asset-card secondary");
      button.dataset.workbenchFile = `static${file.url}`;
      if (studio.mediaTarget.kind === "images") {
        const image = document.createElement("img");
        image.src = file.url; image.alt = file.name; image.loading = "lazy";
        button.append(image);
      } else button.append(node("strong", "PDF"));
      button.append(node("span", file.name), node("small", `${Math.round(file.bytes / 1024)} KiB`));
      button.addEventListener("click", () => run(async () => assignMedia(file.url)));
      if (studio.mediaTarget.kind === "images") {
        const shell = node("div", "", "asset-picker-choice");
        const edit = node("button", "Edit image…", "secondary");
        edit.type = "button";
        edit.disabled = !window.workbenchImages.supports(file.url);
        edit.title = edit.disabled ? "Editing supports JPG, PNG and WebP. SVG/GIF files can still be selected unchanged." : "";
        edit.addEventListener("click", () => run(async () => {
          const target = studio.mediaTarget;
          const outcome = await editPageImages({url: file.url, field: target.title});
          if (studio.mediaTarget !== target) throw new Error("The image field changed. Saved files remain in the page folder.");
          if (outcome.primary) assignMedia(outcome.primary);
        }));
        shell.append(button, edit); $("#media-picker-files").append(shell);
      } else $("#media-picker-files").append(button);
    }
    $("#media-picker-status").textContent = files.length ?
      `${files.length} files. Choose one to assign it directly.` : "No matching files here. Browse another folder or upload a new file.";
  }

  function assignMedia(url) {
    const target = studio.mediaTarget;
    if (!target) throw new Error("Choose a destination field before assigning media.");
    if (!url.startsWith(`/${target.kind}/`)) throw new Error("This file does not match the destination type.");
    target.assign(url);
    studio.mediaTarget = null;
    $("#media-target").hidden = true;
    if ($("#media-picker").open) $("#media-picker").close();
    renderForms();
    switchPanel(target.origin);
    feedback(target.kind === "pdfs" ? `PDF selected: ${url}. Use Insert PDF shortcode to add it to the story, then save the page.` :
      `${target.title} set to ${url}. Save the page to keep this assignment.`);
  }

  function cancelMediaPicker() {
    studio.mediaTarget = null;
    $("#media-target").hidden = true;
    if ($("#media-picker").open) $("#media-picker").close();
  }

  function renderFolderTrail(selector, folder, kind, open) {
    const items = window.workbenchContentLibrary.folderTrail(folder, kind === "pdfs" ? "All PDFs" : "All images");
    $(selector).replaceChildren(...items.map((item, index) => {
      if (index === items.length - 1) { const label = node("span", item.label); label.setAttribute("aria-current", "location"); return label; }
      const button = node("button", item.label, "secondary"); button.type = "button";
      button.addEventListener("click", () => run(() => open(item.folder))); return button;
    }));
  }

  async function browseAssets() {
    const request = ++studio.assetRead;
    const folder = $("#asset-folder").value.trim().replace(/\/$/, "");
    renderFolderTrail("#asset-breadcrumbs", folder, "images", name => { $("#asset-folder").value = name; return browseAssets(); });
    $("#asset-parent").disabled = !folder;
    $("#asset-count").textContent = "Loading this folder…";
    $("#asset-grid").replaceChildren(); $("#asset-folders").replaceChildren();
    let result;
    try { result = await api(`/api/workbench/assets?${new URLSearchParams({ folder })}`); }
    catch (error) {
      if (request !== studio.assetRead) return;
      $("#asset-count").textContent = "Folder could not be opened. Try Refresh folder or go up.";
      throw error;
    }
    if (request !== studio.assetRead || $("#asset-folder").value.trim().replace(/\/$/, "") !== folder) return;
    studio.assets = result.files;
    $("#asset-folders").replaceChildren(...result.folders.map(name => {
      const button = node("button", `Folder · ${name.split("/").pop()}`, "secondary");
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
      card.dataset.workbenchFile = `static${file.url}`;
      const check = document.createElement("input");
      check.type = "checkbox"; check.checked = studio.selected.has(file.url);
      const image = document.createElement("img");
      image.src = file.url; image.alt = file.name; image.loading = "lazy";
      const name = node("span", file.name);
      card.append(check, image, name, node("small", `${Math.round(file.bytes / 1024)} KiB`));
      const edit = node("button", "Edit image…", "secondary");
      edit.type = "button";
      edit.disabled = !window.workbenchImages.supports(file.url);
      edit.title = edit.disabled ? "Editing supports JPG, PNG and WebP. SVG/GIF files can still be selected unchanged." : "";
      edit.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation();
        run(() => editPageImages({url: file.url}));
      });
      card.append(edit);
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
      row.dataset.workbenchFile = `static${entry.url}`;
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
      if (studio.mediaTarget?.kind === "images") {
        const use = node("button", `Use for ${studio.mediaTarget.title}`, "secondary");
        use.addEventListener("click", () => run(async () => assignMedia(entry.url)));
        controls.append(use);
      }
      for (const [label, path] of [["Card thumbnail", "thumbImg.image_path"], ["Page banner", "featuredImg.image_path"], ["Exact social image", "seo.social_image"], ["Generated-card background", "seo.featured_image"]]) {
        const button = node("button", label, "secondary");
        button.disabled = !studio.page.guided;
        button.addEventListener("click", () => {
          change(path, entry.url);
          renderForms();
          feedback(`${label} set to ${entry.url}. Save page to persist frontmatter.`);
        });
        controls.append(button);
      }
      if (studio.page.guided && activePath().startsWith("tanfolyamok/")) {
        const flyer = node("button", "Add course flyer", "secondary");
        flyer.addEventListener("click", () => run(async () => {
          const list = currentMeta().flyer_images || [];
          if (!Array.isArray(list)) throw new Error("Invalid flyer_images data. Fix it in Full source.");
          if (list.some(item => item.image_path === entry.url)) throw new Error("This image is already a flyer on this course.");
          change("flyer_images", [...list, { image_path: entry.url }]);
          renderForms();
          feedback("Course flyer added. It does not replace the banner. Save page to keep it.");
        }));
        controls.append(flyer);
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

  function pdfStatus(message, error = false) {
    const element = $("#pdf-import-status");
    element.hidden = !message;
    element.textContent = message;
    element.className = `notice${error ? " error" : ""}`;
  }

  function updatePDFSource() {
    const upload = $("#pdf-import-source").value === "upload";
    $("#pdf-import-upload").hidden = !upload;
    $("#pdf-import-existing").hidden = upload;
  }

  async function discardPDFImport() {
    if (studio.busy) throw new Error("Wait for the current PDF operation.");
    if (studio.pdfImport) await api(rootAPI + `pdf-import/${studio.pdfImport.id}`, { method: "DELETE" });
    studio.pdfImport = null;
    studio.pdfApplied = false;
    $("#pdf-import-review").hidden = true;
    $("#pdf-import-images").replaceChildren();
    $("#pdf-import-text").value = "";
    $("#pdf-import-discard").disabled = true;
    pdfStatus("Temporary extraction discarded. Any previously exported site files are kept.");
  }

  async function readPDFImport() {
    if (!studio.page || studio.busy) throw new Error("Open a page and wait for current operations first.");
    await sync();
    const path = activePath();
    const upload = $("#pdf-import-source").value === "upload";
    const file = $("#pdf-import-file").files[0];
    const url = $("#pdf-import-url").value.trim();
    if (upload && (!file || !file.size || file.size > 64 * 1024 * 1024)) throw new Error("Choose a non-empty PDF up to 64 MiB.");
    if (!upload && !url.startsWith("/pdfs/")) throw new Error("Choose an existing site PDF first.");
    if (studio.pdfImport) await discardPDFImport();
    setBusy(true);
    pdfStatus("Reading PDF locally… Extracting embedded text, joining photo strips and preparing image previews. No site files are being written.");
    try {
      const result = upload ?
        await api(rootAPI + "pdf-import", { method: "POST", raw: file, filename: file.name, contentPath: path }) :
        await api(rootAPI + "pdf-import/inspect", { method: "POST", payload: { path, url } });
      studio.pdfImport = result;
      result.reviewed = {}; result.reviewedDone = [];
      studio.pdfApplied = false;
      $("#pdf-import-summary").textContent = `${result.filename} · ${result.pages.length} pages · ${result.images.length} photos`;
      $("#pdf-import-text").value = result.markdown;
      $("#pdf-import-warnings").textContent = result.warnings.join("\n");
      $("#pdf-import-images").replaceChildren();
      $("#pdf-import-cover").replaceChildren(new Option("Keep the current page photos", ""));
      for (const image of result.images) {
        const card = node("label", "", "pdf-import-image");
        const preview = document.createElement("img");
        preview.src = image.preview;
        preview.alt = `Extracted image ${image.number} from PDF page ${image.page}`;
        preview.loading = "lazy";
        const line = node("span", "", "check-label");
        const check = document.createElement("input");
        check.type = "checkbox";
        check.value = image.id;
        check.checked = true;
        check.addEventListener("change", renderPDFOutputs);
        line.append(check, node("span", `Page ${image.page} · photo ${image.number}`));
        card.append(preview, line, node("small", `${image.width} × ${image.height}${image.parts > 1 ? ` · ${image.parts} joined strips` : ""}`));
        $("#pdf-import-images").append(card);
      }
      $("#pdf-import-review").hidden = false;
      $("#pdf-import-discard").disabled = false;
      renderPDFOutputs();
      pdfStatus("Extraction ready. Select photos, prepare them in the shared image editor, then review the saved versions before adding the story.");
    } catch (error) {
      pdfStatus(error.message, true);
      throw error;
    } finally { setBusy(false); }
  }

  function selectedPDFImages() {
    return [...$("#pdf-import-images").querySelectorAll("input:checked")].map(input => input.value);
  }

  function renderPDFOutputs() {
    if (!studio.pdfImport) return;
    const extraction = studio.pdfImport, selected = selectedPDFImages();
    const done = extraction.reviewedDone || [];
    const incomplete = selected.filter(id => !done.includes(id));
    const partial = incomplete.filter(id => extraction.reviewed[id]?.length);
    const cover = $("#pdf-import-cover").value;
    const options = [new Option("Keep the current page photos", "")], cards = [];
    for (const id of selected) {
      const source = extraction.images.find(image => image.id === id);
      for (const [index, file] of (extraction.reviewed[id] || []).entries()) {
        const title = `Page ${source.page} · photo ${source.number} · version ${index + 1}`;
        options.push(new Option(`${title} — ${file.url.split("/").pop()}`, file.url));
        const card = node("div", "", "pdf-import-image"), image = node("img", "");
        image.src = file.url; image.alt = title; image.loading = "lazy";
        card.append(image, node("strong", title), node("small", `${file.width} × ${file.height}`), node("code", file.url));
        cards.push(card);
      }
    }
    $("#pdf-import-cover").replaceChildren(...options);
    $("#pdf-import-cover").value = options.some(option => option.value === cover) ? cover : "";
    $("#pdf-import-outputs").replaceChildren(...cards);
    $("#pdf-import-output-summary").textContent = `${selected.length - incomplete.length} of ${selected.length} selected source photos reviewed · ${cards.length} saved versions.${incomplete.length ? " Prepare the remaining photos before adding them to the draft." : " Ready to add to the draft."}`;
    $("#pdf-import-prepare").disabled = studio.pdfApplied || !incomplete.length || Boolean(partial.length);
    $("#pdf-import-apply").disabled = studio.pdfApplied || Boolean(incomplete.length);
    $("#pdf-import-use-saved").hidden = !partial.length || studio.pdfApplied;
  }

  async function preparePDFPhotos() {
    const extraction = studio.pdfImport;
    if (!extraction || studio.pdfApplied || studio.busy) throw new Error("Extract a PDF and finish the current operation first.");
    if (activePath() !== extraction.path) throw new Error("The page path changed. Extract the PDF again for this destination.");
    const selected = selectedPDFImages();
    const pending = selected.filter(id => !extraction.reviewedDone.includes(id));
    if (pending.some(id => extraction.reviewed[id]?.length)) throw new Error("Some versions are already saved. Use the saved versions below, or discard this extraction; reopening those originals could create duplicates.");
    const settings = {};
    for (const key of ["width", "height", "quality"]) {
      if (!$(`#pdf-import-${key}`).reportValidity()) throw new Error(`Check PDF image ${key}.`);
      settings[key] = Number($(`#pdf-import-${key}`).value);
    }
    await sync();
    setBusy(true);
    const branch = state.git.branch;
    const validate = () => {
      if (studio.pdfImport !== extraction || activePath() !== extraction.path || state.git.branch !== branch)
        throw new Error("The PDF destination changed. Saved photos remain in their original page folder; extract again for the current page.");
    };
    try {
      for (let offset = 0; offset < pending.length; offset += 100) {
        const batch = pending.slice(offset, offset + 100), files = [], names = new Map();
        for (const [index, id] of batch.entries()) {
          validate();
          pdfStatus(`Reading photo ${offset + index + 1} of ${pending.length}. Next: crop, resize, adjust tones and choose the exact versions to save.`);
          const source = extraction.images.find(image => image.id === id);
          const response = await fetch(source.preview);
          if (!response.ok) throw new Error(`Could not read PDF photo ${source.number} (HTTP ${response.status}). Try preparing the remaining photos again.`);
          const file = new File([await response.blob()], `pdf-${id}.png`, {type: "image/png"});
          files.push(file); names.set(file.name, id);
        }
        validate();
        const outcome = await window.workbenchImages.open({
          files, folder: extraction.folder, settings, context: {kind: "page", path: extraction.path}, validate,
          title: `Prepare PDF photos · batch ${Math.floor(offset / 100) + 1} of ${Math.ceil(pending.length / 100)}`,
        });
        for (const result of outcome.results) {
          const id = names.get(result.sourceName);
          if (!id) throw new Error("A saved image could not be matched to its PDF source. No story was inserted; the saved files remain in the page folder.");
          extraction.reviewed[id] ||= [];
          extraction.reviewed[id].push(...result.files);
        }
        for (const name of outcome.completedNames) {
          const id = names.get(name);
          if (!id) throw new Error("A reviewed photo could not be matched to its PDF source. No story was inserted.");
          if (!extraction.reviewedDone.includes(id)) extraction.reviewedDone.push(id);
        }
        validate();
        renderPDFOutputs();
        if (batch.some(id => !extraction.reviewedDone.includes(id))) {
          pdfStatus(`Photo preparation stopped. No story was inserted. Already saved versions are shown below. ${outcome.sourceErrors?.join(" ") || "Prepare the remaining photos, or explicitly use saved versions if an unfinished source has partial results."}`, Boolean(outcome.sourceErrors?.length || outcome.results.length));
          return;
        }
      }
      pdfStatus("Photos are saved and reviewed. Inspect the exact outputs below, choose a heading version if needed, then Add reviewed result to draft. The page itself is still unsaved.");
    } catch (error) { pdfStatus(error.message, true); throw error; }
    finally { setBusy(false); renderPDFOutputs(); }
  }

  async function applyPDFImport() {
    if (!studio.pdfImport || studio.pdfApplied || studio.busy) throw new Error("Extract a PDF first, or discard the completed extraction to start another.");
    const extraction = studio.pdfImport;
    if (activePath() !== extraction.path) throw new Error("The page path changed. Extract the PDF again for this destination.");
    const selected = selectedPDFImages();
    if (selected.some(id => !extraction.reviewedDone?.includes(id))) throw new Error("Prepare all selected photos in the shared image editor before adding the reviewed result.");
    const images = selected.filter(id => extraction.reviewed[id]?.length);
    const cover = $("#pdf-import-cover").value;
    if (cover && !images.some(id => extraction.reviewed[id].some(file => file.url === cover))) throw new Error("Select the chosen heading photo for export, or keep the current page photos.");
    const mode = $("#pdf-import-mode").value;
    if (mode === "images" && !images.length) throw new Error("Select at least one photo to export.");
    if (mode === "replace" && !confirm("Replace this draft's story with extracted PDF text and selected photos? Metadata is kept. The saved page stays unchanged until you save.")) return;
    const payload = { id: extraction.id, path: activePath(), images,
      image_files: Object.fromEntries(images.map(id => [id, extraction.reviewed[id].map(file => file.url)])),
      keep_pdf: $("#pdf-import-keep-pdf").checked };
    for (const key of ["width", "height", "quality"]) {
      if (!$(`#pdf-import-${key}`).reportValidity()) throw new Error(`Check PDF image ${key}.`);
      payload[key] = Number($(`#pdf-import-${key}`).value);
    }
    await sync();
    if (mode === "append" && extraction.pdf_url && $("#post-body").value.includes(extraction.pdf_url)) {
      payload.keep_pdf = false;
    }
    setBusy(true);
    pdfStatus("Checking the reviewed photos and preparing the extracted story. Already saved image versions will not be converted again.");
    try {
      const result = await api(rootAPI + "pdf-import/export", { method: "POST", payload });
      if (studio.pdfImport !== extraction || activePath() !== extraction.path) throw new Error("The PDF destination changed. No extracted story was inserted; saved files remain in their original folder.");
      if (cover && !result.images.some(file => file.url === cover)) throw new Error("The chosen heading version was not returned. Review the saved photos before adding the story again.");
      if (mode !== "images") {
        const body = $("#post-body");
        body.value = mode === "replace" ? result.markdown : `${body.value.trimEnd()}\n\n${result.markdown}`;
      }
      if (cover) {
        change("thumbImg.image_path", cover);
        change("featuredImg.image_path", cover);
      }
      studio.pdfApplied = true;
      $("#pdf-import-apply").disabled = true;
      $("#pdf-import-text").value = result.markdown;
      markDirty();
      const message = `${result.images.length} WebP photos exported to ${result.folder}. ${mode === "images" ? "Story kept." : "Extracted story added to the unsaved draft."} Review image descriptions and formatting, preview, then save explicitly.`;
      pdfStatus(message);
      feedback(message);
    } catch (error) {
      pdfStatus(error.message, true);
      throw error;
    } finally { setBusy(false); }
  }
  async function editPageImages({files, url, field} = {}) {
    const path = activePath(), folder = updateOwnedMediaFolders();
    const settings = {name: files?.length === 1 ? $("#content-image-name").value.trim() : ""};
    for (const key of ["width", "height", "quality"]) {
      const input = $(`#content-image-${key}`);
      if (!input.reportValidity()) throw new Error(`Check image ${key}.`);
      settings[key] = Number(input.value);
    }
    const outcome = await window.workbenchImages.open({files, url, field, folder, settings,
      context: {kind: "page", path}, title: field ? `Prepare ${field}` : "Prepare page photos",
      validate() { if (activePath() !== path) throw new Error("The open page changed. Reopen the image editor for that page."); }});
    for (const result of outcome.results) for (const image of result.files) {
      if (!field) studio.selected.set(image.url, {...studio.selected.get(image.url), ...image,
        name: decodeURIComponent(image.url.split("/").pop()), alt: studio.selected.get(image.url)?.alt || "",
        caption: studio.selected.get(image.url)?.caption || ""});
    }
    if (outcome.results.length) {
      $("#post-image-folder").value = folder; $("#page-media-image-folder").value = folder; $("#asset-folder").value = folder;
      await browseAssets();
      $("#content-conversion-results").textContent = outcome.results.flatMap(result => result.files.map(image => image.url)).join("\n");
      feedback(`Reviewed WebP outputs saved. Page assignments and story changes remain an unsaved draft.${outcome.sourceErrors?.length ? `\n${outcome.sourceErrors.join("\n")}\nChoose the failed sources again to retry.` : ""}`, Boolean(outcome.sourceErrors?.length));
      persistDraft();
    }
    if (!outcome.results.length && outcome.sourceErrors?.length) feedback(outcome.sourceErrors.join("\n"), true);
    return outcome;
  }

  async function convertImages() {
    const input = $("#content-image-files");
    const files = [...input.files];
    if (!files.length) throw new Error("Choose original photos first.");
    for (const file of files) {
      if (!file.size || file.size > 30 * 1024 * 1024) throw new Error(`${file.name}: choose a non-empty image up to 30 MiB.`);
    }
    const name = $("#content-image-name").value.trim();
    if (name && files.length !== 1) throw new Error("Custom output name is for a single photo. Leave it blank for a batch.");
    const outcome = await editPageImages({files});
    const transfer = new DataTransfer();
    outcome.remainingFiles.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    renderUploadPreviews(input);
  }

  async function refreshPageMedia() {
    const payload = await sync();
    $("#page-media-status").textContent = "Checking files and saved references…";
    $("#page-media-files").replaceChildren();
    studio.pageMedia = [];
    let result;
    try {
      result = await api(rootAPI + "page-media", { method: "POST", payload: {
        source: payload.source, folder: $("#page-media-image-folder").value.trim(),
        pdf_folder: $("#page-media-pdf-folder").value.trim()
      } });
    } catch (error) {
      $("#page-media-status").textContent = `Could not refresh files: ${error.message}`;
      throw error;
    }
    studio.pageMedia = result.files;
    for (const [kind, folders] of [["image", result.image_folders], ["pdf", result.pdf_folders]]) {
      $(`#page-media-${kind}-folders`).replaceChildren(...folders.map(folder => {
        const button = node("button", folder.split("/").pop(), "secondary");
        button.addEventListener("click", () => run(async () => {
          $(`#page-media-${kind}-folder`).value = folder;
          await refreshPageMedia();
        }));
        return button;
      }));
    }
    renderPageMedia();
  }

  function renderPageMedia() {
    const search = $("#page-media-search").value.toLocaleLowerCase();
    const files = studio.pageMedia.filter(file => file.url.toLocaleLowerCase().includes(search));
    $("#page-media-files").replaceChildren();
    for (const file of files) {
      const row = node("section", "", "page-media-file");
      const image = file.kind === "images" && !file.missing ? document.createElement("img") : node("strong", file.kind === "pdfs" ? "PDF" : "Missing");
      if (image.tagName === "IMG") { image.src = file.url; image.alt = file.name; image.loading = "lazy"; }
      const details = node("div", "");
      details.append(node("code", file.url));
      details.dataset.workbenchFile = `static${file.url}`;
      const owned = file.url.startsWith(`/${file.kind}/${encodeURI(pageAssetFolder({ path: activePath() }))}/`);
      details.append(node("p", owned ? "Page-owned file" : "Borrowed / external-folder file · stays in its original folder", "hint"));
      details.append(node("p", file.linked ? "Used in this page draft" : "Connected folder file · not used in this page draft", "hint"));
      details.append(node("p", file.missing ? file.error : file.references.length ?
        `Saved references: ${file.references.join(", ")}` : "No saved references found.", "hint"));
      const actions = node("div", "", "actions");
      const open = node("a", "Open file ↗", "button secondary");
      open.href = file.url; open.target = "_blank"; open.rel = "noopener";
      if (!file.missing) actions.append(open);
      if (file.linked) {
        const remove = node("button", "Remove from page…", "secondary");
        remove.addEventListener("click", () => run(async () => reviewMediaRemoval(file.url)));
        actions.append(remove);
        const find = node("button", "Find in source", "secondary");
        find.addEventListener("click", () => run(async () => findMediaReference(file.url)));
        actions.append(find);
      }
      const removeFile = node("button", "Delete file permanently…", "secondary danger");
      removeFile.disabled = file.missing || file.linked || file.references.length > 0;
      removeFile.title = removeFile.disabled ? "Remove and save all references before deleting the file." : "Deletes only this file, not the page.";
      removeFile.addEventListener("click", () => reviewAssetDeletion(file));
      actions.append(removeFile);
      details.append(actions);
      row.append(image, details);
      $("#page-media-files").append(row);
    }
    $("#page-media-status").textContent = `${files.length} files shown · ${studio.pageMedia.filter(file => file.linked).length} linked to this draft.`;
  }

  async function findMediaReference(url) {
    await showTab("source");
    const input = $("#post-source");
    let start = input.value.indexOf(url);
    if (start < 0) start = input.value.indexOf(decodeURIComponent(url));
    if (start < 0) throw new Error("This reference changed. Refresh Page media.");
    input.focus();
    input.setSelectionRange(start, start + (input.value.startsWith(url, start) ? url.length : decodeURIComponent(url).length));
    feedback("Reference selected in Full source. Edit or remove its surrounding image/link/layout, then return to Page media to review.");
  }

  async function reviewMediaRemoval(url) {
    const payload = await sync();
    const result = await api(rootAPI + "remove-reference", { method: "POST", payload: { source: payload.source, url } });
    studio.mediaReview = { ...result, original: payload.source, path: payload.path, url };
    $("#remove-media-url").textContent = url;
    $("#remove-media-summary").textContent = result.removed.length ?
      `Will remove: ${result.removed.join(", ")}. The file stays on disk.` : "No automatically removable assignment found. Use Find in source to edit this custom reference.";
    $("#remove-media-remaining").hidden = !result.remaining;
    $("#remove-media-source").value = result.source;
    $("#remove-media-apply").disabled = result.source === payload.source;
    $("#remove-media-dialog").showModal();
  }

  async function applyMediaRemoval() {
    const review = studio.mediaReview;
    const payload = await sync();
    if (!review || payload.path !== review.path || payload.source !== review.original) throw new Error("The page changed during review. Cancel and review the removal again.");
    const composed = await api(rootAPI + "compose", { method: "POST", payload: { source: review.source, changes: {} } });
    studio.page = { ...studio.page, ...composed };
    studio.changes = {};
    $("#post-body").value = composed.body;
    $("#post-source").value = composed.source;
    $("#remove-media-dialog").close();
    studio.mediaReview = null;
    renderForms();
    markDirty();
    await refreshPageMedia();
    feedback("References removed from the draft only. Save page before deleting an unreferenced file. Custom references may still need source editing.");
  }

  function reviewAssetDeletion(file) {
    studio.assetDelete = file;
    $("#delete-media-url").textContent = file.url;
    $("#delete-media-confirm").value = "";
    $("#delete-media-error").hidden = true;
    $("#delete-media-dialog").showModal();
  }

  async function deleteMediaFile() {
    const file = studio.assetDelete;
    if (!file) throw new Error("Choose a file to review first.");
    $("#delete-media-apply").disabled = true;
    try {
      const payload = await sync();
      await api(rootAPI + "delete-asset", { method: "POST", payload: {
        url: file.url, revision: file.revision, confirm: $("#delete-media-confirm").value, source: payload.source
      } });
      studio.selected.delete(file.url);
      if ($("#insert-pdf-url").value === file.url) $("#insert-pdf-url").value = "";
      $("#delete-media-dialog").close();
      studio.assetDelete = null;
      await refreshPageMedia();
      feedback(`Deleted file: ${file.url}. The page was not deleted.`);
      notify(`Deleted file: ${file.url}. The page was not deleted.`);
    } catch (error) {
      $("#delete-media-error").textContent = error.message;
      $("#delete-media-error").hidden = false;
      throw error;
    } finally { $("#delete-media-apply").disabled = false; }
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
      details.dataset.workbenchFile = `static${asset.url}`;
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
    $("#content-editor").hidden = true; $("#content-resume").hidden = true;
    await refreshCatalog();
    showContentScreen("library");
    notify(`${result.message}\nDeleted ${result.deleted}${assets.length ? ` and ${assets.length} selected assets` : "; all assets kept"}.`);
  }

  function syntaxHelp() {
    const examples = [
      ["Headings, emphasis, lists & links", "## Section title\n\n**Bold** and *italic*.\n\n- First item\n- Second item\n\n[Another report](/turak/report/)\n\n> A quotation."],
      ["Ordered list & horizontal rule", "1. First step\n2. Second step\n\n---\n\nNext section."],
      ["Markdown table", "| Day | Location |\n| --- | --- |\n| 1 | Cave entrance |\n| 2 | Survey area |"],
      ["Highlighted quote · author and source optional", '{{< quote author="Quoted person" source="Book, letter or year" >}}\nThe quoted **Markdown** text.\n{{< /quote >}}'],
      ["Signature · right-aligned author line inside the text", "{{< signature >}}Author name{{< /signature >}}"],
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
    feedback("Choose this page's images or borrow existing files elsewhere. New uploads always go to the page-owned folder. Insert at the remembered Markdown cursor; gallery order follows the selected photos.");
  }

  async function initialize() {
    if (studio.initialized) return;
    studio.initialized = true;
    showContentScreen("library");
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
      $("#page-media-image-folder").value = updateOwnedMediaFolders();
      if (draft.editingSource) switchPanel("source");
      renderForms(); markDirty();
      feedback("Browser draft restored. It has not overwritten any disk file.");
    }
  }

  $("#post-body").addEventListener("input", markDirty);
  $("#media-picker-image-files").addEventListener("change", () => run(async () => {
    const target = studio.mediaTarget, files = [...$("#media-picker-image-files").files];
    if (!target || target.kind !== "images" || !files.length) return;
    const outcome = await editPageImages({files, field: target.title});
    if (studio.mediaTarget !== target) throw new Error("The destination field changed. Saved photos remain in the page folder.");
    $("#media-picker-image-files").value = "";
    renderUploadPreviews($("#media-picker-image-files"));
    if (outcome.primary) assignMedia(outcome.primary);
    if (outcome.sourceErrors?.length) feedback(`Some sources were not saved:\n${outcome.sourceErrors.join("\n")}\nChoose the failed sources again to retry. Already saved photos remain in this page's folder.`, true);
  }));
  $("#post-body").addEventListener("select", rememberCursor);
  $("#post-body").addEventListener("keyup", rememberCursor);
  $("#post-body").addEventListener("click", rememberCursor);
  $("#post-body").addEventListener("blur", rememberCursor);
  $("#post-source").addEventListener("input", () => {
    studio.page.source = $("#post-source").value.replaceAll("\n", studio.page.newline || "\n");
    markDirty();
  });
  $("#post-path").addEventListener("input", () => { updateOwnedMediaFolders(); markDirty(); });
  document.querySelectorAll("[data-editor-tab]").forEach(button => button.addEventListener("click", () => run(() => showTab(button.dataset.editorTab))));
  document.querySelectorAll("[data-editor-tool]").forEach(button => button.addEventListener("click", () => run(() => showTab(button.dataset.editorTool))));
  $("#editor-return-content").addEventListener("click", () => run(async () => showTab(studio.contentTab)));
  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  for (const selector of ["#content-search", "#content-sort", "#content-status-filter"]) $(selector).addEventListener("input", renderLibrary);
  $("#content-clear-filters").addEventListener("click", () => {
    $("#content-search").value = ""; $("#content-status-filter").value = ""; $("#content-sort").value = "date"; renderLibrary();
  });
  $("#refresh-content").addEventListener("click", () => run(refreshCatalog));
  $("#asset-refresh").addEventListener("click", () => run(browseAssets));
  $("#asset-root").addEventListener("click", () => run(async () => { $("#asset-folder").value = ""; await browseAssets(); }));
  $("#media-picker-refresh").addEventListener("click", () => run(browsePicker));
  $("#new-page").addEventListener("click", () => run(showNewPage));
  $("#back-content-library").addEventListener("click", () => {
    if (studio.searchOrigin) location.hash = "#search"; else showContentScreen("library");
  });
  $("#content-resume-page").addEventListener("click", () => { studio.searchOrigin = false; activateEditorRoute(); showContentScreen("editor"); });
  $("#content-back-search").addEventListener("click", () => { location.hash = "#search"; });
  $("#new-page-empty").addEventListener("click", () => run(showNewPage));
  $("#new-page-template").addEventListener("change", selectTemplate);
  $("#new-page-title").addEventListener("input", suggestNewSlug);
  $("#new-page-slug").addEventListener("input", () => { studio.newSlugTouched = true; });
  $("#new-page-slug").addEventListener("invalid", () => { $("#new-page-slug").closest("details").open = true; });
  $("#content-draft-save").addEventListener("click", () => run(async () => {
    await savePage();
    if (!studio.dirty) finishDraftDecision(true);
    else feedback("Your draft is still unsaved. Finish the save before continuing, or keep editing.", true);
  }));
  $("#content-draft-discard").addEventListener("click", () => finishDraftDecision(true));
  $("#content-draft-cancel").addEventListener("click", () => finishDraftDecision(false));
  $("#content-draft-dialog").addEventListener("cancel", event => { event.preventDefault(); finishDraftDecision(false); });
  $("#content-draft-dialog").addEventListener("close", () => {
    const resolve = studio.navigationResolve; studio.navigationResolve = null; if (resolve) resolve(false);
  });
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
    updateOwnedMediaFolders();
    $("#page-media-image-folder").value = $("#post-image-folder").value;
    persistDraft();
  });
  $("#use-page-folder").addEventListener("click", () => run(async () => {
    $("#asset-folder").value = updateOwnedMediaFolders(); await browseAssets();
  }));
  document.querySelectorAll("[data-open-page-media]").forEach(button => button.addEventListener("click", () => run(async () => showTab("page-media"))));
  $("#page-media-refresh").addEventListener("click", () => run(refreshPageMedia));
  $("#page-media-search").addEventListener("input", renderPageMedia);
  for (const kind of ["image", "pdf"]) {
    $(`#page-media-${kind}-parent`).addEventListener("click", () => run(async () => {
      const input = $(`#page-media-${kind}-folder`);
      input.value = input.value.replace(/\/$/, "").split("/").slice(0, -1).join("/");
      await refreshPageMedia();
    }));
  }
  $("#remove-media-apply").addEventListener("click", () => run(applyMediaRemoval));
  $("#delete-media-apply").addEventListener("click", () => run(deleteMediaFile));
  $("#browse-assets").addEventListener("click", () => run(browseAssets));
  $("#asset-search").addEventListener("input", renderAssets);
  $("#asset-parent").addEventListener("click", () => run(async () => {
    $("#asset-folder").value = $("#asset-folder").value.split("/").slice(0, -1).join("/"); await browseAssets();
  }));
  $("#content-convert").addEventListener("click", () => run(convertImages));
  $("#pdf-import-source").addEventListener("change", updatePDFSource);
  $("#pdf-import-borrow").addEventListener("click", () => run(async () => {
    await openMediaPicker("pdfs", "PDF to read", $("#pdf-import-url").value, url => { $("#pdf-import-url").value = url; });
  }));
  $("#pdf-import-read").addEventListener("click", () => run(readPDFImport));
  $("#pdf-import-discard").addEventListener("click", () => run(discardPDFImport));
  $("#pdf-import-apply").addEventListener("click", () => run(applyPDFImport));
  $("#pdf-import-prepare").addEventListener("click", () => run(preparePDFPhotos));
  $("#pdf-import-use-saved").addEventListener("click", () => {
    if (!studio.pdfImport || studio.busy) return;
    for (const id of selectedPDFImages()) if (studio.pdfImport.reviewed[id]?.length && !studio.pdfImport.reviewedDone.includes(id))
      studio.pdfImport.reviewedDone.push(id);
    renderPDFOutputs();
    pdfStatus("Only the already saved versions will be used for these partially completed photos. Any unsaved versions were omitted. Prepare other remaining photos before adding the draft.");
  });
  $("#pdf-import-download").addEventListener("click", () => {
    downloadWorkbenchDraft("pdf-extracted-text.md", $("#pdf-import-text").value);
  });
  for (const [id, checked] of [["#pdf-import-all", true], ["#pdf-import-none", false]]) {
    $(id).addEventListener("click", () => {
      $("#pdf-import-images").querySelectorAll("input").forEach(input => { input.checked = checked; });
      renderPDFOutputs();
    });
  }
  renderUploadPreviews($("#content-image-files"));
  const dropzone = $("#content-image-files").closest(".upload-drop-area");
  $("#content-image-files").addEventListener("change", () => renderUploadPreviews($("#content-image-files")));
  dropzone.addEventListener("dragover", event => { event.preventDefault(); dropzone.classList.add("dragging"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
  dropzone.addEventListener("drop", event => {
    event.preventDefault(); event.stopPropagation(); dropzone.classList.remove("dragging");
    if (studio.busy) {
      feedback("Wait for the current image operation before selecting more photos.", true);
      return;
    }
    $("#content-image-files").files = event.dataTransfer.files;
    renderUploadPreviews($("#content-image-files"));
    feedback(`${event.dataTransfer.files.length} original photos chosen. Review the destination, then click Convert.`);
  });
  $("#insert-photos").addEventListener("click", () => run(async () => insertPhotos()));
  $("#media-picker-browse").addEventListener("click", () => run(browsePicker));
  $("#media-picker-owned").addEventListener("click", () => run(async () => {
    $("#media-picker-folder").value = updateOwnedMediaFolders();
    await browsePicker();
  }));
  $("#media-picker-borrow").addEventListener("click", () => run(async () => {
    $("#media-picker-folder").value = studio.mediaTarget.borrowedFolder ?? "";
    await browsePicker();
  }));
  $("#media-picker-parent").addEventListener("click", () => run(async () => {
    $("#media-picker-folder").value = $("#media-picker-folder").value.replace(/\/$/, "").split("/").slice(0, -1).join("/");
    await browsePicker();
  }));
  $("#media-picker-search").addEventListener("input", renderPicker);
  $("#media-picker-cancel").addEventListener("click", cancelMediaPicker);
  $("#media-target-cancel").addEventListener("click", () => { cancelMediaPicker(); renderSelection(); });
  $("#media-picker").addEventListener("cancel", cancelMediaPicker);
  $("#media-picker").addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); cancelMediaPicker(); }
  });
  $("#media-picker-upload").addEventListener("click", () => run(async () => {
    const target = studio.mediaTarget;
    if (target.kind === "images") { $("#media-picker-image-files").click(); return; }
    updateOwnedMediaFolders();
    $("#media-picker").close();
    await showTab("media");
    $("#media-target-label").textContent = `Selecting a file for: ${target.title}. Convert/upload below, then assign it.`;
    $("#media-target").hidden = false;
    renderSelection();
    if (target.kind === "pdfs") {
      $("#pdf-file").closest("details").open = true;
      $("#pdf-file").focus();
    } else {
      $("#content-image-files").focus();
    }
  }));
  $("#choose-pdf").addEventListener("click", () => run(async () => {
    $("#pdf-file").closest("details").open = true;
    await openMediaPicker("pdfs", "PDF report", $("#insert-pdf-url").value, url => { $("#insert-pdf-url").value = url; });
  }));
  $("#insert-pdf").addEventListener("click", () => run(async () => {
    const url = $("#insert-pdf-url").value.trim();
    if (!url.startsWith("/pdfs/")) throw new Error("Use a local /pdfs/... URL.");
    insertText(`\n\n{{< pdf ${attr("src", url)} ${attr("title", $("#insert-pdf-title").value || "Full report")} >}}\n\n`);
  }));
  $("#upload-pdf").addEventListener("click", () => run(async () => {
    const file = $("#pdf-file").files[0];
    if (!file) throw new Error("Choose a PDF first.");
    if (!file.size || file.size > 30 * 1024 * 1024) throw new Error("Choose a non-empty PDF up to 30 MiB.");
    const result = await api(rootAPI + "pdf", { method: "POST", raw: file,
      filename: file.name, contentPath: activePath() });
    $("#insert-pdf-url").value = result.url;
    if (studio.mediaTarget?.kind === "pdfs") assignMedia(result.url);
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
    if (!await allowDiscard()) return;
    loadPage(await api(`${rootAPI}page?${new URLSearchParams({ path: studio.original })}`), true);
  }));
  document.querySelectorAll("[data-markdown]").forEach(button => button.addEventListener("click", () => {
    const area = $("#post-body"); const text = area.value.slice(...studio.selection) || "text";
    const snippets = { heading: `\n## ${text}\n`, bold: `**${text}**`, italic: `*${text}*`,
      link: `[${text}](/turak/)`, list: `\n- ${text}\n- Next item\n`,
      quote: `\n\n{{< quote >}}\n${area.value.slice(...studio.selection) || "Quoted text"}\n{{< /quote >}}\n\n`,
      day: "\n## N. nap - YYYY-MM-DD (weekday)\n\n" };
    insertText(snippets[button.dataset.markdown]);
  }));
  document.querySelectorAll("[data-content-guide]").forEach(button => button.addEventListener("click", () => run(async () => {
    const guide = await api(`${rootAPI}help?${new URLSearchParams({ document: button.dataset.contentGuide })}`);
    $("#content-guide").textContent = guide.source; $("#content-guide").hidden = false;
  })));
  searchableSelect($("#new-page-template"), "page templates");
  for (const input of document.querySelectorAll('input[list="image-folders"]')) {
    input.removeAttribute("list");
    attachSuggestions(input, {
      choices: () => (studio.catalog?.folders || []).map(folder => ({ label: folder })),
      select: item => {
        input.value = item.label;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
    });
  }
  window.workbenchContent = {openMatch: openSearchMatch};
  window.addEventListener("hashchange", () => {
    if ((location.hash !== "#content" && !location.hash.startsWith("#content/")) || !state.git?.editable) return;
    run(async () => {
      await initialize();
      renderCategoryNavigation();
      if (studio.routeEditing !== location.hash) showContentScreen("library");
      studio.routeEditing = "";
    });
  });
  window.addEventListener("beforeunload", event => {
    if (!studio.dirty) return;
    persistDraft(); event.preventDefault(); event.returnValue = "";
  });
  window.addEventListener("workbench-before-git", event => {
    if (studio.dirty) event.detail.blockers.push("Save or download and discard the open page draft first.");
    if (studio.busy) event.detail.busy.push("Wait for the current page operation.");
  });
  window.addEventListener("workbench-export-drafts", event => {
    if (!studio.dirty) return;
    event.detail.operations.push((async () => {
      const source = studio.tab === "source" ? $("#post-source").value :
        (await api(rootAPI + "compose", { method: "POST", payload: {
          source: bodySource(), changes: studio.changes,
        } })).source;
      downloadWorkbenchDraft(activePath().split("/").pop() || "page-draft.md", source, "text/markdown;charset=utf-8");
    })());
  });
  window.addEventListener("workbench-discard-drafts", () => {
    if (!studio.dirty) return;
    localStorage.removeItem("ftsk-content-draft");
    studio.dirty = false;
    studio.page = null;
    studio.original = "";
    studio.changes = {};
    studio.selected.clear();
    $("#content-editor").hidden = true;
    $("#content-resume").hidden = true;
    showContentScreen("library");
  });
  window.addEventListener("keydown", event => {
    if ((location.hash !== "#content" && !location.hash.startsWith("#content/")) || studio.screen !== "editor" ||
        !studio.page || document.querySelector("dialog[open]")) return;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") { event.preventDefault(); run(renderPreview); }
  });
  window.addEventListener("workbench-status", event => {
    if (state.token && !studio.initialized) run(initialize);
    previewStatus(event.detail);
  });
  window.addEventListener("workbench-members-changed", event => {
    if (!studio.catalog) return;
    studio.catalog.members = event.detail.members;
    studio.catalog.people = event.detail.people;
    studio.catalog.role_catalog = event.detail.role_catalog;
    renderMemberNames();
    refreshPeoplePickers();
    if (studio.page && !studio.page.error) renderContactAssignments();
    if (studio.page && !studio.page.error) renderAssignments();
    if (event.detail.merged || event.detail.renamed) run(async () => {
      await refreshCatalog();
      feedback(`${event.detail.renamed ? "Person ID changed" : "People merged"} and saved page catalog refreshed. Your open draft was kept unchanged: reload its saved page or manually replace any old source IDs before saving. Unsaved drafts are not rewritten.`);
    });
  });
  window.addEventListener("workbench-open-page", event => run(async () => {
    const path = event.detail.path.replace(/^content\//, "");
    await openPage(path);
    if (studio.original === path) {
      const section = path.includes("/") ? path.split("/")[0] : "pages";
      const route = `#content/${encodeURIComponent(section)}`;
      if (location.hash !== route) { studio.routeEditing = route; location.hash = route; }
    }
  }));
  syntaxHelp();
})();
