"use strict";

(() => {
  const studio = {
    catalog: null, page: null, original: "", revision: "", savedSource: "", savedPath: "",
    changes: {}, tab: "write", contentTab: "write", helpOrigin: "", dirty: false, busy: false, selection: [0, 0],
    assets: [], selected: new Map(), deletePlan: null, previewSource: "", previewPath: "",
    previewURL: "", previewID: "", initialized: false, lastJob: "idle", restoreKey: "",
    mediaTarget: null, pickerFiles: [], pageMedia: [], mediaReview: null, assetDelete: null
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
  function pageAssetFolder(page) {
    return suggestedFolder(page.path);
  }
  function updateOwnedMediaFolders() {
    const folder = pageAssetFolder({ path: activePath() });
    for (const selector of ["#post-image-folder", "#content-image-folder", "#pdf-folder"]) $(selector).value = folder;
    return folder;
  }

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
      if (path === "featuredImg.width") input.step = "any";
      if (["list", "textarea"].includes(type)) input.rows = type === "list" ? 5 : 3;
      input.value = type === "list" ? (get(meta, path) || []).join("\n") : (get(meta, path) ?? "");
      if (placeholder) input.placeholder = placeholder;
      wrapper.append(input);
    }
    input.addEventListener("input", () => {
      const value = type === "boolean" ? input.checked : type === "list" ?
        input.value.split("\n").map(line => line.trim()).filter(Boolean) :
        type === "number" ? (input.value ? Number(input.value) : null) : input.value;
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
        await openMediaPicker("images", title, input.value, url => onChange(path, url));
      }));
      wrapper.append(choose);
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
    renderLibrary();
  }

  function renderMemberNames() {
    $("#member-names").replaceChildren(...(studio.catalog.members || []).map(name => {
      const option = document.createElement("option"); option.value = name; return option;
    }));
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
    $("#content-empty").hidden = true;
    $("#content-editor").hidden = false;
    $("#post-path").value = page.path;
    $("#post-body").value = page.body;
    $("#post-source").value = page.source;
    $("#post-image-folder").value = pageAssetFolder(page);
    $("#content-image-folder").value = $("#post-image-folder").value;
    $("#pdf-folder").value = pageAssetFolder(page);
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
    $("#editor-content-navigation").hidden = !content;
    $("#editor-tool-heading").hidden = content;
    $("#editor-tool-title").textContent = {
      "page-media": "Files & usage", media: "Add images & PDFs",
      placement: "File & URL placement", source: "Full source",
      preview: "Whole-page preview", syntax: "Syntax help"
    }[tab] || "";
    const back = $(`[data-editor-tab="${studio.contentTab}"]`);
    $("#editor-return-content").disabled = Boolean(back?.disabled);
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
      feedback([`Saved ${result.path}.`, ...(result.warnings || [])].join("\n"));
      await refreshCatalog();
    } finally { setBusy(false); }
    if (studio.tab === "page-media") await refreshPageMedia();
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
    $("#media-picker").showModal();
    await browsePicker();
  }

  async function browsePicker() {
    const target = studio.mediaTarget;
    if (!target) return;
    $("#media-picker-status").textContent = "Loading files…";
    studio.pickerFiles = [];
    $("#media-picker-files").replaceChildren();
    $("#media-picker-folders").replaceChildren();
    try {
      const folder = $("#media-picker-folder").value.trim().replace(/\/$/, "");
      const result = await api(`/api/workbench/assets?${new URLSearchParams({ folder, kind: target.kind })}`);
      if (studio.mediaTarget !== target || $("#media-picker-folder").value.trim().replace(/\/$/, "") !== folder) return;
      studio.pickerFiles = result.files;
      $("#media-picker-folders").replaceChildren(...result.folders.map(name => {
        const button = node("button", name.split("/").pop(), "secondary");
        button.addEventListener("click", () => run(async () => {
          $("#media-picker-folder").value = name;
          await browsePicker();
        }));
        return button;
      }));
      renderPicker();
    } catch (error) {
      $("#media-picker-status").textContent = `Could not load files: ${error.message}`;
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
      if (studio.mediaTarget.kind === "images") {
        const image = document.createElement("img");
        image.src = file.url; image.alt = file.name; image.loading = "lazy";
        button.append(image);
      } else button.append(node("strong", "PDF"));
      button.append(node("span", file.name), node("small", `${Math.round(file.bytes / 1024)} KiB`));
      button.addEventListener("click", () => run(async () => assignMedia(file.url)));
      $("#media-picker-files").append(button);
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

  async function convertImages() {
    const input = $("#content-image-files");
    const files = [...input.files];
    if (!files.length) throw new Error("Choose original photos first.");
    for (const file of files) {
      if (!file.size || file.size > 30 * 1024 * 1024) throw new Error(`${file.name}: choose a non-empty image up to 30 MiB.`);
    }
    const folder = updateOwnedMediaFolders();
    const name = $("#content-image-name").value.trim();
    if (name && files.length !== 1) throw new Error("Custom output name is for a single photo. Leave it blank for a batch.");
    const settings = { path: activePath(), folder, name };
    for (const key of ["width", "height", "quality"]) {
      const field = $(`#content-image-${key}`);
      if (!field.reportValidity()) throw new Error(`Check image ${key}.`);
      settings[key] = Number(field.value);
    }
    const failures = [];
    setBusy(true);
    $("#content-convert").disabled = true;
    const results = [];
    const progress = conversionProgress("content-convert", files.length);
    let finished = false;
    try {
      for (const [index, file] of files.entries()) {
        let entry;
        let converted = false;
        $("#content-conversion-results").textContent = `Converting ${index + 1}/${files.length}: ${file.name}`;
        progress.update(index, `Uploading ${file.name}…`);
        try {
          entry = await api("/api/workbench/uploads", { method: "POST", raw: file, filename: file.name });
          progress.update(index, `Converting ${file.name}…`);
          const result = await api(rootAPI + "convert", { method: "POST", payload: { ...settings, id: entry.id } });
          for (const image of result.files) {
            const item = { ...image, name: image.url.split("/").pop(), alt: "", caption: "" };
            studio.selected.set(image.url, item);
            results.push(image.url);
          }
          converted = true;
        } catch (error) { failures.push(`${file.name}: ${error.message}`); }
        finally {
          progress.update(index, `Cleaning up ${file.name}…`);
          if (entry) {
            try { await api(`/api/workbench/uploads/${entry.id}`, { method: "DELETE" }); }
            catch (error) { failures.push(`${file.name}: ${converted ? "Export succeeded, but temporary original cleanup failed" : "Temporary original cleanup failed"}: ${error.message}`); }
          }
        }
        progress.update(index + 1, `${results.length} converted files${failures.length ? ` · ${failures.length} errors` : ""}`);
      }
      $("#post-image-folder").value = folder;
      $("#page-media-image-folder").value = folder;
      $("#asset-folder").value = folder;
      progress.update(files.length, "Refreshing page media…");
      await browseAssets();
      $("#content-conversion-results").textContent = [`${results.length} converted files:`, ...results, ...failures].join("\n");
      feedback(failures.length ? failures.join("\n") : "Photos converted into your chosen folder and selected. Set image metadata or insert them into the story.", failures.length > 0);
      input.value = "";
      persistDraft();
      progress.finish(`${results.length} converted files.${failures.length ? " Some operations failed; see errors below." : " Ready to use."}`, failures.length > 0);
      finished = true;
    } finally {
      if (!finished) progress.finish("Image operation interrupted. Check the error and any exported files.", true);
      $("#content-convert").disabled = false;
      setBusy(false);
    }
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
    feedback("Choose this page's images or borrow existing files elsewhere. New uploads always go to the page-owned folder. Insert at the remembered Markdown cursor; gallery order follows the selected photos.");
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
      $("#page-media-image-folder").value = updateOwnedMediaFolders();
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
  $("#post-path").addEventListener("input", () => { updateOwnedMediaFolders(); markDirty(); });
  document.querySelectorAll("[data-editor-tab]").forEach(button => button.addEventListener("click", () => run(() => showTab(button.dataset.editorTab))));
  document.querySelectorAll("[data-editor-tool]").forEach(button => button.addEventListener("click", () => run(() => showTab(button.dataset.editorTool))));
  $("#editor-return-content").addEventListener("click", () => run(async () => showTab(studio.contentTab)));
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
  const dropzone = $("#content-image-files").closest(".dropzone");
  dropzone.addEventListener("dragover", event => { event.preventDefault(); dropzone.classList.add("dragging"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
  dropzone.addEventListener("drop", event => {
    event.preventDefault(); dropzone.classList.remove("dragging");
    $("#content-image-files").files = event.dataTransfer.files;
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
    $("#content-empty").hidden = false;
    renderLibrary();
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
    if (studio.original === path) location.hash = "#content";
  }));
  syntaxHelp();
})();
