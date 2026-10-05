"use strict";

const memberState = { catalog: null, original: null, editing: false, dirty: false, busy: false, loading: false };
const memberFields = ["name", "nickname", "role", "bio", "image", "modal_image"];

function acceptMemberCatalog(catalog) {
  memberState.catalog = catalog;
  const members = catalog.groups.flatMap(group => group.members.map(member =>
    member.name + (member.nickname ? ` (${member.nickname})` : "")));
  window.dispatchEvent(new CustomEvent("workbench-members-changed", { detail: { members } }));
}

function memberDraft() {
  $("#member-draft").textContent = memberState.dirty ? "Unsaved draft" : "Saved";
  $("#portrait-member-target").textContent = memberState.editing ?
    `Converted portraits will fill the draft for ${$("#member-name").value || "this new member"}. Save member afterwards.` :
    "Standalone export: select or add a member above to assign a portrait.";
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

function memberControls() {
  const busy = memberState.busy || state.busy || memberState.loading || !state.token;
  $("#member-fields").disabled = busy;
  $("#member-new").disabled = busy || !memberState.catalog;
  $("#member-refresh").disabled = busy;
  document.querySelectorAll("#member-list button").forEach(button => { button.disabled = busy; });
}

function discardMember() {
  return !memberState.dirty || confirm("Discard unsaved member changes? Exported portrait files will be kept.");
}

function closeMember() {
  memberState.editing = false;
  memberState.original = null;
  memberState.dirty = false;
  $("#member-form").hidden = true;
  memberDraft();
  renderMembers();
}

function openMember(groupIndex, index = null) {
  if (memberState.busy || state.busy || !discardMember()) return;
  const member = index === null ? {} : memberState.catalog.groups[groupIndex].members[index];
  memberState.original = index === null ? null : { group: groupIndex, index };
  memberState.editing = true;
  memberState.dirty = index === null;
  $("#member-group").replaceChildren(...memberState.catalog.groups.map((group, i) => {
    const option = node("option", group.label);
    option.value = String(i);
    return option;
  }));
  $("#member-group").value = String(groupIndex);
  for (const field of memberFields) $(`#member-${field}`).value = member[field] || "";
  $("#member-heading").textContent = index === null ? "New member" : `Edit ${member.name}`;
  $("#member-delete").hidden = index === null;
  $("#member-form").hidden = false;
  $("#member-references").replaceChildren(node("p",
    "Renaming or removing this entry leaves historical participant/author names and all image files unchanged."));
  const references = member.references || [];
  if (references.length) {
    const details = document.createElement("details");
    details.append(node("summary", `${references.length} matching participant/author references`));
    const list = node("ul", "");
    for (const reference of references) list.append(node("li", `${reference.path}: ${reference.field} — ${reference.name}`));
    details.append(list);
    $("#member-references").append(details);
  }
  renderPortraitChoices();
  memberPreview();
  memberDraft();
  renderMembers();
  $("#member-name").focus();
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
  const search = $("#member-search").value.trim().toLocaleLowerCase("hu");
  const list = $("#member-list");
  list.replaceChildren();
  let count = 0;
  memberState.catalog.groups.forEach((group, groupIndex) => {
    const entries = group.members.map((member, index) => ({ member, index })).filter(({ member }) =>
      [member.name, member.nickname, member.role].filter(Boolean).join(" ").toLocaleLowerCase("hu").includes(search));
    if (!entries.length) return;
    list.append(node("h3", `${group.label} (${entries.length})`));
    for (const { member, index } of entries) {
      count++;
      const button = node("button", "", "secondary");
      button.type = "button";
      const selected = memberState.original?.group === groupIndex && memberState.original?.index === index;
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
      text.append(node("strong", member.name), node("small", [member.nickname, member.role].filter(Boolean).join(" · ")));
      button.append(text);
      button.addEventListener("click", () => openMember(groupIndex, index));
      list.append(button);
    }
  });
  if (!count) list.append(node("p", "No matching members. Add a member or change the search."));
  memberControls();
}

function renderMemberAudit() {
  const audit = memberState.catalog.audit;
  $("#member-audit-summary").textContent =
    `Roster & image checks: ${audit.missing_images.length} missing images, ${audit.unassigned_portraits.length} unassigned portraits, ${audit.unmatched_participants.length} unmatched participant entries, ${audit.unmatched_authors.length} unmatched authors`;
  const panel = $("#member-audit");
  panel.replaceChildren();
  for (const [title, items] of [
    ["Missing or invalid member images", audit.missing_images.map(item => `${item.name} / ${item.field}: ${item.url} — ${item.error}`)],
    ["Portrait files not assigned to the roster (kept on disk)", audit.unassigned_portraits],
    ["Participant names without a current roster match (may be guests)", audit.unmatched_participants.map(item => `${item.path}: ${item.name}`)],
    ["Author names without a current roster match", audit.unmatched_authors.map(item => `${item.path}: ${item.name}`)],
    ["Data / reference scan warnings", audit.warnings],
  ]) {
    panel.append(node("h3", `${title} (${items.length})`));
    const list = node("ul", "");
    if (!items.length) list.append(node("li", "None."));
    else for (const item of items) list.append(node("li", item));
    panel.append(list);
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
    if (notifyReload) notify("Roster reloaded. Review the current member entries and image checks.");
  } finally {
    memberState.loading = false;
    memberControls();
  }
}

async function saveMember() {
  if (memberState.busy || state.busy) return;
  const member = Object.fromEntries(memberFields.map(field => [field, $(`#member-${field}`).value]));
  memberState.busy = true;
  memberControls();
  try {
    const result = await api("/api/workbench/members/save", { method: "POST", payload: {
      revision: memberState.catalog.revision, original: memberState.original,
      group: Number($("#member-group").value), member,
    } });
    acceptMemberCatalog(result);
    memberState.dirty = false;
    memberState.busy = false;
    openMember(result.selected.group, result.selected.index);
    renderMemberAudit();
    notify("Member saved. Portrait assignments are saved; historical names and old image files were preserved.");
  } finally {
    memberState.busy = false;
    memberControls();
  }
}

async function deleteMember() {
  if (memberState.busy || state.busy || !memberState.original) return;
  const existing = memberState.catalog.groups[memberState.original.group].members[memberState.original.index];
  if (!confirm(`Remove ${existing.name} from the roster? ${(existing.references || []).length} matching report references and all portrait files will be preserved. Any unsaved draft changes will be discarded.`)) return;
  memberState.busy = true;
  memberControls();
  try {
    acceptMemberCatalog(await api("/api/workbench/members/delete", { method: "POST", payload: {
      revision: memberState.catalog.revision, original: memberState.original, confirm: true,
    } }));
    closeMember();
    renderMemberAudit();
    notify("Member removed from the roster only. Reports and portrait files were preserved; review the updated checks.");
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
    const assigned = new Set(memberState.catalog.groups.flatMap(group =>
      group.members.flatMap(member => [member.image, member.modal_image].filter(Boolean))));
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
$("#member-refresh").addEventListener("click", () => action(() => loadMembers(true)));
$("#member-new").addEventListener("click", () => openMember(0));
$("#member-cancel").addEventListener("click", () => { if (discardMember()) closeMember(); });
$("#member-delete").addEventListener("click", () => action(deleteMember));
$("#member-form").addEventListener("submit", event => { event.preventDefault(); action(saveMember); });
$("#member-form").addEventListener("input", () => {
  memberState.dirty = true;
  memberDraft();
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
window.addEventListener("beforeunload", event => {
  if (memberState.dirty) { event.preventDefault(); event.returnValue = ""; }
});
memberControls();
