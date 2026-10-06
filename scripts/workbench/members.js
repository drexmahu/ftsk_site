"use strict";

const memberState = { catalog: null, original: null, editing: false, dirty: false, busy: false, loading: false, historySearch: "", roles: [], socialLinks: [] };
const roleState = { dirty: false, selected: "", revision: "" };
const memberFields = ["id", "name", "nickname", "role", "bio", "image", "modal_image", "email", "phone"];
let portraitDeletionPlan = null;
let memberMergePlan = null;
let memberRenamePlan = null;

function acceptMemberCatalog(catalog, merged = false, renamed = false) {
  memberState.catalog = catalog;
  const members = catalog.people.filter(person => person.membership).map(person =>
    person.name + (person.nickname ? ` (${person.nickname})` : ""));
  window.dispatchEvent(new CustomEvent("workbench-members-changed", { detail: { people: catalog.people, members, role_catalog: catalog.role_catalog, merged, renamed } }));
  renderCategoryManager();
  if (!roleState.dirty) renderRoleManager();
}

function memberDraft() {
  if (memberState.dirty) {
    clearMemberMergePlan();
    clearMemberRenamePlan();
  }
  $("#member-draft").textContent = memberState.dirty ? "Unsaved draft" : "Saved";
  $("#portrait-member-target").textContent = memberState.editing ?
    `Converted portraits will fill the draft for ${$("#member-name").value || "this new person"}. Save person afterwards.` :
    "Standalone export: select or add a person above to assign a portrait.";
  memberControls();
}

function memberPreview() {
  for (const [field, id] of [["image", "member-avatar"], ["modal_image", "member-full"]]) {
    const value = $(`#member-${field}`).value.trim();
    const image = $(`#${id}`);
    image.hidden = !value.startsWith("/images/");
    if (!image.hidden) image.src = value;
    else image.removeAttribute("src");
  }
}

