"use strict";

function personMembershipLabel(person) {
  return person?.membership ?
    `Current member — ${person.membership.label || "membership assigned"}` : "Not a current member";
}

function personAutomaticStatus(person, definitions = [], section = "") {
  const course = section === "tanfolyamok" || (person?.course_participant ?? Boolean(
    person?.references?.some(reference => reference.section === "tanfolyamok" &&
      ["participant_ids", "participants"].includes(reference.field))));
  const facts = { current_member: Boolean(person?.membership), course_participant: course };
  const matches = definitions.filter(role => role.automatic_when &&
    Object.entries(role.automatic_when).every(([key, value]) => facts[key] === value));
  if (matches.length > 1) throw new Error("Automatic role rules overlap. Fix them in Manage roles.");
  return matches[0]?.label || (person?.membership ? personMembershipLabel(person) : "No automatic role configured");
}

function resolveRoleSelection(entry, definitions) {
  if (Array.isArray(entry?.roles)) return [...entry.roles];
  const legacy = entry?.role || "";
  if (!legacy) return [];
  const key = value => value.normalize("NFC").trim().toLocaleLowerCase("hu");
  const values = legacy.split(",").map(name => definitions.find(role =>
    [role.label, ...(role.aliases || [])].some(label => key(label) === key(name)))?.id);
  return values.every(Boolean) ? [...new Set(values)] : [];
}

function roleSelectionLabels(ids, definitions) {
  return ids.map(id => definitions.find(role => role.id === id)?.label || `Unknown role: ${id}`).join(", ");
}

function createRolePicker(entry, definitions, onChange, inputID, title) {
  const wrapper = node("div", "", "participant-role-picker");
  wrapper.append(node("strong", title));
  const legacy = entry?.role || "";
  const selected = resolveRoleSelection(entry, definitions);
  const chips = node("div", "", "person-category-chips");
  const update = ids => {
    onChange(ids);
    document.getElementById(inputID)?.focus();
  };
  for (const id of selected) {
    const label = roleSelectionLabels([id], definitions);
    const remove = node("button", `${label} ×`, "secondary category-chip");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove role ${label}`);
    remove.addEventListener("click", () => update(selected.filter(value => value !== id)));
    chips.append(remove);
  }
  wrapper.append(chips);
  if (legacy) {
    wrapper.append(node("p", selected.length ?
      `Historical text "${legacy}" matches ${roleSelectionLabels(selected, definitions)}. Editing the roles will save stable IDs.` :
      `Unconfigured historical role: "${legacy}". It stays unchanged until you choose a role or clear it.`,
    selected.length ? "hint" : "notice error"));
    const clear = node("button", "Clear historical role", "secondary");
    clear.type = "button";
    clear.addEventListener("click", () => update([]));
    wrapper.append(clear);
  }
  const label = node("label", "Add a role");
  const input = document.createElement("input");
  input.type = "search";
  input.id = inputID;
  input.dataset.selectSearch = "true";
  input.placeholder = "Type to choose a configured role";
  label.append(input);
  wrapper.append(label);
  attachSuggestions(input, {
    choices: () => definitions.filter(role => !selected.includes(role.id))
      .map(role => ({ label: role.label, id: role.id, search: [role.label, role.id, ...(role.aliases || [])].join(" ") })),
    select: role => update([...selected, role.id]),
  });
  if (!definitions.length) wrapper.append(node("p", "No global roles defined yet. Use Manage roles to create a choice.", "hint"));
  return wrapper;
}

function personParticipationLabel(person, section, role = "", definitions = []) {
  if (!person) return "Unknown registry identity — clarify before assigning";
  const ids = resolveRoleSelection(Array.isArray(role) ? { roles: role } : { role }, definitions);
  const label = Array.isArray(role) ? roleSelectionLabels(role, definitions) :
    ids.length ? roleSelectionLabels(ids, definitions) : role;
  if (label) return `${label} · Manual role on this page`;
  return personAutomaticStatus(person, definitions, section);
}