function renderMemberSocialLinks() {
  $("#member-social-links").replaceChildren(...memberState.socialLinks.map((url, index) => {
    const row = node("div", "", "actions");
    const label = node("label", `Social link ${index + 1}`);
    label.style.flex = "1";
    const input = node("input");
    input.type = "url";
    input.value = url;
    input.placeholder = "https://www.instagram.com/your-profile/";
    input.maxLength = 2000;
    input.setAttribute("aria-label", `Social link ${index + 1}`);
    input.addEventListener("input", () => {
      memberState.socialLinks[index] = input.value;
      memberState.dirty = true;
      memberDraft();
    });
    const remove = node("button", "Remove", "secondary");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove social link ${index + 1}`);
    remove.addEventListener("click", () => {
      memberState.socialLinks.splice(index, 1);
      memberState.dirty = true;
      renderMemberSocialLinks();
      memberDraft();
      $("#member-social-add").focus();
    });
    label.append(input);
    row.append(label, remove);
    return row;
  }));
}

function memberControls() {
  const busy = memberState.busy || state.busy || memberState.loading || !state.token || state.git?.editable === false;
  $("#member-fields").disabled = busy;
  $("#member-new").disabled = busy || !memberState.catalog;
  $("#member-resume").hidden = !memberState.editing;
  $("#member-resume").disabled = busy;
  $("#portrait-standalone").disabled = busy;
  $("#person-dialog-close").disabled = busy;
  $("#member-refresh").disabled = busy;
  $("#category-fields").disabled = busy || memberState.dirty || !memberState.catalog;
  $("#participant-role-fields").disabled = busy || memberState.dirty || !memberState.catalog;
  $("#participant-role-discard").disabled = busy;
  $("#member-merge-plan").disabled = busy || memberState.dirty || !$("#member-merge-target").value;
  $("#member-merge-confirm").disabled = busy || memberState.dirty || !memberMergePlan;
  $("#member-rename-plan").disabled = busy || memberState.dirty || !memberState.original || !$("#member-rename-target").value.trim();
  $("#member-rename-confirm").disabled = busy || memberState.dirty || !memberRenamePlan;
  document.querySelectorAll("#member-list button").forEach(button => { button.disabled = busy; });
  document.querySelectorAll("#member-overview button, #member-overview input").forEach(control => { control.disabled = busy; });
  document.querySelectorAll("#member-audit button, #member-audit input").forEach(control => { control.disabled = busy; });
  $("#member-files-confirm").disabled = busy;
  $("#member-files-cancel").disabled = memberState.busy;
  document.querySelectorAll("#member-files-review input").forEach(input => {
    const file = portraitDeletionPlan?.files.find(file => file.url === input.value);
    input.disabled = busy || Boolean(file?.references.length);
  });
  renderMemberDeletion();
}

function memberDeletionReasons() {
  const person = memberState.catalog?.people.find(person => person.id === memberState.original?.id);
  const reasons = [];
  if (!person) reasons.push("Save and select an existing person first.");
  if (person?.membership) reasons.push(`Current member — ${person.membership.label}. Remove membership in the draft and save first; the identity and historical credits will remain.`);
  if (person?.references?.length) reasons.push(`${person.references.length} saved page reference(s): ${[...new Set(person.references.map(reference => reference.title || reference.path))].join(", ")}. Keep this identity for historical credits, or review a merge if it is a duplicate.`);
  if (memberState.catalog?.audit.warnings?.length) reasons.push(`Reference checks are incomplete: ${memberState.catalog.audit.warnings.join("; ")}. Resolve these checks and reload before deleting.`);
  if (memberState.busy || state.busy || memberState.loading) reasons.push("An operation is in progress. Wait until it finishes.");
  if (!state.token) reasons.push("The Workbench connection is not ready. Reconnect before deleting.");
  return reasons;
}

function renderMemberDeletion() {
  const reasons = memberDeletionReasons();
  $("#member-delete").disabled = reasons.length > 0;
  $("#member-delete-reason").textContent = reasons.length ?
    `Deletion blocked: ${reasons.join(" ")}` :
    "Deletion is available: no current membership or saved page references. Permanent deletion removes the identity and custom category assignments; portrait files are kept.";
}

function discardMember() {
  return !memberState.dirty || confirm("Discard unsaved person changes? Exported portrait files will be kept.");
}

function closeMember() {
  const wasOpen = $("#person-editor-dialog").open;
  memberState.editing = false;
  memberState.original = null;
  memberState.dirty = false;
  clearMemberMergePlan();
  clearMemberRenamePlan();
  $("#member-form").hidden = true;
  $("#person-editor-dialog").close();
  $("#person-dialog-notice").hidden = true;
  memberDraft();
  renderMembers();
  if (wasOpen) $("#member-search").focus();
}

function openMember(id = null) {
  if (memberState.busy || state.busy || !discardMember()) return false;
  const member = id === null ? {} : memberState.catalog.people.find(person => person.id === id);
  if (!member) throw new Error("This person is no longer in the registry. Reload before opening.");
  memberState.original = id === null ? null : { id };
  memberState.historySearch = "";
  memberState.idTouched = false;
  memberState.editing = true;
  memberState.dirty = id === null;
  const none = node("option", "Not a current member (guest, former member or student)");
  none.value = "";
  $("#member-group").replaceChildren(none, ...memberState.catalog.groups.slice(0, -1).map((group, i) => {
    const option = node("option", group.label);
    option.value = String(i);
    return option;
  }));
  $("#member-group").value = member.membership ? String(member.membership.group) : "";
  for (const field of memberFields) $(`#member-${field}`).value = member[field] || "";
  memberState.socialLinks = [...(member.social_links || [])];
  renderMemberSocialLinks();
  memberState.roles = [...(member.membership?.roles || [])];
  $("#member-role").value = member.membership?.legacy_role ?? member.membership?.role ?? "";
  renderMembershipRoles();
  $("#member-id").readOnly = id !== null;
  $("#member-identity-details").open = id === null;
  $("#member-rename").hidden = id === null;
  $("#member-rename-target").value = "";
  clearMemberRenamePlan();
  $("#member-aliases").value = (member.aliases || []).join("\n");
  renderPersonCategories(member);
  $("#member-needs-review").checked = Boolean(member.needs_review);
  $("#member-show-profile-contacts").checked = member.show_profile_contacts === true;
  $("#member-merge").hidden = id === null;
  $("#member-merge-search").value = "";
  clearMemberMergePlan();
  renderMemberMergeTargets();
  $("#member-heading").textContent = id === null ? "New person — search existing people first" : `Edit ${member.name}`;
  $("#person-dialog-heading").textContent = id === null ? "New person & portraits" : `Edit ${member.name}`;
  $("#member-delete").hidden = id === null;
  $("#member-remove-membership").hidden = !member.membership;
  $("#member-form").hidden = false;
  $("#member-references").replaceChildren(node("p",
    member.membership || member.references?.length ?
      "Permanent deletion is blocked while this person is a current member or has saved page references. Removing membership keeps the person, assignments and portraits." :
      "No saved page references or membership. Permanent deletion removes the registry identity, not portrait files. Check unsaved page drafts before deleting."));
  renderPersonOverview();
  renderPortraitChoices();
  memberPreview();
  memberDraft();
  memberIdentityWarning();
  renderMembers();
  $("#person-dialog-notice").hidden = true;
  if (!$("#person-editor-dialog").open) $("#person-editor-dialog").showModal();
  $("#member-name").focus();
  return true;
}

function renderPersonOverview() {
  if (!memberState.editing) return;
  const person = memberState.catalog.people.find(person => person.id === memberState.original?.id);
  const overview = $("#member-overview");
  overview.replaceChildren(node("h3", "Membership & participation"));
  const membership = node("section", "", "person-membership-summary");
  const group = $("#member-group").value;
  membership.append(node("strong", group === "" ? "Not a current member" :
    `Current member — ${memberState.catalog.groups[Number(group)].label}`));
  const role = membershipRoleLabel();
  if (group !== "" && role) membership.append(node("span", role));
  membership.append(node("p", memberState.dirty ?
    "Membership selection is an unsaved draft. Event history below comes from saved pages." :
    "Current membership only. Course attendance and event participation are independent.", "hint"));
  if (person) membership.append(node("p", `Automatic saved classification: ${personAutomaticStatus(person, memberState.catalog?.role_catalog?.roles || [])}`, "hint"));
  overview.append(membership);
  const references = person?.references || [];
  const participant = reference => ["participant_ids", "participants"].includes(reference.field);
  const courses = references.filter(reference => participant(reference) && reference.section === "tanfolyamok");
  const trips = references.filter(reference => participant(reference) && reference.section === "turak");
  const other = references.filter(reference => !courses.includes(reference) && !trips.includes(reference));
  const searchControls = node("div", "", "person-history-search");
  const searchLabel = node("label", "Search contribution history");
  const search = node("input", "");
  search.type = "search";
  search.id = "member-history-search";
  search.placeholder = "Title, year, role or page path";
  search.value = memberState.historySearch || "";
  searchLabel.append(search);
  const clear = node("button", "Clear search", "secondary");
  clear.type = "button";
  searchControls.append(searchLabel, clear);
  overview.append(searchControls);
  const histories = [];
  for (const [title, entries, empty] of [
    ["Courses / participant history", courses, "No saved course participation. Course attendance is not membership."],
    ["Expeditions & trips", trips, "No saved expedition or trip participation."],
    ["Authorship, contacts & other contributions", other, "No other saved contributions."],
  ]) {
    const section = node("section", "", "person-history");
    const heading = node("h4", "");
    const list = node("div", "", "person-history-list");
    list.tabIndex = 0;
    list.setAttribute("role", "region");
    list.setAttribute("aria-label", title);
    const message = node("p", "", "hint");
    message.setAttribute("role", "status");
    const rows = [];
    section.append(heading, list, message);
    for (const reference of entries) {
      const button = node("button", "", "secondary person-history-entry");
      button.type = "button";
      button.append(node("strong", reference.title || reference.path));
      let status = reference.field;
      if (participant(reference)) {
        status = personParticipationLabel(person, reference.section,
          reference.roles?.length ? reference.roles : reference.role || "", memberState.catalog?.role_catalog?.roles || []);
      } else if (["author_id", "author"].includes(reference.field)) status = "Author";
      else if (reference.field === "contacts" || reference.field.endsWith(".contacts")) {
        status = `Contact${reference.role ? ` · ${reference.role}` : ""}`;
      }
      button.append(node("span", status, "person-history-status"));
      button.append(node("small", [reference.date, reference.draft ? "Draft page" : "",
        ["author", "participants"].includes(reference.field) ? "Legacy name assignment" : "",
        reference.path].filter(Boolean).join(" · ")));
      button.addEventListener("click", () => window.dispatchEvent(
        new CustomEvent("workbench-open-page", { detail: { path: reference.path } })));
      list.append(button);
      rows.push({ button, text: [reference.title, reference.date, reference.role, reference.path,
        reference.field, status, reference.draft ? "Draft page" : "",
        ["author", "participants"].includes(reference.field) ? "Legacy name assignment" : ""].filter(Boolean).join(" ") });
    }
    histories.push({ title, heading, list, message, rows, empty });
    overview.append(section);
  }
  const normalize = value => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("hu");
  const filterHistory = () => {
    memberState.historySearch = search.value;
    const terms = normalize(search.value).trim().split(/\s+/).filter(Boolean);
    for (const history of histories) {
      let matches = 0;
      for (const row of history.rows) {
        row.button.hidden = !terms.every(term => normalize(row.text).includes(term));
        if (!row.button.hidden) matches++;
      }
      history.heading.textContent = `${history.title} (${matches} / ${history.rows.length})`;
      history.list.hidden = matches === 0;
      history.list.scrollTop = 0;
      history.message.hidden = matches > 0;
      history.message.textContent = history.rows.length ? "No contributions match this search." : history.empty;
    }
  };
  search.addEventListener("input", filterHistory);
  clear.addEventListener("click", () => {
    search.value = "";
    filterHistory();
    search.focus();
  });
  filterHistory();
  overview.append(node("p",
    "Automatic classification comes from the rules in Manage roles, using current membership and saved course participation. A manual role on an event page overrides this fallback on that page only.",
    "hint"));
  if (memberState.catalog.audit.warnings.length) {
    overview.append(node("p", "Some page references could not be checked; this history may be incomplete. Review People & image checks.", "notice error"));
  }
}

function membershipRoleLabel() {
  return $("#member-role").value.trim() ||
    roleSelectionLabels(memberState.roles || [], memberState.catalog?.role_catalog?.roles || []);
}

function memberRoleValues() {
  const legacy = $("#member-role").value.trim();
  const definitions = memberState.catalog?.role_catalog?.roles || [];
  const resolved = resolveRoleSelection({ role: legacy }, definitions);
  return legacy && !resolved.length ? { role: legacy } :
    { roles: legacy ? resolved : [...(memberState.roles || [])] };
}

function renderMembershipRoles() {
  const container = $("#member-membership-roles");
  const legacy = $("#member-role").value;
  const entry = legacy ? { role: legacy } : { roles: memberState.roles || [] };
  const definitions = memberState.catalog?.role_catalog?.roles || [];
  container.replaceChildren(createRolePicker(entry, definitions, ids => {
    memberState.roles = ids;
    $("#member-role").value = "";
    memberState.dirty = true;
    renderMembershipRoles();
    renderPersonOverview();
    memberDraft();
  }, "membership-role-search", "Membership roles — choose any number"));
  container.hidden = $("#member-group").value === "";
}

async function openPersonEditor(id) {
  if (memberState.busy || memberState.loading || state.busy) {
    throw new Error("Wait for the current operation before opening a person.");
  }
  memberState.loading = true;
  memberControls();
  try {
    const catalog = await api("/api/workbench/members");
    if (!catalog.people.some(person => person.id === id)) {
      throw new Error("This person no longer exists. Refresh the article's people list.");
    }
    acceptMemberCatalog(catalog);
    renderMemberAudit();
    if (openMember(id)) {
      location.hash = "#portraits";
      $("#member-form").scrollIntoView({ block: "start" });
    }
  } finally {
    memberState.loading = false;
    memberControls();
  }
}

function memberIdentityWarning() {
  const normalize = value => value.normalize("NFC").trim().replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
  const draftNames = [
    ["name", $("#member-name").value],
    ["nickname", $("#member-nickname").value],
    ...$("#member-aliases").value.split("\n").map(value => ["alias", value]),
  ].filter(([, value]) => normalize(value));
  const id = $("#member-id").value.trim();
  const matches = [];
  for (const person of memberState.catalog.people) {
    if (person.id === memberState.original?.id) continue;
    const reasons = [];
    if (id && person.id === id) reasons.push(`Your ID "${id}" matches their existing ID`);
    const existingNames = [
      ["name", person.name], ["nickname", person.nickname],
      ...(person.aliases || []).map(value => ["alias", value]),
    ].filter(([, value]) => value);
    for (const [draftField, draftValue] of draftNames) {
      for (const [existingField, existingValue] of existingNames) {
        if (normalize(draftValue) === normalize(existingValue)) {
          reasons.push(`Your ${draftField} "${draftValue.trim()}" matches their ${existingField} "${existingValue}"`);
        }
      }
    }
    if (reasons.length) matches.push(`${person.name} [${person.id}]: ${reasons.join("; ")}.`);
  }
  const warning = $("#member-duplicate-warning");
  warning.hidden = !matches.length;
  warning.textContent = matches.length ?
    `Identity conflict — ${matches.join(" ")} Shared first names alone are not a conflict. ` +
    "If this is the same person, use the existing record. If these are different people, correct the conflicting name, nickname or alias in the appropriate record, or choose a different ID. " +
    "For a mistaken existing alias, copy your unsaved draft details, open the identified person, remove only the incorrect alias and save, then return to your draft. " +
    "This conflict cannot be approved with the manual identity clarification checkbox; the server rejects overlapping names, nicknames, aliases and duplicate IDs." : "";
}

function categoryKindLabel(kind) {
  return { membership: "Membership", course: "Tanfolyami résztvevők · automatic", custom: "Custom category" }[kind];
}

function renderPersonCategories(person) {
  const custom = $("#member-custom-categories");
  const automatic = $("#member-course-categories");
  custom.replaceChildren();
  automatic.replaceChildren();
  for (const category of memberState.catalog.categories || []) {
    if (category.kind !== "custom") continue;
    const label = node("label", "", "check-label");
    const input = node("input", "");
    input.type = "checkbox";
    input.value = category.id.slice("custom:".length);
    input.checked = category.people.includes(person.id);
    label.append(input, node("span", category.label));
    custom.append(label);
  }
  if (!custom.children.length) custom.append(node("p", "No custom categories yet. Use Manage custom categories in the registry panel.", "hint"));
  const courses = (person.categories || []).filter(category => category.kind === "course");
  for (const category of courses) {
    const button = node("button", `${category.label}${category.draft ? " · Draft page" : ""}`, "secondary category-chip");
    button.type = "button";
    button.title = `Tanfolyami résztvevők: ${category.path}. Everyone listed as a participant belongs to this group; roles remain separate.`;
    button.addEventListener("click", () => window.dispatchEvent(
      new CustomEvent("workbench-open-page", { detail: { path: category.path } })));
    automatic.append(button);
  }
  if (!courses.length) automatic.append(node("p", "No saved course participant assignments.", "hint"));
  if (memberState.catalog.audit.warnings.length) {
    automatic.append(node("p", "Course groups may be incomplete: review People & image checks for scan errors.", "notice error"));
  }
}

function renderCategoryFilters() {
  const filter = $("#member-category-filter");
  const previous = filter.value;
  const all = node("option", "All groups / categories");
  all.value = "";
  filter.replaceChildren(all);
  for (const kind of ["membership", "course", "custom"]) {
    const group = node("optgroup", "");
    group.label = categoryKindLabel(kind);
    for (const category of (memberState.catalog.categories || []).filter(category => category.kind === kind)) {
      const option = node("option", `${category.label} (${category.people.length})${category.draft ? " · Draft" : ""}`);
      option.value = category.id;
      group.append(option);
    }
    if (group.children.length) filter.append(group);
  }
  filter.value = Array.from(filter.options).some(option => option.value === previous) ? previous : "";
}

function renderCategoryManager() {
  const select = $("#category-select");
  const previous = select.value;
  const create = node("option", "Create a new custom category");
  create.value = "";
  select.replaceChildren(create);
  for (const category of (memberState.catalog.categories || []).filter(category => category.kind === "custom")) {
    const option = node("option", `${category.label} (${category.people.length} people)`);
    option.value = category.id.slice("custom:".length);
    select.append(option);
  }
  select.value = Array.from(select.options).some(option => option.value === previous) ? previous : "";
  selectCategory();
}

function selectCategory() {
  const id = $("#category-select").value;
  const category = (memberState.catalog?.categories || []).find(category => category.id === "custom:" + id);
  $("#category-id").value = id;
  $("#category-id").readOnly = Boolean(id);
  $("#category-label").value = category?.label || "";
  $("#category-save").textContent = id ? "Save category label" : "Create category";
  $("#category-delete").hidden = !id;
  $("#category-delete").disabled = Boolean(category?.people.length);
  $("#category-status").textContent = category?.people.length ?
    `Assigned to ${category.people.length} people. Remove their category assignments before deleting this category.` :
    "Custom categories are Workbench-only labels. They never grant membership or change public pages.";
}

async function saveCategory(remove = false) {
  if (memberState.busy || state.busy || memberState.loading) return;
  if (memberState.dirty) throw new Error("Save or discard the person draft before managing category definitions.");
  const original = $("#category-select").value || null;
  const id = $("#category-id").value.trim();
  const label = $("#category-label").value.trim();
  if (!remove && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !label)) {
    throw new Error("Enter a category name and a lowercase hyphenated ID.");
  }
  if (remove && (!original || !confirm(`Delete the empty custom category "${label}"? People and course pages are kept.`))) return;
  memberState.busy = true;
  memberControls();
  try {
    const result = await api(`/api/workbench/members/category-${remove ? "delete" : "save"}`, {
      method: "POST", payload: { revision: memberState.catalog.revision, id, label, original, confirm: remove },
    });
    acceptMemberCatalog(result);
    renderMembers();
    if (memberState.original) renderPersonCategories(result.people.find(person => person.id === memberState.original.id));
    clearMemberMergePlan();
    clearMemberRenamePlan();
    notify(remove ? "Empty custom category deleted." : "Custom category saved. Select it in each person's Groups & categories and save the person.");
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

function renderRoleManager() {
  const select = $("#participant-role-select");
  const create = node("option", "Create a new role");
  create.value = "";
  select.replaceChildren(create);
  for (const role of memberState.catalog?.role_catalog?.roles || []) {
    const option = node("option", role.label);
    option.value = role.id;
    select.append(option);
  }
  select.value = roleState.selected;
  if (!Array.from(select.options).some(option => option.value === roleState.selected)) select.value = "";
  selectRole();
}

function selectRole() {
  const id = $("#participant-role-select").value;
  const catalog = memberState.catalog?.role_catalog;
  const role = catalog?.roles.find(item => item.id === id);
  roleState.selected = id;
  roleState.revision = catalog?.revision || "";
  roleState.dirty = false;
  $("#participant-role-label").value = role?.label || "";
  $("#participant-role-id").value = id;
  $("#participant-role-id").readOnly = Boolean(id);
  $("#participant-role-aliases").value = (role?.aliases || []).join("\n");
  $("#participant-role-exempt").checked = Boolean(role?.exempt_from_guest);
  $("#participant-role-automatic").checked = Boolean(role?.automatic_when);
  for (const fact of ["current_member", "course_participant"]) {
    $(`#participant-role-${fact}`).value = role?.automatic_when?.[fact] === undefined ? "" : String(role.automatic_when[fact]);
  }
  $("#participant-role-save").textContent = id ? "Save role" : "Create role";
  const references = catalog?.references.filter(entry => entry.id === id) || [];
  const button = $("#participant-role-delete");
  button.hidden = !id;
  button.disabled = Boolean(role?.automatic_when || references.length || catalog?.warnings.length);
  button.title = role?.automatic_when ? "Disable and save the automatic rule before deleting this role." :
    references.length ? "Remove this role from its saved pages first." :
    catalog?.warnings.length ? "Resolve page scan warnings before deleting roles." : "";
  const usage = $("#participant-role-usage");
  usage.replaceChildren();
  for (const reference of references) {
    const person = memberState.catalog?.people?.find(person => person.id === reference.person);
    const link = node("button", `${reference.kind === "membership" ? "Membership: " : ""}${reference.title} · ${person?.name || reference.person}`, "secondary person-history-entry");
    link.type = "button";
    link.addEventListener("click", () => window.dispatchEvent(
      new CustomEvent(reference.kind === "membership" ? "workbench-open-person" : "workbench-open-page",
        { detail: { path: reference.path, id: reference.person } })));
    usage.append(link);
  }
  $("#participant-role-status").textContent = [
    ...(role?.automatic_when ? ["Automatic rule enabled. Matching people receive this fallback without modifying their records. Disable and save the rule before deleting this role."] : []),
    references.length ? `Used by ${references.length} saved assignment(s). Remove these roles from the linked people or pages before deleting.` :
      id ? "No saved manual assignments. Deletion requires a disabled automatic rule and confirmation; unsaved drafts are not rewritten." :
        "Enter a display name to create a global choice. Enable an automatic rule only if wanted.",
    ...(catalog?.warnings || []),
  ].join("\n");
}

function automaticRoleDraft() {
  if (!$("#participant-role-automatic").checked) return null;
  return Object.fromEntries(["current_member", "course_participant"].flatMap(fact => {
    const value = $(`#participant-role-${fact}`).value;
    return value === "" ? [] : [[fact, value === "true"]];
  }));
}

async function saveRole(remove = false) {
  if (memberState.busy || state.busy || memberState.loading) return;
  if (memberState.dirty) throw new Error("Save or discard the person draft before managing roles.");
  const original = roleState.selected || null;
  const label = $("#participant-role-label").value.trim();
  const id = $("#participant-role-id").value.trim() || label.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!remove && (!label || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) {
    throw new Error("Enter a role name; check its generated stable ID under Stable ID & historical labels.");
  }
  if (remove && (!original || !confirm(`Delete the unused role "${label}"? Unsaved page drafts are not changed.`))) return;
  memberState.busy = true;
  memberControls();
  try {
    const result = await api(`/api/workbench/members/role-${remove ? "delete" : "save"}`, {
      method: "POST", payload: {
        revision: roleState.revision, original, id, label,
        aliases: $("#participant-role-aliases").value.split("\n").map(value => value.trim()).filter(Boolean),
        exempt_from_guest: $("#participant-role-exempt").checked, automatic_when: automaticRoleDraft(), confirm: remove,
      },
    });
    roleState.dirty = false;
    roleState.selected = remove ? "" : id;
    acceptMemberCatalog(result);
    renderMembers();
    if (memberState.editing && memberState.original) {
      renderMembershipRoles();
      renderPersonOverview();
    }
    notify(remove ? "Unused role deleted." : "Role saved. Its automatic rule applies immediately; manual assignments stay independent.");
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

function renderPortraitChoices() {
  $("#member-portrait-choice").replaceChildren(node("option", "Choose a portrait"));
  $("#member-portrait-choice").firstChild.value = "";
  for (const url of memberState.catalog.portraits.filter(url => url.endsWith("_thumb.webp"))) {
    const option = node("option", url.slice("/images/members/".length));
    option.value = url;
    $("#member-portrait-choice").append(option);
  }
}

function renderMembers() {
  if (!memberState.catalog) return;
  renderCategoryFilters();
  const category = (memberState.catalog.categories || []).find(category => category.id === $("#member-category-filter").value);
  const search = $("#member-search").value.trim().toLocaleLowerCase("hu");
  const filter = $("#member-filter").value;
  const list = $("#member-list");
  list.replaceChildren();
  let count = 0;
  memberState.catalog.groups.forEach((group, groupIndex) => {
    const entries = memberState.catalog.people.filter(member =>
      (member.membership ? member.membership.group === groupIndex : groupIndex === memberState.catalog.groups.length - 1) &&
      (filter !== "current" || member.membership) && (filter !== "nonmembers" || !member.membership) &&
      (filter !== "review" || member.needs_review) &&
      (!category || category.people.includes(member.id)) &&
      [member.id, member.name, member.nickname, member.membership?.role,
        personAutomaticStatus(member, memberState.catalog.role_catalog?.roles || []), ...(member.aliases || []),
        ...(member.categories || []).map(category => category.label)].filter(Boolean).join(" ").toLocaleLowerCase("hu").includes(search));
    if (!entries.length) return;
    list.append(node("h3", `${group.label} (${entries.length})`));
    for (const member of entries) {
      count++;
      const button = node("button", "", "secondary");
      button.type = "button";
      const selected = memberState.original?.id === member.id;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      if (member.image?.startsWith("/images/")) {
        const image = document.createElement("img");
        image.src = member.image;
        image.alt = "";
        image.loading = "lazy";
        button.append(image);
      }
      const text = node("span", "");
      text.append(node("strong", member.name), node("small", [member.id, member.nickname, member.membership?.role,
        personAutomaticStatus(member, memberState.catalog.role_catalog?.roles || [])].filter(Boolean).join(" · ")));
      const categories = (member.categories || []).filter(category => category.kind !== "membership");
      if (categories.length) text.append(node("small", categories.map(category =>
        `${category.kind === "course" ? "Tanfolyami résztvevő: " : ""}${category.label}`).join(" · ")));
      if (member.needs_review) text.append(node("span", "Needs clarification", "identity-review-flag"));
      button.append(text);
      button.addEventListener("click", () => openMember(member.id));
      list.append(button);
    }
  });
  if (!count) list.append(node("p", "No matching people. Change the search/filter or add a new registry identity."));
  memberControls();
}

function renderMemberAudit() {
  const audit = memberState.catalog.audit;
  $("#member-audit-summary").textContent =
    `People & image checks: ${(audit.people_needing_review || []).length} identities needing clarification, ${(audit.suggestions || []).length} legacy matching hints, ${audit.missing_images.length} missing images, ${audit.unassigned_portraits.length} unassigned portraits, ${audit.unmatched_participants.length} unmatched participant entries, ${audit.unmatched_authors.length} unmatched authors`;
  const panel = $("#member-audit");
  panel.replaceChildren();
  panel.append(node("h3", `Manual identity clarification (${(audit.people_needing_review || []).length})`, "identity-review-flag"));
  panel.append(node("p", "Do not guess unidentified names. Confirm who each person is before clearing the flag or merging identities.", "hint"));
  const reviewList = node("ul", "");
  for (const entry of audit.people_needing_review || []) {
    const id = typeof entry === "string" ? entry : entry.id;
    const person = memberState.catalog.people.find(person => person.id === id);
    const item = node("li", "");
    const button = node("button", `${person?.name || entry.name || id} [${id}] — needs clarification`, "secondary");
    button.type = "button";
    button.addEventListener("click", () => openMember(id));
    item.append(button);
    reviewList.append(item);
  }
  if (!reviewList.children.length) reviewList.append(node("li", "None."));
  panel.append(reviewList, node("h3", `Legacy name matching hints (${(audit.suggestions || []).length})`),
    node("p", "Suggestions only — nothing is automatically assigned. Open the page and choose a registry identity only after manual confirmation.", "hint"));
  const hints = node("ul", "");
  for (const suggestion of audit.suggestions || []) {
    const item = node("li", "", "identity-legacy-hint");
    const button = node("button", `${suggestion.path}: ${suggestion.field} — ${suggestion.name}`, "secondary");
    button.type = "button";
    button.addEventListener("click", () => window.dispatchEvent(new CustomEvent("workbench-open-page", { detail: { path: suggestion.path } })));
    item.append(button, node("p", suggestion.candidates?.length ?
      `Possible identities (unconfirmed): ${suggestion.candidates.map(person => `${person.name} [${person.id}]`).join(", ")}` :
      "No candidate identity. Manual clarification is required; do not infer a match.", "hint"));
    hints.append(item);
  }
  if (!hints.children.length) hints.append(node("li", "None."));
  panel.append(hints);
  for (const [title, items] of [
    ["Missing or invalid people images", audit.missing_images.map(item => `${item.name} / ${item.field}: ${item.url} — ${item.error}`)],
    ["Unmatched participant identities / legacy names", audit.unmatched_participants.map(item => `${item.path}: ${item.name}`)],
    ["Unmatched author identities / legacy names", audit.unmatched_authors.map(item => `${item.path}: ${item.name}`)],
    ["Data / reference scan warnings", audit.warnings],
  ]) {
    panel.append(node("h3", `${title} (${items.length})`));
    const list = node("ul", "");
    if (!items.length) list.append(node("li", "None."));
    else for (const item of items) list.append(node("li", item));
    panel.append(list);
  }
  panel.append(node("h3", `Loose portraits not assigned to people (${audit.unassigned_portraits.length})`));
  const actions = node("div", "", "actions");
  const selectAll = node("button", "Select all", "secondary");
  selectAll.type = "button";
  selectAll.addEventListener("click", () => {
    panel.querySelectorAll(".loose-portrait-select").forEach(input => { input.checked = true; });
  });
  const review = node("button", "Review & delete selected", "secondary");
  review.type = "button";
  review.addEventListener("click", () => action(() => reviewPortraitDeletion(
    Array.from(panel.querySelectorAll(".loose-portrait-select:checked"), input => input.value))));
  actions.append(selectAll, review);
  if (audit.unassigned_portraits.length) panel.append(actions);
  const list = node("ul", "", "loose-portraits");
  for (const url of audit.unassigned_portraits) {
    const row = node("li", "");
    const label = node("label", "", "loose-portrait-label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "loose-portrait-select";
    checkbox.value = url;
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    image.loading = "lazy";
    label.append(checkbox, image, node("span", url));
    const button = node("button", "Delete…", "secondary");
    button.type = "button";
    button.addEventListener("click", () => action(() => reviewPortraitDeletion([url])));
    row.append(label, button);
    list.append(row);
  }
  if (!audit.unassigned_portraits.length) list.append(node("li", "None."));
  panel.append(list);
  memberControls();
}

function checkPortraitDraft(urls) {
  if (memberState.editing && ["image", "modal_image"].some(field => urls.includes($(`#member-${field}`).value.trim()))) {
    throw new Error("A selected portrait is assigned to the open member draft. Save the member, or remove/discard that image assignment before deleting it.");
  }
}

async function reviewPortraitDeletion(urls) {
  if (memberState.busy || state.busy || memberState.loading) return;
  if (!urls.length) throw new Error("Select at least one loose portrait file.");
  checkPortraitDraft(urls);
  memberState.busy = true;
  memberControls();
  try {
    portraitDeletionPlan = await api("/api/workbench/members/portrait-delete-plan", {
      method: "POST", payload: { revision: memberState.catalog.revision, urls },
    });
    const container = $("#member-files-review");
    container.replaceChildren();
    $("#member-files-error").hidden = true;
    for (const file of portraitDeletionPlan.files) {
      const row = node("div", "", "portrait-delete-review");
      const label = node("label", "", "loose-portrait-label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = file.url;
      checkbox.disabled = file.references.length > 0;
      checkbox.checked = !checkbox.disabled;
      label.append(checkbox, node("span", `${file.url} (${Math.ceil(file.bytes / 1024)} KiB)`));
      row.append(label, node("p", file.references.length ?
        `Deletion blocked — referenced by: ${file.references.join(", ")}` :
        "No saved site references found.", "hint"));
      container.append(row);
    }
    $("#member-files-dialog").showModal();
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

async function deleteLoosePortraits() {
  if (memberState.busy || state.busy || memberState.loading) return;
  const urls = Array.from($("#member-files-review").querySelectorAll("input:checked:not(:disabled)"), input => input.value);
  if (!urls.length) throw new Error("No deletable files are checked. Referenced files cannot be deleted here.");
  checkPortraitDraft(urls);
  const files = portraitDeletionPlan.files.filter(file => urls.includes(file.url));
  if (!confirm(`Permanently delete ${files.length} portrait file(s)? This cannot be undone for untracked files.`)) return;
  memberState.busy = true;
  memberControls();
  $("#member-files-error").hidden = true;
  try {
    const result = await api("/api/workbench/members/portrait-delete", {
      method: "POST", payload: { revision: portraitDeletionPlan.revision, files, confirm: true },
    });
    acceptMemberCatalog(result.catalog);
    renderMembers();
    renderPortraitChoices();
    renderMemberAudit();
    $("#member-files-dialog").close();
    portraitDeletionPlan = null;
    notify(`Deleted ${result.deleted.length} loose portrait file(s). Member details and reports were not changed.`);
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

async function loadMembers(notifyReload = false) {
  if (memberState.loading || memberState.busy || state.busy || !discardMember()) return;
  memberState.loading = true;
  memberControls();
  try {
    acceptMemberCatalog(await api("/api/workbench/members"));
    closeMember();
    renderMemberAudit();
    if (notifyReload) notify("People registry reloaded. Review identities, membership and image checks.");
  } finally {
    memberState.loading = false;
    memberControls();
  }
}

async function saveMember() {
  if (memberState.busy || state.busy) return;
  const member = Object.fromEntries(memberFields.map(field => [field, $(`#member-${field}`).value]));
  member.social_links = (memberState.socialLinks || []).map(url => url.trim());
  member.show_profile_contacts = $("#member-show-profile-contacts").checked;
  delete member.role;
  Object.assign(member, memberRoleValues());
  member.aliases = $("#member-aliases").value.split("\n").map(value => value.trim()).filter(Boolean);
  member.needs_review = $("#member-needs-review").checked;
  member.id = member.id.trim();
  if (!/^[a-z0-9-]+$/.test(member.id)) throw new Error("Use a stable ID with lowercase letters, digits and hyphens.");
  memberState.busy = true;
  memberControls();
  try {
    const result = await api("/api/workbench/members/save", { method: "POST", payload: {
      revision: memberState.catalog.revision, original: memberState.original,
      group: $("#member-group").value === "" ? null : Number($("#member-group").value), member,
      categories: Array.from($("#member-custom-categories").querySelectorAll("input:checked"), input => input.value),
    } });
    acceptMemberCatalog(result);
    memberState.dirty = false;
    memberState.busy = false;
    openMember(result.selected.id);
    renderMemberAudit();
    notify("Person saved. Membership is separate from page assignments; historical names were preserved.");
    await reviewReplacedPortraits(result.replaced_portraits || []);
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

async function reviewReplacedPortraits(urls) {
  if (!urls.length) return;
  const eligible = urls.filter(url => memberState.catalog.portraits.includes(url));
  const excluded = urls.filter(url => !eligible.includes(url));
  const note = excluded.length ?
    ` These old URLs are missing or outside the managed portrait folder and need manual review: ${excluded.join(", ")}.` : "";
  if (!eligible.length) {
    notify(`Person saved. Old portrait cleanup needs manual review: ${excluded.join(", ")}. No files were deleted.`, true);
    return;
  }
  if (!confirm(`Person saved with the new portrait assignments. Review and purge the old portrait file(s)?\n\n${eligible.join("\n")}\n\nShared files will be blocked; check unsaved page drafts too. Final deletion requires confirmation.${note}`)) {
    notify(`Person saved. Old portrait files were kept; review them in People & image checks.${note}`);
    return;
  }
  try {
    await reviewPortraitDeletion(eligible);
  } catch (error) {
    throw new Error(`Person was saved, but old portrait cleanup could not be reviewed. No old files were deleted. ${error.message}`);
  }
}

function clearMemberRenamePlan() {
  memberRenamePlan = null;
  $("#member-rename-review").hidden = true;
  $("#member-rename-review").replaceChildren();
  $("#member-rename-confirm").hidden = true;
}

async function reviewMemberRename() {
  if (memberState.busy || state.busy || memberState.loading) return;
  if (memberState.dirty) throw new Error("Save or discard the person draft before changing their saved ID.");
  const source = memberState.original?.id;
  const target = $("#member-rename-target").value.trim();
  if (!source || !target || source === target) throw new Error("Choose a different new person ID.");
  clearMemberRenamePlan();
  clearMemberMergePlan();
  memberState.busy = true;
  memberControls();
  try {
    const plan = await api("/api/workbench/members/rename-plan", { method: "POST", payload: {
      revision: memberState.catalog.revision, source, target,
    } });
    const review = $("#member-rename-review");
    const person = memberState.catalog.people.find(person => person.id === source);
    review.replaceChildren(node("h3", `${person.name}: ${plan.source} → ${plan.target}`),
      node("p", "The same person keeps their profile, aliases, portraits, membership category and all event roles. Only the ID and its saved references change."),
      node("p", `Registry: data/people.yaml — person ID and ${plan.memberships.length} membership assignment(s).`));
    for (const membership of plan.memberships) {
      review.append(node("p", `Membership: ${membership.group}${membership.role ? ` — ${membership.role}` : ""}`));
    }
    for (const category of plan.categories || []) review.append(node("p", `Custom category: ${category} — person ID reference updated.`));
    const files = node("ul", "");
    for (const file of plan.files) files.append(node("li", `${file.path}: ${file.fields.join(", ")} — ${plan.source} → ${plan.target}`));
    if (!plan.files.length) files.append(node("li", "No saved page ID references to rewrite."));
    review.append(node("p", `${plan.files.length} affected saved page(s):`), files,
      node("p", "Review this list manually before confirming. Legacy name-only credits remain unchanged. Unsaved page drafts are not rewritten: reload affected saved pages or replace their old IDs before saving. Changed files or incomplete scans require a new review."));
    memberRenamePlan = plan;
    review.hidden = false;
    $("#member-rename-confirm").hidden = false;
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

async function renameMemberIdentity() {
  if (memberState.busy || state.busy || memberState.loading) return;
  if (!memberRenamePlan || memberState.dirty) throw new Error("Review a fresh ID change plan with no unsaved person changes first.");
  if (memberRenamePlan.source !== memberState.original?.id ||
      memberRenamePlan.target !== $("#member-rename-target").value.trim()) {
    clearMemberRenamePlan();
    throw new Error("The chosen ID changed. Review the ID change again.");
  }
  const plan = memberRenamePlan;
  if (!confirm(`Have you manually reviewed every listed reference? Change ${plan.source} to ${plan.target} and update all listed saved pages and membership? Unsaved page drafts are not rewritten.`)) return;
  memberState.busy = true;
  memberControls();
  try {
    const result = await api("/api/workbench/members/rename", { method: "POST", payload: { ...plan, confirm: true } });
    acceptMemberCatalog(result, false, true);
    memberState.dirty = false;
    memberState.busy = false;
    openMember(result.selected.id);
    renderMemberAudit();
    notify("Person ID changed and saved references updated. Review any unsaved page draft for the old ID before saving.");
  } catch (error) {
    clearMemberRenamePlan();
    throw error;
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

function clearMemberMergePlan() {
  memberMergePlan = null;
  $("#member-merge-review").hidden = true;
  $("#member-merge-review").replaceChildren();
  $("#member-merge-confirm").hidden = true;
}

function renderMemberMergeTargets() {
  const select = $("#member-merge-target");
  const previous = select.value;
  const search = $("#member-merge-search").value.trim().toLocaleLowerCase("hu");
  const placeholder = node("option", "Choose the confirmed matching identity to keep…");
  placeholder.value = "";
  select.replaceChildren(placeholder, ...(memberState.catalog?.people || []).filter(person =>
    person.id !== memberState.original?.id &&
    [person.id, person.name, person.nickname, ...(person.aliases || [])].filter(Boolean).join(" ").toLocaleLowerCase("hu").includes(search))
    .map(person => {
      const option = node("option", `${person.name} [${person.id}]${person.needs_review ? " — needs clarification" : ""}`);
      option.value = person.id;
      return option;
    }));
  select.value = Array.from(select.options).some(option => option.value === previous) ? previous : "";
  memberControls();
}

async function reviewMemberMerge() {
  if (memberState.busy || state.busy || memberState.loading) return;
  if (memberState.dirty) throw new Error("Save or discard the person draft before merging saved identities.");
  const source = memberState.original?.id;
  const target = $("#member-merge-target").value;
  if (!source || !target || source === target) throw new Error("Choose a different, manually confirmed target identity.");
  clearMemberMergePlan();
  clearMemberRenamePlan();
  memberState.busy = true;
  memberControls();
  try {
    const plan = await api("/api/workbench/members/merge-plan", { method: "POST", payload: {
      revision: memberState.catalog.revision, source, target,
    } });
    const sourcePerson = memberState.catalog.people.find(person => person.id === source);
    const targetPerson = memberState.catalog.people.find(person => person.id === target);
    const review = $("#member-merge-review");
    review.replaceChildren(node("h3", `${sourcePerson.name} [${source}] → ${targetPerson.name} [${target}]`),
      node("p", "Target profile wins; empty target fields are filled from the source. Source names become aliases. Source membership transfers only if the target has none."),
      node("p", `Profile conflicts: ${plan.profile_conflicts.length ? plan.profile_conflicts.join(", ") : "None"}.`),
      node("p", plan.membership_note),
      node("p", `Custom categories retained on the target: ${(plan.categories || []).join(", ") || "None"}. Course groups follow rewritten saved participant assignments.`),
      node("p", `${plan.files.length} affected saved page/file(s):`));
    const files = node("ul", "");
    for (const file of plan.files) files.append(node("li", file.path));
    if (!plan.files.length) files.append(node("li", "No saved page assignments to rewrite."));
    review.append(files, node("p", "This removes the source identity permanently. Check unsaved page drafts for old source IDs. Conflicting participant roles, stale files or scan errors block the merge; nothing is guessed."));
    memberMergePlan = plan;
    review.hidden = false;
    $("#member-merge-confirm").hidden = false;
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

async function mergeMemberIdentities() {
  if (memberState.busy || state.busy || memberState.loading) return;
  if (!memberMergePlan || memberState.dirty) throw new Error("Review a fresh merge plan with no unsaved person changes first.");
  if (!confirm("Have you manually confirmed these are the same person? Permanently merge the source into the target shown above, rewriting the listed saved pages? Unsaved page drafts are not rewritten.")) return;
  const plan = memberMergePlan;
  memberState.busy = true;
  memberControls();
  try {
    const result = await api("/api/workbench/members/merge", { method: "POST", payload: { ...plan, confirm: true } });
    acceptMemberCatalog(result, true);
    memberState.dirty = false;
    memberState.busy = false;
    openMember(result.selected.id);
    renderMemberAudit();
    notify("Identities merged. Target retained, source names preserved as aliases. Review any unsaved page draft before saving it.");
  } catch (error) {
    clearMemberMergePlan();
    throw error;
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

async function deleteMember() {
  if (memberState.busy || state.busy || !memberState.original) return;
  const existing = memberState.catalog.people.find(person => person.id === memberState.original.id);
  const reasons = memberDeletionReasons();
  if (reasons.length) throw new Error(`Deletion blocked: ${reasons.join(" ")}`);
  if (!confirm(`Permanently delete ${existing.name} [${existing.id}] from the people registry? Check unsaved page drafts too. Portrait files will be preserved. Any unsaved person changes will be discarded.`)) return;
  memberState.busy = true;
  memberControls();
  try {
    acceptMemberCatalog(await api("/api/workbench/members/delete", { method: "POST", payload: {
      revision: memberState.catalog.revision, original: memberState.original, confirm: true,
    } }));
    closeMember();
    renderMemberAudit();
    notify("Person permanently deleted from the registry. Portrait files were preserved.");
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

window.memberEditor = {
  get editing() { return memberState.editing; },
  get busy() { return memberState.busy || memberState.loading; },
  exported(result) {
    if (!memberState.catalog) return;
    for (const file of result.files) {
      if (file.url.startsWith("/images/members/") && !memberState.catalog.portraits.includes(file.url)) {
        memberState.catalog.portraits.push(file.url);
      }
    }
    const assigned = new Set(memberState.catalog.people.flatMap(member => [member.image, member.modal_image].filter(Boolean)));
    memberState.catalog.audit.unassigned_portraits = memberState.catalog.portraits.filter(url => !assigned.has(url));
    renderPortraitChoices();
    renderMemberAudit();
  },
  attach(result) {
    const thumb = result.files.find(file => file.url.endsWith("_thumb.webp"));
    const full = result.files.find(file => file.url.endsWith("_full.webp"));
    if (!thumb || !full) throw new Error("Portrait export did not return a thumbnail/full pair.");
    $("#member-image").value = thumb.url;
    $("#member-modal_image").value = full.url;
    memberState.dirty = true;
    memberPreview();
    memberDraft();
  },
};

$("#member-search").addEventListener("input", renderMembers);
for (const [selector, title] of [
  ["#member-group", "membership groups"], ["#member-category-filter", "groups and categories"],
  ["#category-select", "custom categories"], ["#member-portrait-choice", "portrait pairs"],
  ["#participant-role-select", "roles"],
]) searchableSelect($(selector), title);
searchableSelect($("#member-merge-target"), "merge identities", $("#member-merge-search"), id => {
  const person = memberState.catalog?.people.find(person => person.id === id);
  return (person?.aliases || []).join(" ");
});
$("#member-filter").addEventListener("change", renderMembers);
$("#member-category-filter").addEventListener("change", renderMembers);
$("#category-select").addEventListener("change", selectCategory);
$("#category-save").addEventListener("click", () => action(() => saveCategory()));
$("#category-delete").addEventListener("click", () => action(() => saveCategory(true)));
$("#participant-role-select").addEventListener("change", () => {
  if (roleState.dirty && !confirm("Discard the unsaved role changes?")) {
    $("#participant-role-select").value = roleState.selected;
    return;
  }
  selectRole();
});
$("#participant-role-fields").addEventListener("input", event => {
  if (event.target.id === "participant-role-select" || event.target.dataset.selectSearch === "true") return;
  roleState.dirty = true;
  $("#participant-role-status").textContent = "Unsaved role draft. Save or discard before changing Git branches.";
});
$("#participant-role-save").addEventListener("click", () => action(() => saveRole()));
$("#participant-role-delete").addEventListener("click", () => action(() => saveRole(true)));
$("#participant-role-discard").addEventListener("click", () => selectRole());
window.addEventListener("workbench-open-roles", () => action(async () => {
  await loadMembers();
  location.hash = "#portraits";
  $("#participant-role-manager").open = true;
  $("#participant-role-manager").scrollIntoView({ block: "start" });
}));
$("#category-label").addEventListener("input", () => {
  if (!$("#category-select").value) $("#category-id").value = $("#category-label").value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
});
$("#member-refresh").addEventListener("click", () => action(() => loadMembers(true)));
$("#member-new").addEventListener("click", () => openMember());
$("#member-social-add").addEventListener("click", () => {
  if (memberState.socialLinks.length >= 20) {
    notify("A person can have up to 20 social links. Remove a link before adding another.", true);
    return;
  }
  memberState.socialLinks.push("");
  memberState.dirty = true;
  renderMemberSocialLinks();
  memberDraft();
  $("#member-social-links").querySelectorAll("input")[memberState.socialLinks.length - 1].focus();
});
$("#person-editor-dialog").append($("#portrait-workspace"));
$("#member-resume").addEventListener("click", () => {
  if (!$("#person-editor-dialog").open) $("#person-editor-dialog").showModal();
  $("#member-name").focus();
});
$("#portrait-standalone").addEventListener("click", () => {
  if (memberState.busy || memberState.loading || state.busy || !discardMember()) return;
  closeMember();
  $("#person-dialog-heading").textContent = "Standalone portrait export";
  $("#person-editor-dialog").showModal();
  $("#portrait-files").focus();
});
$("#person-dialog-close").addEventListener("click", () => {
  if (memberState.busy || memberState.loading || state.busy) return;
  if (discardMember()) closeMember();
});
$("#person-editor-dialog").addEventListener("cancel", event => {
  event.preventDefault();
  if (!memberState.busy && !memberState.loading && !state.busy && discardMember()) closeMember();
});
window.addEventListener("hashchange", () => {
  if (location.hash !== "#portraits" && $("#person-editor-dialog").open) $("#person-editor-dialog").close();
});
$("#member-remove-membership").addEventListener("click", () => {
  $("#member-group").value = "";
  memberState.dirty = true;
  memberDraft();
  renderPersonOverview();
  renderMembershipRoles();
  notify("Membership removed in this draft only. Save person to apply; the identity and page assignments will remain.");
});
$("#member-cancel").addEventListener("click", () => { if (discardMember()) closeMember(); });
$("#member-delete").addEventListener("click", () => action(deleteMember));
$("#member-merge-search").addEventListener("input", () => {
  clearMemberMergePlan();
  renderMemberMergeTargets();
});
$("#member-merge-target").addEventListener("change", () => {
  clearMemberMergePlan();
  memberControls();
});
$("#member-merge-plan").addEventListener("click", () => action(reviewMemberMerge));
$("#member-merge-confirm").addEventListener("click", () => action(mergeMemberIdentities));
$("#member-rename-target").addEventListener("input", () => {
  clearMemberRenamePlan();
  memberControls();
});
$("#member-rename-plan").addEventListener("click", () => action(reviewMemberRename));
$("#member-rename-confirm").addEventListener("click", () => action(renameMemberIdentity));
$("#member-files-confirm").addEventListener("click", () => action(async () => {
  try {
    await deleteLoosePortraits();
  } catch (error) {
    $("#member-files-error").textContent = error.message;
    $("#member-files-error").hidden = false;
    throw error;
  }
}));
$("#member-files-cancel").addEventListener("click", () => $("#member-files-dialog").close());
$("#member-files-dialog").addEventListener("cancel", event => {
  if (memberState.busy) event.preventDefault();
});
$("#member-form").addEventListener("submit", event => { event.preventDefault(); action(saveMember); });
$("#member-form").addEventListener("invalid", event => {
  let section = event.target.closest("details");
  while (section) {
    section.open = true;
    section = section.parentElement.closest("details");
  }
}, true);
$("#member-form").addEventListener("input", event => {
  if (event.target.dataset.selectSearch || event.target.closest("#member-overview") || event.target.closest("#member-merge") || event.target.closest("#member-rename")) return;
  memberState.dirty = true;
  clearMemberMergePlan();
  memberDraft();
  memberIdentityWarning();
  memberControls();
  if (event.target.id === "member-group") {
    renderPersonOverview();
    renderMembershipRoles();
  }
});
$("#member-id").addEventListener("input", () => { memberState.idTouched = true; });
$("#member-name").addEventListener("input", () => {
  if (!memberState.original && !memberState.idTouched) {
    $("#member-id").value = $("#member-name").value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    memberIdentityWarning();
  }
});
for (const field of ["image", "modal_image"]) {
  $(`#member-${field}`).addEventListener("change", memberPreview);
}
$("#member-use-portrait").addEventListener("click", () => action(async () => {
  const thumb = $("#member-portrait-choice").value;
  const full = thumb.replace(/_thumb\.webp$/, "_full.webp");
  if (!thumb || !memberState.catalog.portraits.includes(full)) throw new Error("Choose a portrait with an existing thumbnail and full-image pair.");
  window.memberEditor.attach({ files: [{ url: thumb }, { url: full }] });
}));
$("#member-clear-images").addEventListener("click", () => {
  $("#member-image").value = "";
  $("#member-modal_image").value = "";
  memberState.dirty = true;
  memberPreview();
  memberDraft();
});
window.addEventListener("workbench-busy", memberControls);
window.addEventListener("workbench-status", () => {
  memberControls();
  if (location.hash === "#portraits" && !memberState.catalog && !memberState.loading && state.token) action(loadMembers);
});
window.addEventListener("hashchange", () => {
  if (location.hash === "#portraits" && !memberState.catalog && state.token) action(loadMembers);
});
window.addEventListener("workbench-open-person", event => action(() => openPersonEditor(event.detail.id)));
window.addEventListener("beforeunload", event => {
  if (memberState.dirty || roleState.dirty) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("workbench-before-git", event => {
  if (memberState.dirty) event.detail.blockers.push("Save or discard the open person draft first.");
  if (roleState.dirty) event.detail.blockers.push("Save or discard the global participant role draft first.");
  if (state.busy || memberState.busy || memberState.loading) event.detail.busy.push("Wait for the current person or image operation.");
});
window.addEventListener("workbench-export-drafts", event => {
  if (roleState.dirty) {
    const draft = {
      original: roleState.selected, id: $("#participant-role-id").value, label: $("#participant-role-label").value,
      aliases: $("#participant-role-aliases").value.split("\n"), exempt_from_guest: $("#participant-role-exempt").checked,
      automatic_when: automaticRoleDraft(),
    };
    event.detail.operations.push(Promise.resolve().then(() =>
      downloadWorkbenchDraft("participant-role-draft.json", JSON.stringify(draft, null, 2), "application/json;charset=utf-8")));
  }
  if (!memberState.dirty) return;
  const draft = {
    original: memberState.original,
    member: { ...Object.fromEntries(memberFields.filter(field => field !== "role").map(field => [field, $(`#member-${field}`).value])),
      ...memberRoleValues(), social_links: [...(memberState.socialLinks || [])],
      show_profile_contacts: $("#member-show-profile-contacts").checked },
    aliases: $("#member-aliases").value.split("\n"),
    needs_review: $("#member-needs-review").checked,
    group: $("#member-group").value,
    categories: Array.from($("#member-custom-categories").querySelectorAll("input:checked"), input => input.value),
  };
  event.detail.operations.push(Promise.resolve().then(() =>
    downloadWorkbenchDraft("person-draft.json", JSON.stringify(draft, null, 2), "application/json;charset=utf-8")));
});
window.addEventListener("workbench-discard-drafts", () => {
  if (memberState.dirty) closeMember();
  if (roleState.dirty) selectRole();
});
memberControls();
