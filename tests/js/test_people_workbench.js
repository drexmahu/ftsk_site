const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("./test_autocomplete");
require("./test_workbench_editors");
const { checkEditorBinding } = require("./test_workbench_editor_binding");
const { checkMemberCVSharing } = require("./test_member_cv_sharing");
const { checkFileNavigation } = require("./test_workbench_files");
const { checkMemberCVBatch } = require("./test_member_cv_batch");
const { checkUploadPreviews } = require("./test_upload_previews");
const gitChecks = require("./test_git_workbench");
const conversionChecks = require("./test_conversion_progress");

const script = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "content.js"), "utf8");
const peopleScript = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "people.js"), "utf8");
const memberScript = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "members.js"), "utf8");
const workbenchHtml = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "index.html"), "utf8");
const topbarHtml = workbenchHtml.match(/<header class="topbar">([\s\S]*?)<\/header>/)[1];
const appScript = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "web", "app.js"), "utf8");
{
  const values = { name: "Alice", nickname: "", image: "", modal_image: "", cv: "## Life", cv_label: " Nekrológ ", cv_subtitle: " 1931 – 2025 ", cv_author: " Writer Name ", group: "" };
  const context = { $: selector => ({ value: values[selector.slice("#member-".length)] }),
    memberState: { catalog: { groups: [] } } };
  vm.runInNewContext(memberScript.slice(memberScript.indexOf("function memberCVSnapshot("), memberScript.indexOf("\nasync function previewMemberCV(")), context);
  assert.equal(JSON.parse(context.memberCVSnapshot()).document_label, "Nekrológ");
  assert.equal(JSON.parse(context.memberCVSnapshot()).subtitle, "1931 – 2025");
  assert.equal(JSON.parse(context.memberCVSnapshot()).document_author, "Writer Name");
  assert.equal(JSON.parse(context.memberCVSnapshot()).cv_person.cv, undefined, "Document body is not identity data");
  assert.ok(memberScript.match(/const memberDocumentFields = .*"cv_subtitle"/), "Subtitle belongs to the document draft");
  values.cv_label = " ";
  assert.equal(JSON.parse(context.memberCVSnapshot()).document_label, "", "Blank preview labels use the public default");
  assert.ok(memberScript.match(/const memberDocumentFields = .*"cv_label"/), "Label is saved and exported with the document draft");
  context.memberDocumentFields = { body: "cv", label: "cv_label", subtitle: "cv_subtitle", author: "cv_author" };
  context.memberState.document = { path: "tagok/alice/index.md", revision: "document-revision" };
  assert.equal(context.memberDocumentDraft().body, "## Life");
  assert.equal(context.memberDocumentDraft().revision, "document-revision");
  assert.equal(context.memberDocumentDraft().author, " Writer Name ");
  const profileFields = JSON.parse(memberScript.match(/const memberFields = (\[[^\n]*\]);/)[1]);
  for (const field of ["cv", "cv_label", "cv_subtitle"]) {
    assert.ok(!profileFields.includes(field), `${field} must not be persisted as registry profile data`);
  }
}
{
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: true, addEventListener(event, callback) { this[event] = callback; } });
    return elements.get(selector);
  };
  get("#person-editor-dialog").open = true;
  get("#member-files-dialog").open = true;
  const context = { $: get };
  vm.runInNewContext(appScript.slice(appScript.indexOf("function notify("), appScript.indexOf("\nasync function api(")), context);
  context.notify("Conversion failed", "error");
  assert.equal(get("#person-dialog-error-text").textContent, "Conversion failed");
  assert.equal(get("#person-dialog-notice").hidden, false);
  assert.equal(get("#member-files-error").hidden, false);
  assert.equal(get("#member-files-error-text").textContent, "Conversion failed");
  context.notify("Uploading another photo", "busy");
  assert.equal(get("#person-dialog-error-text").textContent, "Conversion failed", "Progress must not erase a modal error");
  context.notify("Photo uploaded");
  assert.equal(get("#person-dialog-notice").hidden, false, "Errors remain until explicitly dismissed");
  vm.runInNewContext(memberScript.slice(memberScript.indexOf('$("#person-dialog-dismiss-error").addEventListener('), memberScript.indexOf('$("#member-cv-clear-file").addEventListener(')), context);
  get("#person-dialog-dismiss-error").click();
  assert.equal(get("#person-dialog-notice").hidden, true);
  assert.equal(get("#member-files-error").hidden, false, "Dismissal is scoped to the current dialog");
  get("#member-files-dismiss-error").click();
  assert.equal(get("#member-files-error").hidden, true);
  context.notify("Another error", "error");
  assert.equal(get("#person-dialog-notice").hidden, false, "A subsequent error reopens the banner");
  assert.match(workbenchHtml, /id="person-dialog-notice"[^>]*><span[^>]*><\/span><button id="person-dialog-dismiss-error"[^>]*>Dismiss error<\/button><\/div>/);
  assert.match(workbenchHtml, /id="member-files-error"[^>]*><span[^>]*><\/span><button id="member-files-dismiss-error"[^>]*>Dismiss error<\/button><\/div>/);
}
{
  const controls = new Map();
  const get = selector => {
    if (!controls.has(selector)) controls.set(selector, { value: "", dataset: {}, removeAttribute(name) { delete this[name]; } });
    return controls.get(selector);
  };
  const context = { $: get, Date, memberState: { editing: true, original: { id: "alice" }, catalog: { people: [] } },
    state: { token: "ready" }, memberMergePlan: null, memberRenamePlan: null,
    document: { querySelectorAll: () => [] }, renderMemberDeletion() {} };
  vm.runInNewContext(memberScript.slice(memberScript.indexOf("function memberPreview("), memberScript.indexOf("\nfunction renderMemberSocialLinks(")), context);
  get("#member-image").value = "/images/members/alice/alice_thumb.webp";
  context.memberPreview();
  assert.equal(get("#person-dialog-avatar").hidden, false);
  assert.equal(get("#person-dialog-avatar").src.split("?")[0], get("#member-avatar").src.split("?")[0]);
  get("#member-image").value = "";
  context.memberPreview();
  assert.equal(get("#person-dialog-avatar").hidden, true);
  assert.equal(get("#person-dialog-avatar").src, undefined);
  vm.runInNewContext(memberScript.slice(memberScript.indexOf("function memberControls("), memberScript.indexOf("\nfunction memberDeletionReasons(")), context);
  context.memberControls();
  assert.equal(get("#member-save").disabled, false);
  context.state.busy = true;
  context.memberControls();
  assert.equal(get("#member-save").disabled, true, "Header save must remain locked outside the form fieldset");
  assert.equal(get("#member-cancel").disabled, true);
  context.memberState.editing = false;
  context.memberControls();
  assert.equal(get("#member-save").hidden, true, "Standalone export must not show person save controls");
  assert.match(workbenchHtml, /id="member-save"[^>]*type="submit"[^>]*form="member-form"/);
  assert.match(workbenchHtml, /class="person-dialog-identity"><img id="person-dialog-avatar"[^>]*><h2 id="person-dialog-heading"/);
}
{
  const context = { state: { portraits: [{ id: "alice-photo", owner: "alice" }, { id: "bob-photo", owner: "bob" },
    { id: "standalone-photo" } ] }, window: { memberEditor: { editing: true, queueOwner: "alice" } } };
  vm.runInNewContext(appScript.slice(appScript.indexOf("function currentPortraitOwner("), appScript.indexOf("\nfunction queueView(")), context);
  assert.deepEqual(Array.from(context.portraitQueue(), file => file.id), ["alice-photo"]);
  context.window.memberEditor.queueOwner = "bob";
  assert.deepEqual(Array.from(context.portraitQueue(), file => file.id), ["bob-photo"]);
  context.window.memberEditor.editing = false;
  assert.deepEqual(Array.from(context.portraitQueue(), file => file.id), ["standalone-photo"]);
}
async function checkMediaDropZones() {
  const listeners = {}, accepted = [], errors = [];
  const zone = { classList: { add() {}, remove() {} }, addEventListener: (event, callback) => { listeners[event] = callback; } };
  const input = { disabled: false, closest: () => zone,
    addEventListener: (event, callback) => { listeners["input-" + event] = callback; } };
  const context = { $: () => input, state: { busy: false }, window: {}, renderUploadPreviews() {},
    action: async operation => { try { await operation(); } catch (error) { errors.push(error.message); } } };
  vm.runInNewContext(appScript.slice(appScript.indexOf("function setupFileDrop("), appScript.indexOf("\nfunction setupUploads(")), context);
  context.setupFileDrop("#photo", files => accepted.push(files));
  const files = [{ name: "portrait.jpg" }];
  let stopped = false;
  await listeners.drop({ preventDefault() {}, stopPropagation() { stopped = true; }, dataTransfer: { files } });
  await Promise.resolve();
  assert.equal(accepted[0], files);
  assert.equal(stopped, true, "A drop must not also select images in another workspace");
  input.disabled = true;
  await listeners.drop({ preventDefault() {}, stopPropagation() {}, dataTransfer: { files } });
  await Promise.resolve();
  assert.equal(accepted.length, 1);
  assert.match(errors[0], /Wait/);
}
for (const section of ["profile", "portraits", "membership", "contacts", "cv", "history", "advanced"]) {
  assert.ok(workbenchHtml.includes(`data-member-tab="${section}"`));
  assert.ok(workbenchHtml.includes(`data-member-section="${section}"`));
}
assert.ok(appScript.includes('"/api/workbench/members/portrait-upload-plan"'));
assert.ok(appScript.includes("payload.overwrite_files = plan.files"));
{
  const context = {};
  vm.runInNewContext(memberScript.slice(memberScript.indexOf("function memberCVImageMarkdown("),
    memberScript.indexOf("\nasync function browseMemberCVImages(")), context);
  assert.equal(context.memberCVImageMarkdown("/images/members/alice/cave.webp", "A [cave]", 'A "caption"'),
    '\n\n![A \\[cave\\]](/images/members/alice/cave.webp "A \\"caption\\"")\n\n');
  assert.throws(() => context.memberCVImageMarkdown("/images/members/alice/cave.webp", "", ""), /alt text/);
  assert.throws(() => context.memberCVImageMarkdown("javascript:alert(1)", "Cave", ""), /local/);
  for (const id of ["member-cv", "member-cv_label", "member-cv_subtitle", "member-cv-upload", "member-cv-preview", "member-group-hint-save", "category-hint"]) {
    assert.ok(workbenchHtml.includes(`id="${id}"`));
  }
  assert.ok(memberScript.includes('"/api/workbench/members/cv-image"'));
}
{
  const values = { "#member-image": "", "#member-modal_image": "", "#member-cv": "![Photo](/images/members/alice/photo.webp)" };
  const context = { memberState: { editing: true }, $: selector => ({ value: values[selector] }), encodeURI };
  vm.runInNewContext(memberScript.slice(memberScript.indexOf("function memberCVReferencesImage("),
    memberScript.indexOf("\nasync function browseMemberCVImages(")), context);
  vm.runInNewContext(memberScript.slice(memberScript.indexOf("function checkPortraitDraft("),
    memberScript.indexOf("\nasync function reviewPortraitDeletion(")), context);
  assert.throws(() => context.checkPortraitDraft(["/images/members/alice/photo.webp"]), /open CV draft/);
  assert.doesNotThrow(() => context.checkPortraitDraft(["/images/members/alice/unused.webp"]));
  context.memberState.editing = false;
  assert.doesNotThrow(() => context.checkPortraitDraft(["/images/members/alice/photo.webp"]));
}
{
  const output = {};
  let meta = { title: "Article title", featuredImg: { image_path: "/images/banner.webp" },
    seo: { social_image: "/images/custom.webp", social_title: "Share title", social_description: "Share description" } };
  const context = { studio: { page: { guided: true } }, currentMeta: () => meta, $: () => output };
  vm.runInNewContext(script.slice(script.indexOf("  function updateSocialNote("),
    script.indexOf("\n  async function refreshCatalog(")), context);
  context.updateSocialNote();
  assert.match(output.textContent, /Exact social image: \/images\/custom.webp/);
  assert.match(output.textContent, /Share title: Share title/);
  meta.seo.social_image = "";
  context.updateSocialNote();
  assert.match(output.textContent, /Generated social-card background: \/images\/banner.webp/);
  for (const field of ["seo.social_image", "seo.social_title", "seo.social_description"]) {
    assert.ok(script.includes(`["${field}",`), "Share overrides need guided editor controls");
  }
}
for (const id of ["photo-files", "portrait-files", "content-image-files"]) {
  const input = workbenchHtml.match(new RegExp(`<input id="${id}"[^>]+>`))[0];
  assert.ok(input.includes(".heif,.heic"), "Every photo input must allow HEIF/HEIC originals");
}
for (const removedId of ["preview-title", "preview-description"]) {
  assert.ok(!workbenchHtml.includes(`id="${removedId}"`));
  assert.ok(!appScript.includes(`#${removedId}`), "Status polling must not reference the removed preview tile");
}
for (const action of ["start-preview", "stop-preview"]) {
  assert.equal(workbenchHtml.split(`data-action="${action}"`).length - 1, 1);
  assert.ok(topbarHtml.includes(`data-action="${action}"`), "Preview controls must be available in every view's header");
}
{
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, {});
    return elements.get(selector);
  };
  const context = {
    state: { initialized: true, jobState: "idle" }, $: get,
    document: { querySelectorAll: selector => [get(selector)] },
    window: { dispatchEvent() {} },
    CustomEvent: class { constructor(name, options) { this.detail = options.detail; } },
  };
  vm.runInNewContext(appScript.slice(appScript.indexOf("function updateStatus("), appScript.indexOf("\nasync function poll(")), context);
  for (const [responsive, owned, previewState, label] of [
    [false, true, "starting", "Starting preview"],
    [true, true, "running", "Preview running"],
    [true, false, "running", "Existing preview"],
    [false, false, "stopped", "Preview offline"],
  ]) {
    context.updateStatus({
      preview: { responsive, owned, state: previewState, url: "http://127.0.0.1:1313/", log: "Total in 123 ms" },
      job: { state: "idle" },
    });
    assert.equal(get("#preview-state").textContent, label);
    assert.equal(get('[data-action="stop-preview"]').disabled, !owned);
    assert.equal(get('[data-action="start-preview"]').disabled, owned);
    assert.equal(get("#preview-log").textContent, "Total in 123 ms");
  }
}

async function checkReferenceNavigation(reference, expected, allowOpen = true) {
  const start = script.indexOf('  window.addEventListener("workbench-open-page"');
  const end = script.indexOf("\n  syntaxHelp();", start);
  assert.ok(start >= 0 && end > start);
  let handler;
  let opened;
  const studio = { original: "other/page.md" };
  const location = { hash: "#portraits" };
  vm.runInNewContext(script.slice(start, end), {
    window: { addEventListener: (name, callback) => { handler = callback; } },
    studio, location,
    run: operation => operation(),
    openPage: async value => {
      opened = value;
      if (allowOpen) studio.original = value;
    },
  });
  const event = { detail: { path: reference } };
  await handler(event);
  assert.equal(opened, expected);
  assert.equal(event.detail.path, reference, "Reference/scanner paths must not be mutated");
  assert.equal(location.hash, allowOpen ? "#content" : "#portraits");
}

function element(tag, text = "", className = "") {
  return {
    tag, text, className, children: [], dataset: {}, listeners: {}, attributes: {},
    classList: { add() {}, toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; delete this[name]; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    focus() { this.focused = true; },
  };
}

function checkPersonAvatars() {
  const start = script.indexOf("  function personLabel(");
  const end = script.indexOf("\n  function personPicker(", start);
  const people = [
    { id: "alice", name: "Alice Example", image: "/images/members/alice_thumb.webp" },
    { id: "guest", name: "Ács Réka" },
    { id: "single", name: "Irene" },
  ];
  const tags = [];
  const events = [];
  const context = {
    studio: { catalog: { people } }, node: element,
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
    document: {
      createElement: element,
      querySelectorAll: selector => selector === "[data-person-id]" ? tags : [],
    },
  };
  vm.runInNewContext(peopleScript, context);
  vm.runInNewContext(script.slice(start, end), context);
  const photo = context.personTag("alice");
  const guest = context.personTag("guest");
  const single = context.personTag("single");
  const unknown = context.personTag("missing-id");
  const [avatar, label] = photo.children;
  assert.equal(avatar.attributes["aria-hidden"], "true");
  assert.equal(avatar.children[0].src, "/images/members/alice_thumb.webp");
  assert.equal(avatar.children[0].alt, "");
  assert.equal(avatar.children[0].loading, "lazy");
  assert.ok(label.text.includes("Alice Example"));
  assert.equal(photo.tag, "button");
  assert.equal(photo.type, "button");
  assert.equal(photo.attributes["aria-label"], "Edit person: Alice Example [alice]");
  photo.listeners.click();
  assert.equal(events[0].type, "workbench-open-person");
  assert.equal(events[0].detail.id, "alice");
  assert.equal(guest.children[0].text, "ÁR");
  assert.equal(guest.children[0].children.length, 0);
  assert.equal(single.children[0].text, "I");
  assert.ok(unknown.children[1].text.includes("Unknown registry identity"));
  assert.equal(unknown.disabled, true);
  tags.push(photo, guest);
  people[0].image = "/images/members/new_thumb.webp";
  people[1].name = "Réka Updated";
  people[1].image = "/images/members/guest_thumb.webp";
  const refreshStart = script.indexOf("  function refreshPeoplePickers(");
  const refreshEnd = script.indexOf("\n  function assignParticipants(", refreshStart);
  context.activePath = () => "turak/test.md";
  vm.runInNewContext(script.slice(refreshStart, refreshEnd), context);
  context.refreshPeoplePickers();
  assert.equal(photo.children[0].children[0].src, people[0].image);
  assert.equal(guest.children[0].children[0].src, people[1].image);
  assert.ok(guest.children[1].text.includes("Réka Updated"));
  delete people[0].image;
  context.refreshPeoplePickers();
  assert.equal(photo.children[0].text, "AE");
  assert.equal(photo.children[0].children.length, 0);
}

function checkParticipationLabels() {
  const context = {};
  vm.runInNewContext(peopleScript, context);
  const member = { membership: { label: "Rendes tagok" } };
  const student = { membership: null, references: [{ section: "tanfolyamok", field: "participant_ids" }] };
  const roles = [{ id: "student", label: "Tanuló", aliases: ["student", "hallgató"], exempt_from_guest: true },
    { id: "helper", label: "Segítő", aliases: [], exempt_from_guest: false },
    { id: "course-status", label: "tanfolyami résztvevő", automatic_when: { current_member: false, course_participant: true } },
    { id: "guest-status", label: "vendég" }];
  assert.equal(context.personMembershipLabel(member), "Current member — Rendes tagok");
  assert.equal(context.personParticipationLabel(student, "turak", "", roles), "tanfolyami résztvevő");
  assert.equal(context.personParticipationLabel({ membership: null }, "turak", "", roles), "No automatic role configured");
  assert.equal(context.personParticipationLabel({ references: [{ section: "tanfolyamok", field: "author_id" }] }, "turak", "", roles), "No automatic role configured");
  assert.equal(context.personParticipationLabel({ membership: null }, "turak", ["guest-status"], roles), "vendég · Manual role on this page");
  assert.equal(context.personParticipationLabel(member, "turak", "", roles), "Current member — Rendes tagok");
  for (const role of ["student", " Student ", "tanuló", "hallgató"]) {
    assert.equal(context.personParticipationLabel(student, "turak", role, roles), "Tanuló · Manual role on this page");
  }
  assert.equal(context.personParticipationLabel(student, "turak", "guide"), "guide · Manual role on this page");
  assert.equal(context.personParticipationLabel(student, "tanfolyamok", "student"), "student · Manual role on this page");
  assert.equal(context.personParticipationLabel(member, "tanfolyamok", "instructor"), "instructor · Manual role on this page");
  assert.equal(context.personParticipationLabel(member, "turak", "guide"), "guide · Manual role on this page");
  assert.ok(context.personParticipationLabel(null, "turak").includes("Unknown"));
  assert.equal(context.personParticipationLabel(student, "turak", ["student", "helper"], roles),
    "Tanuló, Segítő · Manual role on this page");
  roles[0].exempt_from_guest = false;
  assert.equal(context.personParticipationLabel(student, "turak", ["student"], roles),
    "Tanuló · Manual role on this page", "Any manual role overrides fallback");
  roles[2].label = "Renamed automatic role";
  assert.equal(context.personParticipationLabel(student, "turak", "", roles), "Renamed automatic role");
  roles[2].automatic_when = undefined;
  assert.equal(context.personParticipationLabel(student, "turak", "", roles), "No automatic role configured");
}

function checkPersonOverview() {
  const overview = element("section");
  const group = { value: "" };
  const person = { id: "guest", membership: null, references: [
    { section: "tanfolyamok", field: "participant_ids", title: "Course 2025", path: "content/tanfolyamok/2025.md", role: "student", date: "2025-01-01" },
    { section: "turak", field: "participant_ids", title: "Expedition", path: "content/turak/trip.md", role: "" },
    { section: "tanfolyamok", field: "author_id", title: "Course credit", path: "content/tanfolyamok/credit.md" },
  ] };
  const events = [];
  const context = {
    memberState: { editing: true, original: { id: "guest" }, dirty: false,
      catalog: { people: [person], groups: [{ label: "Rendes tagok" }], audit: { warnings: [] } } },
    $: selector => ({ "#member-overview": overview, "#member-group": group, "#member-role": { value: "" } })[selector],
    node: element,
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
  };
  vm.runInNewContext(peopleScript, context);
  const start = memberScript.indexOf("function renderPersonOverview(");
  const end = memberScript.indexOf("\nasync function openPersonEditor(", start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  context.renderPersonOverview();
  const flattened = entry => [entry, ...entry.children.flatMap(flattened)];
  const entries = flattened(overview);
  assert.ok(entries.some(entry => entry.text === "Not a current member"));
  assert.ok(entries.some(entry => entry.textContent === "Courses / participant history (1 / 1)"));
  assert.ok(entries.some(entry => entry.text === "student · Manual role on this page"));
  assert.ok(entries.some(entry => entry.text === "No automatic role configured"));
  assert.ok(entries.some(entry => entry.textContent === "Authorship, contacts & other contributions (1 / 1)"));
  const expeditionButton = entries.find(entry => entry.tag === "button" && entry.children[0]?.text === "Expedition");
  expeditionButton.listeners.click();
  assert.equal(events[0].detail.path, "content/turak/trip.md");
  group.value = "0";
  context.memberState.dirty = true;
  context.renderPersonOverview();
  assert.ok(flattened(overview).some(entry => entry.text === "Current member — Rendes tagok"));
  assert.ok(flattened(overview).some(entry => entry.text.includes("unsaved draft")));
  // Classification still reflects saved membership until the draft is saved.
  assert.ok(flattened(overview).some(entry => entry.text === "No automatic role configured"));
  const search = flattened(overview).find(entry => entry.id === "member-history-search");
  const sections = () => overview.children.filter(entry => entry.className === "person-history");
  const counts = () => sections().map(section => section.children[0].textContent);
  const filter = value => { search.value = value; search.listeners.input(); };
  context.memberState.dirty = false;
  filter("COURSE 2025 student");
  assert.deepEqual(counts(), ["Courses / participant history (1 / 1)", "Expeditions & trips (0 / 1)",
    "Authorship, contacts & other contributions (0 / 1)"]);
  assert.equal(context.memberState.dirty, false, "History search is not a profile edit");
  filter("2025-01-01");
  assert.equal(sections()[0].children[1].children[0].hidden, false);
  filter("content/turak");
  assert.equal(sections()[1].children[1].children[0].hidden, false);
  assert.equal(sections()[0].children[1].hidden, true);
  filter("Author");
  assert.equal(sections()[2].children[1].children[0].hidden, false);
  filter("no such contribution");
  assert.ok(sections().every(section => section.children[1].hidden && !section.children[2].hidden));
  assert.ok(sections().every(section => section.children[2].textContent === "No contributions match this search."));
  const clear = flattened(overview).find(entry => entry.text === "Clear search");
  clear.listeners.click();
  assert.equal(search.value, "");
  assert.equal(search.focused, true);
  assert.ok(sections().every(section => !section.children[1].hidden));
  assert.ok(sections().every(section => section.children[1].tabIndex === 0));
  assert.equal(sections()[1].children[1].attributes["aria-label"], "Expeditions & trips");
  filter("trip");
  context.renderPersonOverview();
  assert.equal(flattened(overview).find(entry => entry.id === "member-history-search").value, "trip",
    "Membership overview rerenders retain the search");

  person.references.push(...Array.from({ length: 100 }, (_, i) => ({
    section: "turak", field: "participant_ids", title: `Árvíztűrő expedition ${i}`,
    path: `content/turak/trip-${i}.md`, date: `2020-${i}`, role: "túravezető",
  })));
  context.memberState.historySearch = "ARVIZTURO 2020-99 turavezeto";
  context.renderPersonOverview();
  assert.equal(counts()[1], "Expeditions & trips (1 / 101)");
  const tripList = sections()[1].children[1];
  assert.equal(tripList.children.filter(button => !button.hidden).length, 1);
  tripList.children.find(button => !button.hidden).listeners.click();
  assert.equal(events.at(-1).detail.path, "content/turak/trip-99.md");
  assert.equal(person.references.length, 103, "Filtering must preserve saved reference data");
  person.references = [];
  context.renderPersonOverview();
  assert.ok(sections().every(section => section.children[0].textContent.endsWith("(0 / 0)")));
  assert.equal(sections()[1].children[2].textContent, "No saved expedition or trip participation.");
}

async function checkPersonEditorNavigation(allowOpen, failed = false) {
  const state = { busy: false };
  const memberState = { busy: false, loading: false };
  const location = { hash: "#content" };
  let selected, scrolled = false;
  const context = {
    memberState, state, location,
    memberControls() {}, renderMemberAudit() {}, acceptMemberCatalog() {},
    api: async () => ({ people: [{ id: failed ? "other" : "guest" }] }),
    openMember: id => { selected = id; return allowOpen; },
    $: () => ({ scrollIntoView: () => { scrolled = true; } }),
  };
  const start = memberScript.indexOf("async function openPersonEditor(");
  const end = memberScript.indexOf("\nfunction memberIdentityWarning(", start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  if (failed) await assert.rejects(context.openPersonEditor("guest"), /no longer exists/);
  else await context.openPersonEditor("guest");
  assert.equal(memberState.loading, false);
  assert.equal(location.hash, allowOpen && !failed ? "#portraits" : "#content");
  assert.equal(scrolled, allowOpen && !failed);
  if (!failed) assert.equal(selected, "guest");
}

async function checkImageField() {
  const start = script.indexOf("  function field(");
  const end = script.indexOf("\n  function personLabel(", start);
  assert.ok(start >= 0 && end > start);
  const picks = [];
  const changes = [];
  const context = {
    document: { createElement: element },
    node: element,
    get: (meta, key) => meta[key],
    run: operation => operation(),
    openMediaPicker: async (...args) => { picks.push(args); },
  };
  vm.runInNewContext(script.slice(start, end), context);
  const wrapper = context.field(["image_path", "Flyer", "image"], { image_path: "/images/flyer.webp" },
    (key, value) => changes.push([key, value]), "flyer_images-0-");
  const [input, button] = wrapper.children;
  assert.equal(input.id, "field-flyer_images-0-image_path", "Repeater prefixes belong to field inputs");
  input.value = "/images/new.webp";
  input.listeners.input();
  assert.deepEqual(changes, [["image_path", "/images/new.webp"]]);
  assert.equal(button.type, "button");
  await button.listeners.click();
  assert.deepEqual(picks[0].slice(0, 3), ["images", "Flyer", "/images/new.webp"]);
  picks[0][3]("/images/chosen.webp");
  assert.deepEqual(changes.at(-1), ["image_path", "/images/chosen.webp"], "Picker assigns the flyer, not the banner");
  assert.ok(script.includes('["featuredImg.width", "Featured image width (%)'));
  const sizing = context.field(["featuredImg.width", "Featured image width (%)", "number", "100"],
    { "featuredImg.width": 40 }, (key, value) => changes.push([key, value]));
  const width = sizing.children[0];
  assert.equal(width.id, "field-featuredImg-width");
  assert.equal(width.min, "10");
  assert.equal(width.max, "100");
  assert.equal(width.step, "any");
  width.value = "62.5";
  width.listeners.input();
  assert.deepEqual(changes.at(-1), ["featuredImg.width", 62.5]);
  width.value = "";
  width.listeners.input();
  assert.deepEqual(changes.at(-1), ["featuredImg.width", null], "Clearing width restores the default");
}

async function checkMediaPicker() {
  const controls = new Map();
  const get = selector => {
    if (!controls.has(selector)) {
      const control = element("control");
      control.value = "";
      control.showModal = () => { control.open = true; };
      control.close = () => { control.open = false; };
      controls.set(selector, control);
    }

    return controls.get(selector);
  };
  get("#post-image-folder").value = "tanfolyamok/2020";
  get("#pdf-folder").value = "turak/old";
  const studio = { tab: "course", mediaTarget: null, pickerFiles: [] };
  let assigned, origin;
  const requests = [];
  const context = {
    studio, $: get, node: element, document: { createElement: element },
    updateOwnedMediaFolders: () => "tanfolyamok/2020",
    URLSearchParams, run: operation => operation(), feedback() {}, renderForms() {},
    switchPanel: value => { origin = value; },
    api: async url => {
      requests.push(url);
      const kind = new URL(url, "http://fixture").searchParams.get("kind");
      return { folders: ["other"], files: [{ url: `/${kind}/old/file.${kind === "images" ? "webp" : "pdf"}`, name: "file", bytes: 1000 }] };
    },
  };
  const start = script.indexOf("  async function openMediaPicker(");
  const end = script.indexOf("\n  async function browseAssets(", start);
  vm.runInNewContext(script.slice(start, end), context);
  await context.openMediaPicker("images", "Flyer", "/images/old%20folder/poster.webp", url => { assigned = url; });
  assert.equal(get("#media-picker-folder").value, "tanfolyamok/2020");
  assert.equal(studio.mediaTarget.borrowedFolder, "old folder", "The current borrowed assignment remains accessible without controlling uploads");
  assert.equal(new URL(requests.at(-1), "http://fixture").searchParams.get("folder"), "tanfolyamok/2020");
  await get("#media-picker-files").children[0].listeners.click();
  assert.equal(assigned, "/images/old/file.webp");
  assert.equal(origin, "course");
  assert.equal(studio.mediaTarget, null);
  assert.equal(get("#media-picker").open, false);
  studio.tab = "media";
  await context.openMediaPicker("pdfs", "PDF report", "", url => { assigned = url; });
  assert.equal(get("#media-picker-folder").value, "tanfolyamok/2020");
  assert.throws(() => context.assignMedia("/images/not-a-pdf.webp"), /destination type/);
  await get("#media-picker-files").children[0].listeners.click();
  assert.equal(assigned, "/pdfs/old/file.pdf");
  assert.equal(origin, "media");
  await context.openMediaPicker("images", "Banner", "", () => { throw Error("Cancelled picker assigned a file"); });
  context.cancelMediaPicker();
  assert.equal(studio.mediaTarget, null);
  assert.equal(get("#media-picker").open, false);
}

function checkPageAssetFolders() {
  const controls = new Map();
  const get = selector => {
    if (!controls.has(selector)) controls.set(selector, { value: "hero" });
    return controls.get(selector);
  };
  const context = {
    suggestedFolder: path => path.replace(/(?:\/index)?\.md$/, ""),
    $: get, activePath: () => "tanfolyamok/tanfolyam-2022.md",
  };
  const start = script.indexOf("  function pageAssetFolder(");
  const end = script.indexOf("\n  function setBusy(", start);
  vm.runInNewContext(script.slice(start, end), context);
  const page = {
    path: "tanfolyamok/old/index.md",
    metadata: { featuredImg: { image_path: "/images/archive%20photos/banner.webp" } },
    source: '---\ntitle: Old\n---\n{{< pdf src="/pdfs/reports/old.pdf" >}}\n',
  };
  assert.equal(context.pageAssetFolder(page), "tanfolyamok/old");
  assert.equal(context.pageAssetFolder({
    ...page, path: "tanfolyamok/tanfolyam-2022.md",
    metadata: { featuredImg: { image_path: "/images/hero/ftsk-cave-hero.jpg" } },
  }), "tanfolyamok/tanfolyam-2022", "Shared banner folders must never become upload destinations");
  assert.equal(context.pageAssetFolder({ ...page, metadata: {}, source: "---\ntitle: Empty\n---\n" }), "tanfolyamok/old");
  context.updateOwnedMediaFolders();
  for (const selector of ["#post-image-folder", "#content-image-folder", "#pdf-folder"]) {
    assert.equal(get(selector).value, "tanfolyamok/tanfolyam-2022", "Restored or tampered destinations must be reset to the page-owned folder");
  }

  assert.match(script, /rootAPI \+ "convert"/);
  assert.ok(!script.includes('api("/api/workbench/convert"'), "Page uploads must use the enforced content API");
  for (const id of ["post-image-folder", "content-image-folder", "pdf-folder"]) {
    assert.match(workbenchHtml, new RegExp(`<input id="${id}" readonly`));
  }
}

function checkEditorWorkspaceNavigation() {
    const controls = new Map();
    const get = selector => {
      if (!controls.has(selector)) controls.set(selector, element("control"));
      return controls.get(selector);
    };
    const contentTabs = ["write", "metadata", "contacts", "course", "seo"].map(name => {
      const button = get(`[data-editor-tab="${name}"]`);
      button.dataset.editorTab = name;
      return button;
    });
    const tools = ["page-media", "media", "placement", "source"].map(name => {
      const button = element("button");
      button.dataset.editorTool = name;
      return button;
    });
    const panels = [...contentTabs.map(button => button.dataset.editorTab), "page-media", "media", "placement", "source", "preview"].map(name => {
      const panel = element("section");
      panel.dataset.editorPanel = name;
      return panel;
    });
    const studio = { contentTab: "write", page: { source: "current source" } };
    const context = {
      studio, $: get,
      document: { querySelectorAll: selector => selector === "[data-editor-panel]" ? panels :
        selector === "[data-editor-tab]" ? contentTabs : tools },
    };
    const start = script.indexOf("  function switchPanel(");
    const end = script.indexOf("\n  async function showTab(", start);
    vm.runInNewContext(script.slice(start, end), context);
    context.switchPanel("metadata");
    assert.equal(studio.contentTab, "metadata");
    assert.equal(get("#editor-content-navigation").hidden, false);
    context.switchPanel("media");
    assert.equal(studio.contentTab, "metadata", "Page tools preserve the last content section");
    assert.equal(get("#editor-content-navigation").hidden, true);
    assert.equal(get("#editor-tool-title").textContent, "Add images & PDFs");
    assert.equal(tools[1].attributes["aria-pressed"], "true");
    assert.equal(panels.filter(panel => !panel.hidden).length, 1);
    context.switchPanel("preview");
    assert.equal(get("#editor-tool-title").textContent, "Whole-page preview");
    assert.equal(contentTabs.every(button => button.attributes["aria-selected"] === "false"), true);
    context.switchPanel("source");
    assert.equal(get("#post-source").value, "current source");
    context.switchPanel(studio.contentTab);
    assert.equal(get("#editor-content-navigation").hidden, false);
    assert.equal(get("#editor-tool-heading").hidden, true);
    assert.equal(contentTabs[1].attributes["aria-selected"], "true");
    const tablist = workbenchHtml.match(/class="editor-tabs"[\s\S]*?<\/div>/)[0];
    for (const name of ["page-media", "media", "placement", "preview", "source"]) {
      assert.ok(!tablist.includes(`data-editor-tab="${name}"`), "Whole-page tools must not compete with content tabs");
    }
    assert.match(workbenchHtml, /data-editor-panel="contacts"[\s\S]*?id="people-assignments"[\s\S]*?id="contact-assignments"/,
      "People assignments and contact cards belong in one content section");
}

async function checkPageMediaActions() {
  const controls = new Map();
  const get = selector => {
    if (!controls.has(selector)) {
      const control = element("control");
      control.value = ""; control.hidden = true;
      control.showModal = () => { control.open = true; };
      control.close = () => { control.open = false; };
      control.focus = () => {};
      control.setSelectionRange = (start, end) => { control.selection = [start, end]; };
      controls.set(selector, control);
    }
    return controls.get(selector);
  };
  const original = '---\ntitle: Page\n---\n![Story](/images/story.webp)\n';
  const removed = '---\ntitle: Page\n---\n';
  const studio = { page: { source: original }, changes: {}, selected: new Map(), pageMedia: [], mediaReview: null };
  const calls = [];
  let dirty = false;
  const files = [
    { url: "/images/story.webp", name: "story.webp", kind: "images", linked: true, references: ["content/page.md"], missing: false },
    { url: "/images/shared.webp", name: "shared.webp", kind: "images", linked: false, references: ["data/hero.yaml"], missing: false },
    { url: "/images/unused.webp", name: "unused.webp", kind: "images", linked: false, references: [], missing: false, revision: "reviewed-revision" },
  ];
  const context = {
    studio, $: get, node: element, rootAPI: "/content/", feedback() {}, notify() {}, renderForms() {},
    pageAssetFolder: () => "page", activePath: () => "page.md",
    document: { createElement: tag => ({ ...element(tag), tagName: tag.toUpperCase() }) },
    run: operation => operation(),
    sync: async () => ({ source: studio.page.source, path: "page.md" }),
    markDirty: () => { dirty = true; },
    showTab: async () => { get("#post-source").value = studio.page.source; },
    api: async (url, options) => {
      calls.push([url, options.payload]);
      if (url.endsWith("page-media")) return { files, image_folders: [], pdf_folders: [] };
      if (url.endsWith("remove-reference")) return { source: removed, removed: ["Markdown image"], remaining: false };
      if (url.endsWith("compose")) return { source: options.payload.source, body: "", metadata: { title: "Page" } };
      if (url.endsWith("delete-asset")) return { deleted: options.payload.url };
      throw Error(`Unexpected request ${url}`);
    },
  };
  const start = script.indexOf("  async function refreshPageMedia(");
  const end = script.indexOf("\n  async function deletionDialog(", start);
  vm.runInNewContext(script.slice(start, end), context);
  await context.refreshPageMedia();
  const deleteButtons = get("#page-media-files").children.map(row => row.children[1].children.at(-1).children.at(-1));
  assert.deepEqual(deleteButtons.map(button => button.disabled), [true, true, false], "Draft and saved references block permanent deletion");
  await context.findMediaReference("/images/story.webp");
  assert.equal(get("#post-source").value.slice(...get("#post-source").selection), "/images/story.webp");
  await context.reviewMediaRemoval("/images/story.webp");
  assert.equal(studio.page.source, original, "Review alone does not change the draft");
  assert.equal(get("#remove-media-dialog").open, true);
  studio.page.source = original + "Changed";
  await assert.rejects(context.applyMediaRemoval(), /changed during review/);
  studio.page.source = original;
  await context.applyMediaRemoval();
  assert.equal(studio.page.source, removed);
  assert.equal(dirty, true);
  assert.equal(calls.some(([url]) => url.endsWith("save") || url.endsWith("delete-asset")), false, "Removing references neither saves nor deletes files");
  context.reviewAssetDeletion(files[2]);
  get("#delete-media-confirm").value = files[2].url;
  await context.deleteMediaFile();
  const deletion = calls.find(([url]) => url.endsWith("delete-asset"))[1];
  assert.equal(deletion.url, files[2].url);
  assert.equal(deletion.revision, "reviewed-revision");
  assert.equal(deletion.source, removed, "Delete rechecks the latest open draft");
  assert.equal(get("#delete-media-dialog").open, false);
}

async function checkReviewedIdChange() {
  const controls = new Map();
  const $ = selector => {
    if (!controls.has(selector)) controls.set(selector, { ...element("div"), value: "", hidden: true });
    return controls.get(selector);
  };
  const plan = { revision: "registry-revision", source: "alice", target: "alice-new",
    memberships: [{ group: "Members", role: "Guide" }],
    files: [{ path: "content/trip.md", revision: "page-revision", fields: ["author_id", "participant_ids", "contacts"] }] };
  let confirmed = false, failure = false, selected, changed;
  const requests = [];
  const context = {
    memberRenamePlan: null, memberState: { original: { id: "alice" }, dirty: false, busy: false,
      catalog: { revision: plan.revision, people: [{ id: "alice", name: "Alice" }] } },
    state: { busy: false }, $, node: element,
    memberControls() {}, clearMemberMergePlan() {}, renderMemberAudit() {}, notify() {},
    confirm: () => confirmed,
    api: async (route, options) => {
      requests.push({ route, payload: options.payload });
      if (failure) throw new Error("References changed since review");
      return route.endsWith("rename-plan") ? plan : { selected: { id: "alice-new" } };
    },
    acceptMemberCatalog: (result, merged, renamed) => { changed = { merged, renamed }; },
    openMember: id => { selected = id; context.clearMemberRenamePlan(); },
  };
  const start = memberScript.indexOf("function clearMemberRenamePlan(");
  const end = memberScript.indexOf("\nfunction clearMemberMergePlan(", start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  $("#member-rename-target").value = "alice-new";
  await assert.rejects(context.renameMemberIdentity(), /Review a fresh/);
  context.memberState.dirty = true;
  await assert.rejects(context.reviewMemberRename(), /Save or discard/);
  assert.equal(requests.length, 0);
  context.memberState.dirty = false;
  await context.reviewMemberRename();
  assert.equal(requests.length, 1, "Review alone must never commit");
  assert.equal($("#member-rename-confirm").hidden, false);
  const flattened = entry => [entry, ...entry.children.flatMap(flattened)];
  const text = flattened($("#member-rename-review")).map(entry => entry.text).join("\n");
  assert.ok(text.includes("alice → alice-new"));
  assert.ok(text.includes("Members — Guide"));
  assert.ok(text.includes("content/trip.md: author_id, participant_ids, contacts"));
  assert.ok(text.includes("Unsaved page drafts are not rewritten"));
  await context.renameMemberIdentity();
  assert.equal(requests.length, 1, "Cancelled confirmation must not write");
  confirmed = true;
  $("#member-rename-target").value = "another-id";
  await assert.rejects(context.renameMemberIdentity(), /chosen ID changed/);
  assert.equal($("#member-rename-confirm").hidden, true);
  $("#member-rename-target").value = "alice-new";
  await context.reviewMemberRename();
  failure = true;
  await assert.rejects(context.renameMemberIdentity(), /References changed/);
  assert.equal(context.memberState.busy, false);
  assert.equal($("#member-rename-confirm").hidden, true, "Failed commits require another review");
  failure = false;
  await context.reviewMemberRename();
  await context.renameMemberIdentity();
  assert.equal(selected, "alice-new");
  assert.equal(changed.renamed, true);
  assert.equal(changed.merged, false);
  assert.equal(requests.at(-1).payload.confirm, true);
  assert.equal(requests.at(-1).payload.files, plan.files);
}

async function checkIdChangeKeepsArticleDraft() {
  let handler, refreshed = false, message;
  const page = { metadata: { author_id: "alice" }, body: "Unsaved story" };
  const context = {
    studio: { catalog: {}, page }, renderMemberNames() {}, refreshPeoplePickers() {}, renderContactAssignments() {}, renderAssignments() {},
    window: { addEventListener: (name, callback) => { handler = callback; } },
    run: callback => callback(),
    refreshCatalog: async () => { refreshed = true; },
    feedback: text => { message = text; },
  };
  const start = script.indexOf('  window.addEventListener("workbench-members-changed"');
  const end = script.indexOf('  window.addEventListener("workbench-open-page"', start);
  vm.runInNewContext(script.slice(start, end), context);
  handler({ detail: { people: [{ id: "alice-new" }], members: ["Alice"], renamed: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshed, true);
  assert.equal(context.studio.page, page);
  assert.equal(page.metadata.author_id, "alice");
  assert.ok(message.includes("Person ID changed"));
  assert.ok(message.includes("Unsaved drafts are not rewritten"));
}

async function checkContactAssignments(nested) {
  const container = element("div");
  const people = [{ id: "alice", name: "Alice", email: "alice@example.test", phone: "+361234567" },
    { id: "bob", name: "Bob" }];
  const contacts = [{ person: "alice", role: "organizer" }, { person: "bob" }];
  const meta = nested ? { content_blocks: [
    { _bookshop_name: "contact/hero", title: "Keep hero" },
    { _bookshop_name: "contact/info", heading: "Contact us", address: { address: "Keep address" }, contacts },
  ] } : { contacts };
  const original = JSON.stringify(meta);
  const context = {
    $: () => container, node: element, studio: { catalog: { people } },
    currentMeta: () => meta, activePath: () => nested ? "kapcsolat.md" : "tanfolyamok/course.md",
    clone: value => JSON.parse(JSON.stringify(value)),
    change: (key, value) => { meta[key] = value; },
    run: callback => callback(),
    personPicker: (label, get, set) => Object.assign(element("picker", label), { get, set }),
    personTag: id => element("badge", id),
    field: (definition, entry, change) => Object.assign(element("field", definition[1]), { change }),
  };
  const start = script.indexOf("  function renderContactAssignments(");
  const end = script.indexOf("\n  function renderForms(", start);
  vm.runInNewContext(script.slice(start, end), context);
  context.renderContactAssignments();
  const flattened = entry => [entry, ...entry.children.flatMap(flattened)];
  const entries = () => flattened(container);
  assert.equal(JSON.stringify(meta), original, "Rendering must not edit page data");
  assert.ok(entries().some(entry => entry.text === "alice@example.test · +361234567"));
  assert.ok(entries().some(entry => entry.tag === "badge" && entry.text === "alice"));
  assert.equal(entries().filter(entry => entry.tag === "field").length, 2, "Only page-specific role is editable here");
  const list = () => nested ? meta.content_blocks[1].contacts : meta.contacts;
  entries().find(entry => entry.tag === "field").change("role", "instructor");
  assert.equal(list()[0].role, "instructor");
  entries().find(entry => entry.tag === "picker").set("bob");
  assert.equal(list()[0].person, "bob");
  assert.ok(!("email" in list()[0]) && !("phone" in list()[0]));
  entries().find(entry => entry.attributes["aria-label"] === "Move down contact 1").listeners.click();
  assert.equal(list()[1].role, "instructor");
  entries().find(entry => entry.attributes["aria-label"] === "Remove contact 2").listeners.click();
  assert.equal(list().length, 1);
  await entries().find(entry => entry.text === "+ Add contact").listeners.click();
  assert.equal(list().length, 2);
  assert.equal(list()[1].role, "");
  if (nested) {
    assert.equal(meta.content_blocks[0].title, "Keep hero");
    assert.equal(meta.content_blocks[1].address.address, "Keep address");
  }
  assert.equal(people[0].email, "alice@example.test", "Page assignments do not mutate shared profiles");
}

function checkCategoryAssignmentsAndFiltering() {
  const custom = element("div"), courses = element("div"), events = [];
  const categories = [
    { id: "custom:helpers", label: "Helpers", kind: "custom", people: ["alice"] },
    { id: "custom:organizers", label: "Organizers", kind: "custom", people: ["alice", "bob"] },
    { id: "course:content/tanfolyamok/2027.md", label: "Course 2027", kind: "course",
      path: "content/tanfolyamok/2027.md", draft: true, people: ["alice"] },
  ];
  const person = { id: "alice", name: "Alice", membership: null, categories, references: [] };
  const controls = {
    "#member-custom-categories": custom, "#member-course-categories": courses,
    "#member-category-filter": { value: categories[2].id }, "#member-filter": { value: "all" },
    "#member-search": { value: "" }, "#member-list": element("div"),
  };
  const context = { memberState: { original: null, catalog: { categories,
    people: [person, { id: "bob", name: "Bob", membership: null }], groups: [{ label: "Not current members" }],
    audit: { warnings: [] } } }, $: selector => controls[selector], node: element,
    memberControls() {}, renderCategoryFilters() {},
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: function(type, options) { this.type = type; this.detail = options.detail; },
  };
  const start = memberScript.indexOf("function categoryKindLabel(");
  const end = memberScript.indexOf("\nfunction renderPortraitChoices(", start);
  vm.runInNewContext(peopleScript, context);
  vm.runInNewContext(memberScript.slice(start, end), context);
  context.renderPersonCategories(person);
  assert.equal(custom.children.length, 2);
  assert.equal(custom.children[0].children[0].checked, true);
  assert.equal(custom.children[1].children[0].checked, true);
  assert.equal(courses.children.length, 1);
  assert.ok(courses.children[0].text.includes("Draft page"));
  courses.children[0].listeners.click();
  assert.equal(events[0].detail.path, categories[2].path);
  const listStart = memberScript.indexOf("function renderMembers(");
  const listEnd = memberScript.indexOf("\nfunction renderMemberAudit(", listStart);
  // The real dropdown rebuild is covered by browser tests; isolate list filtering here.
  context.renderCategoryFilters = () => {};
  vm.runInNewContext(memberScript.slice(listStart, listEnd), context);
  context.renderMembers();
  assert.equal(controls["#member-list"].children.filter(entry => entry.tag === "button").length, 1);
  controls["#member-category-filter"].value = "custom:organizers";
  context.renderMembers();
  assert.equal(controls["#member-list"].children.filter(entry => entry.tag === "button").length, 2);
  controls["#member-search"].value = "helpers";
  context.renderMembers();
  assert.equal(controls["#member-list"].children.filter(entry => entry.tag === "button").length, 1);
  context.renderPersonCategories({ id: "bob", categories: [] });
  assert.equal(custom.children[0].children[0].checked, false);
  assert.equal(courses.children[0].text, "No saved course participant assignments.");
}

function checkParticipantRolePicker() {
  let suggestions;
  let meta = { participant_ids: [{ person: "alice", roles: ["instructor"] }, "bob"] };
  const definitions = [{ id: "instructor", label: "Oktató", aliases: ["instructor"] },
    { id: "helper", label: "Segítő", aliases: [] }];
  const context = {
    studio: { catalog: { role_catalog: { roles: definitions } } }, node: element,
    currentMeta: () => meta, clone: value => JSON.parse(JSON.stringify(value)),
    assignParticipants: values => { meta = { participant_ids: values }; },
    document: { createElement: element, getElementById: () => null },
    attachSuggestions: (_input, options) => { suggestions = options; },
  };
  const start = script.indexOf("  function participantRolePicker(");
  const end = script.indexOf("\n  const repeaters =", start);
  vm.runInNewContext(peopleScript, context);
  vm.runInNewContext(script.slice(start, end), context);
  let picker = context.participantRolePicker(meta.participant_ids[0], 0);
  assert.equal(picker.children[1].children[0].text, "Oktató ×");
  assert.deepEqual(Array.from(suggestions.choices(), choice => choice.id), ["helper"]);
  suggestions.select({ id: "helper" });
  assert.deepEqual(Array.from(meta.participant_ids[0].roles), ["instructor", "helper"]);
  assert.equal(meta.participant_ids[1], "bob", "Role edits preserve other participants");
  picker = context.participantRolePicker(meta.participant_ids[0], 0);
  picker.children[1].children[0].listeners.click();
  assert.deepEqual(Array.from(meta.participant_ids[0].roles), ["helper"]);
  picker = context.participantRolePicker(meta.participant_ids[0], 0);
  picker.children[1].children[0].listeners.click();
  assert.equal(meta.participant_ids[0], "alice", "Removing all roles keeps the participant");
  meta.participant_ids[0] = { person: "alice", role: "instructor" };
  picker = context.participantRolePicker(meta.participant_ids[0], 0);
  assert.ok(picker.children[2].text.includes("matches Oktató"));
  assert.equal(meta.participant_ids[0].role, "instructor", "Rendering never rewrites historical text");
  suggestions.select({ id: "helper" });
  assert.deepEqual(Array.from(meta.participant_ids[0].roles), ["instructor", "helper"]);
  assert.equal("role" in meta.participant_ids[0], false, "An explicit role edit saves canonical IDs");
  meta.participant_ids[0] = { person: "alice", role: "Unrecognized history" };
  picker = context.participantRolePicker(meta.participant_ids[0], 0);
  assert.equal(picker.children[2].className, "notice error");
  assert.equal(meta.participant_ids[0].role, "Unrecognized history");
  definitions.push({ id: "custom", label: "New choice", aliases: [] });
  assert.ok(suggestions.choices().some(choice => choice.id === "custom"), "Choices follow the live catalogue");
}

function checkMembershipRolePicker() {
  const controls = new Map();
  const get = selector => {
    if (!controls.has(selector)) controls.set(selector, { ...element("div"), value: "", hidden: false });
    return controls.get(selector);
  };
  let suggestions, overviewUpdates = 0, draftUpdates = 0;
  const definitions = [
    { id: "elnok", label: "elnök", aliases: [] },
    { id: "kutatasvezeto", label: "kutatásvezető", aliases: [] },
    { id: "turavezeto", label: "túravezető", aliases: [] },
  ];
  const context = {
    memberState: { roles: ["elnok", "kutatasvezeto"], dirty: false, catalog: { role_catalog: { roles: definitions } } },
    $: get, node: element,
    document: { createElement: element, getElementById: () => null },
    attachSuggestions: (_input, choices) => { suggestions = choices; },
    renderPersonOverview: () => { overviewUpdates++; },
    memberDraft: () => { draftUpdates++; },
  };
  get("#member-group").value = "0";
  vm.runInNewContext(peopleScript, context);
  const start = memberScript.indexOf("function membershipRoleLabel(");
  const end = memberScript.indexOf("\nasync function openPersonEditor(", start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  context.renderMembershipRoles();
  assert.equal(context.membershipRoleLabel(), "elnök, kutatásvezető");
  assert.deepEqual(Array.from(context.memberRoleValues().roles), ["elnok", "kutatasvezeto"]);
  assert.deepEqual(Array.from(suggestions.choices(), item => item.id), ["turavezeto"]);
  suggestions.select({ id: "turavezeto" });
  assert.deepEqual(Array.from(context.memberState.roles), ["elnok", "kutatasvezeto", "turavezeto"]);
  assert.equal(context.memberState.dirty, true);
  assert.equal(overviewUpdates, 1);
  assert.equal(draftUpdates, 1);
  get("#member-membership-roles").children[0].children[1].children[0].listeners.click();
  assert.deepEqual(Array.from(context.memberRoleValues().roles), ["kutatasvezeto", "turavezeto"]);
  get("#member-role").value = "kutatásvezető, elnök";
  context.renderMembershipRoles();
  assert.deepEqual(Array.from(context.memberRoleValues().roles), ["kutatasvezeto", "elnok"],
    "Known comma-separated duties become a list in the original order");
  assert.equal(get("#member-role").value, "kutatásvezető, elnök", "Opening a draft does not rewrite saved data");
  get("#member-role").value = "kutatásvezető, unknown";
  context.renderMembershipRoles();
  assert.equal(get("#member-membership-roles").children[0].children[2].className, "notice error");
  assert.equal(context.memberRoleValues().role, "kutatásvezető, unknown", "No unknown legacy duty is silently lost");
  get("#member-group").value = "";
  context.renderMembershipRoles();
  assert.equal(get("#member-membership-roles").hidden, true, "No membership means no membership-role picker");
}

async function checkGlobalRoleManager() {
  const controls = {};
  const get = selector => {
    if (!controls[selector]) {
      const control = { ...element("div"), value: "", checked: false };
      Object.defineProperty(control, "options", { get: () => control.children });
      controls[selector] = control;
    }
    return controls[selector];
  };
  const roleState = { selected: "helper", dirty: false };
  const catalog = { roles: [{ id: "helper", label: "Segítő", aliases: ["helper"] }],
    revision: "reviewed-revision", references: [{ id: "helper", person: "alice", title: "Course", path: "content/course.md" }],
    warnings: [] };
  const requests = [], events = [];
  const context = {
    roleState, memberState: { catalog: { role_catalog: catalog } }, state: {}, $: get, node: element,
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
    confirm: () => true, memberControls() {}, renderMembers() {}, notify() {},
    api: async (route, options) => { requests.push({ route, ...options }); return { role_catalog: catalog }; },
    acceptMemberCatalog: result => { context.memberState.catalog = result; },
  };
  const start = memberScript.indexOf("function renderRoleManager(");
  const end = memberScript.indexOf("\nfunction renderPortraitChoices(", start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  context.renderRoleManager();
  assert.equal(get("#participant-role-label").value, "Segítő");
  assert.equal(get("#participant-role-id").readOnly, true);
  assert.equal(get("#participant-role-delete").disabled, true);
  assert.ok(get("#participant-role-status").textContent.includes("Used by 1"));
  get("#participant-role-usage").children[0].listeners.click();
  assert.equal(events[0].detail.path, "content/course.md");
  catalog.references = [{ id: "helper", person: "alice", title: "Members", path: "data/people.yaml", kind: "membership" }];
  context.selectRole();
  get("#participant-role-usage").children[0].listeners.click();
  assert.equal(events.at(-1).type, "workbench-open-person");
  assert.equal(events.at(-1).detail.id, "alice");
  catalog.references = [];
  catalog.warnings = ["Cannot read a saved page"];
  context.selectRole();
  assert.equal(get("#participant-role-delete").disabled, true);
  assert.ok(get("#participant-role-status").textContent.includes("Cannot read"));
  catalog.warnings = [];
  context.selectRole();
  assert.equal(get("#participant-role-delete").disabled, false);
  roleState.dirty = true;
  get("#participant-role-label").value = "New helper name";
  catalog.revision = "changed-elsewhere";
  await context.saveRole();
  assert.equal(requests[0].payload.revision, "reviewed-revision", "A draft keeps its reviewed revision");
  assert.equal(requests[0].payload.id, "helper");
  assert.equal(requests[0].payload.original, "helper");
  roleState.selected = "";
  get("#participant-role-select").value = "";
  context.selectRole();
  get("#participant-role-label").value = "Új szerep";
  get("#participant-role-id").value = "";
  await context.saveRole();
  assert.equal(requests[1].payload.id, "uj-szerep", "New IDs are generated without requiring technical input");
}

function checkIdentityConflictReasons() {
  const inputs = {
    "#member-name": { value: "Stieber Bence" },
    "#member-nickname": { value: "" },
    "#member-aliases": { value: "" },
    "#member-id": { value: "stieber-bence" },
    "#member-duplicate-warning": {},
  };
  const person = { id: "nemeth-bence", name: "Németh Bence", nickname: "Benci", aliases: ["Stieber Bence"] };
  const state = { original: null, catalog: { people: [person] }, dirty: true };
  const context = { memberState: state, $: selector => inputs[selector] };
  const start = memberScript.indexOf("function memberIdentityWarning(");
  const end = memberScript.indexOf("\nfunction renderPortraitChoices(", start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  const warning = inputs["#member-duplicate-warning"];
  context.memberIdentityWarning();
  assert.equal(warning.hidden, false);
  assert.ok(warning.textContent.includes('Németh Bence [nemeth-bence]'));
  assert.ok(warning.textContent.includes('Your name "Stieber Bence" matches their alias "Stieber Bence"'));
  assert.ok(warning.textContent.includes("copy your unsaved draft details"));
  assert.ok(warning.textContent.includes("cannot be approved"));
  person.aliases = [];
  context.memberIdentityWarning();
  assert.equal(warning.hidden, true, "A shared first name with a different family name is not a conflict");
  assert.equal(warning.textContent, "");
  inputs["#member-name"].value = "  NE\u0301METH BENCE ";
  context.memberIdentityWarning();
  assert.ok(warning.textContent.includes('matches their name "Németh Bence"'));
  inputs["#member-name"].value = "Stieber Bence";
  inputs["#member-nickname"].value = "Benci";
  context.memberIdentityWarning();
  assert.ok(warning.textContent.includes('Your nickname "Benci" matches their nickname "Benci"'));
  inputs["#member-nickname"].value = "";
  inputs["#member-aliases"].value = "\nNémeth Bence\n";
  context.memberIdentityWarning();
  assert.ok(warning.textContent.includes('Your alias "Németh Bence" matches their name "Németh Bence"'));
  inputs["#member-aliases"].value = "";
  inputs["#member-id"].value = "nemeth-bence";
  context.memberIdentityWarning();
  assert.ok(warning.textContent.includes('Your ID "nemeth-bence" matches their existing ID'));
  state.original = { id: "nemeth-bence" };
  context.memberIdentityWarning();
  assert.equal(warning.hidden, true, "Editing a person's own fields must not warn about that same record");
  assert.equal(state.dirty, true);
  assert.equal(inputs["#member-name"].value, "Stieber Bence", "Warnings must not change the draft");
}

function checkPersonDialogLifecycle() {
  const controls = {};
  const get = selector => controls[selector] ||= element("control");
  const dialog = get("#person-editor-dialog");
  dialog.open = true;
  dialog.close = () => { dialog.open = false; };
  dialog.showModal = () => { dialog.open = true; };
  const draft = { editing: true, original: { id: "alice" }, dirty: true, busy: false, loading: false };
  const globalState = { busy: false };
  let allowDiscard = false, prevented = false;
  const events = {};
  const context = {
    $: get, memberState: draft, state: globalState,
    confirm: () => allowDiscard,
    clearMemberMergePlan() {}, clearMemberRenamePlan() {}, memberDraft() {}, renderMembers() {},
    clearCrop() {}, queueView() {},
    location: { hash: "#portraits" },
    window: { addEventListener: (name, handler) => { events[name] = handler; } },
  };
  const start = memberScript.indexOf("function discardMember(");
  const end = memberScript.indexOf("\nfunction openMember(", start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  const wiringStart = memberScript.indexOf('$("#person-editor-dialog").append(');
  const wiringEnd = memberScript.indexOf('$("#member-remove-membership").addEventListener(', wiringStart);
  vm.runInNewContext(memberScript.slice(wiringStart, wiringEnd), context);
  assert.equal(dialog.children[0], get("#portrait-workspace"));
  dialog.listeners.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(dialog.open, true, "Rejecting discard must retain the modal and draft");
  get("#person-dialog-close").listeners.click();
  assert.equal(draft.dirty, true);
  context.location.hash = "#content";
  events.hashchange();
  assert.equal(dialog.open, false);
  assert.equal(draft.dirty, true, "Page navigation hides the modal without losing the draft");
  get("#member-resume").listeners.click();
  assert.equal(dialog.open, true);
  assert.equal(get("#member-name").focused, true);
  allowDiscard = true;
  globalState.busy = true;
  dialog.listeners.cancel({ preventDefault() {} });
  assert.equal(dialog.open, true, "Escape must not interrupt active operations");
  globalState.busy = false;
  get("#person-dialog-close").listeners.click();
  assert.equal(dialog.open, false);
  assert.equal(draft.editing, false);
  assert.equal(draft.original, null);
  assert.equal(draft.dirty, false);
  assert.equal(get("#member-form").hidden, true);
  assert.equal(get("#member-search").focused, true, "Return keyboard focus to the registry");
  get("#portrait-standalone").listeners.click();
  assert.equal(dialog.open, true);
  assert.equal(get("#member-form").hidden, true);
  assert.equal(get("#person-dialog-heading").textContent, "Standalone portrait export");
  assert.equal(get("#portrait-files").focused, true);
}

async function checkDeletionReasonsAndReplacementPrompt() {
  const controls = {};
  const person = { id: "alice", membership: { label: "First" },
    references: [{ title: "Historical trip" }] };
  const notices = [], reviews = [];
  let confirmed = false;
  const context = {
    memberState: { original: { id: "alice" }, catalog: {
      people: [person], portraits: ["/images/members/old.webp"], audit: { warnings: [] },
    } }, state: { token: "fixture" },
    $: selector => controls[selector] ||= {},
    confirm: () => confirmed,
    notify: (...args) => notices.push(args),
    reviewPortraitDeletion: async urls => reviews.push(urls),
  };
  let start = memberScript.indexOf("function memberDeletionReasons(");
  let end = memberScript.indexOf("\nfunction discardMember(", start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  context.renderMemberDeletion();
  assert.equal(controls["#member-delete"].disabled, true);
  assert.ok(controls["#member-delete-reason"].textContent.includes("First"));
  assert.ok(controls["#member-delete-reason"].textContent.includes("Historical trip"));
  person.membership = null;
  person.references = [];
  context.memberState.catalog.audit.warnings = ["Broken course"];
  context.renderMemberDeletion();
  assert.equal(controls["#member-delete"].disabled, true);
  assert.ok(controls["#member-delete-reason"].textContent.includes("Broken course"));
  context.memberState.catalog.audit.warnings = [];
  context.renderMemberDeletion();
  assert.equal(controls["#member-delete"].disabled, false);
  assert.ok(controls["#member-delete-reason"].textContent.includes("Deletion is available"));
  context.state.token = "";
  context.renderMemberDeletion();
  assert.equal(controls["#member-delete"].disabled, true);
  assert.ok(controls["#member-delete-reason"].textContent.includes("connection"));
  context.state.token = "fixture";
  start = memberScript.indexOf("async function reviewReplacedPortraits(");
  end = memberScript.indexOf("\nfunction clearMemberRenamePlan(", start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  await context.reviewReplacedPortraits([]);
  assert.equal(notices.length, 0);
  await context.reviewReplacedPortraits(["/images/members/old.webp"]);
  assert.equal(reviews.length, 0, "Declining cleanup must keep all old files");
  assert.ok(notices[0][0].includes("were kept"));
  confirmed = true;
  await context.reviewReplacedPortraits(["/images/members/old.webp"]);
  assert.equal(reviews[0][0], "/images/members/old.webp");
  await context.reviewReplacedPortraits(["/images/outside.webp"]);
  assert.ok(notices.at(-1)[0].includes("manual review"));
  assert.equal(notices.at(-1)[1], true);
  context.reviewPortraitDeletion = async () => { throw new Error("Stale review"); };
  await assert.rejects(context.reviewReplacedPortraits(["/images/members/old.webp"]),
    /Person was saved.*No old files were deleted.*Stale review/);
}

async function checkReplacementSaveOrdering() {
  const calls = [];
  const inputs = {
    "#member-id": { value: "alice" }, "#member-name": { value: "Alice" },
    "#member-image": { value: "/images/members/new_thumb.webp" },
    "#member-modal_image": { value: "/images/members/new_full.webp" },
    "#member-aliases": { value: "" }, "#member-needs-review": { checked: false },
    "#member-show-profile-contacts": { checked: true },
    "#member-group": { value: "" },
    "#member-custom-categories": { querySelectorAll: () => [] },
  };
  const result = { revision: "saved", selected: { id: "alice" },
    replaced_portraits: ["/images/members/old_thumb.webp"] };
  let saveFails = false;
  const context = {
    memberFields: ["id", "name", "image", "modal_image"],
    memberState: { busy: false, dirty: true, original: { id: "alice" }, catalog: { revision: "before" },
      socialLinks: [" https://instagram.com/alice/ ", "https://example.test/alice"] },
    state: { busy: false }, $: selector => inputs[selector],
    memberControls() {}, renderMemberAudit() {},
    document: { querySelector: () => ({ dataset: { memberTab: "portraits" } }) },
    switchMemberSection: section => assert.equal(section, "portraits"),
    memberRoleValues: () => ({ roles: [] }),
    memberDocumentDraft: () => ({ path: "tagok/alice/index.md", revision: "doc-before", body: "Document draft", label: "", subtitle: "" }),
    api: async (url, options) => {
      assert.deepEqual(Array.from(options.payload.member.social_links),
        ["https://instagram.com/alice/", "https://example.test/alice"]);
      assert.equal(options.payload.member.show_profile_contacts, true);
      assert.equal(options.payload.document.body, "Document draft");
      assert.equal(options.payload.document.revision, "doc-before");
      assert.equal(options.payload.member.cv, undefined);
      calls.push("save");
      if (saveFails) throw new Error("Save failed");
      return result;
    },
    acceptMemberCatalog: () => calls.push("catalog"),
    openMember: () => calls.push("open"),
    notify: () => calls.push("notice"),
    reviewReplacedPortraits: async urls => {
      assert.equal(context.memberState.busy, false);
      assert.equal(context.memberState.dirty, false);
      assert.equal(urls, result.replaced_portraits);
      calls.push("cleanup");
    },
  };
  const start = memberScript.indexOf("async function saveMember(");
  const end = memberScript.indexOf("\nasync function reviewReplacedPortraits(", start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  await context.saveMember();
  assert.deepEqual(calls, ["save", "catalog", "open", "notice", "cleanup"]);
  calls.length = 0;
  saveFails = true;
  context.memberState.dirty = true;
  await assert.rejects(context.saveMember(), /Save failed/);
  assert.deepEqual(calls, ["save"], "Failed saves must never offer old-file deletion");
  assert.equal(context.memberState.dirty, true);
  assert.equal(context.memberState.busy, false);
}

function checkPeopleTypeahead() {
  const picks = [];
  let suggestions;
  const people = [
    { id: "alice", name: "Alice", aliases: ["Ally"], membership: { label: "Members" } },
    { id: "guest", name: "Guest", aliases: [] },
    { id: "review", name: "Unconfirmed", aliases: [], needs_review: true },
  ];
  const context = {
    studio: { catalog: { people } }, node: element,
    document: { createElement: tag => Object.assign(element(tag), { value: "" }) },
    personLabel: id => `${id} · saved identity`,
    attachSuggestions: (input, options) => {
      suggestions = { input, ...options, refresh() {} };
      return suggestions;
    },
  };
  const start = script.indexOf("  function personPicker(");
  const end = script.indexOf("\n  function refreshPeoplePickers(", start);
  vm.runInNewContext(script.slice(start, end), context);
  const picker = context.personPicker("Add participant", () => "", id => picks.push(id), () => ["guest"]);
  const filter = picker.children[1].children[0];
  filter.value = "all";
  suggestions.input.value = "";
  assert.deepEqual(Array.from(suggestions.choices(), item => item.value), ["alice", "review"]);
  suggestions.input.value = "ally";
  assert.deepEqual(Array.from(suggestions.choices(), item => item.value), ["alice"]);
  assert.equal(picks.length, 0);
  const nextSearch = element("input");
  picker.isConnected = false;
  context.document.querySelectorAll = () => [{
    dataset: { pickerTitle: "Add participant" }, querySelector: () => nextSearch,
  }];
  suggestions.select(suggestions.choices()[0]);
  assert.deepEqual(picks, ["alice"]);
  assert.equal(nextSearch.focused, true, "Keep keyboard focus in the next participant search after rerender");
  filter.value = "nonmembers";
  suggestions.input.value = "";
  assert.deepEqual(Array.from(suggestions.choices(), item => item.value), ["review"]);
  filter.value = "review";
  assert.deepEqual(Array.from(suggestions.choices(), item => item.value), ["review"]);
}

function checkChoiceSearchDoesNotChangeDraft() {
  let handler, overviewUpdates = 0;
  const draft = { dirty: false };
  const context = {
    $: () => ({ addEventListener: (_name, callback) => { handler = callback; } }),
    memberState: draft,
    clearMemberMergePlan() {}, memberDraft() {}, memberIdentityWarning() {}, memberControls() {}, renderMembershipRoles() {},
    renderPersonOverview: () => { overviewUpdates++; },
  };
  const start = memberScript.indexOf('$("#member-form").addEventListener("input"');
  const end = memberScript.indexOf('\n$("#member-id").addEventListener(', start);
  vm.runInNewContext(memberScript.slice(start, end), context);
  handler({ target: { dataset: { selectSearch: "true" }, closest: () => null } });
  assert.equal(draft.dirty, false, "Searching a predefined choice is not a person edit");
  handler({ target: { id: "member-group", dataset: {}, closest: () => null } });
  assert.equal(draft.dirty, true, "Selecting a membership group updates the person draft");
  assert.equal(overviewUpdates, 1);
}

async function checkGitDraftRecovery() {
  const handlers = {}, inputs = new Map(), downloads = [], removed = [];
  const get = selector => {
    if (!inputs.has(selector)) inputs.set(selector, {
      value: "", hidden: false, open: false, checked: false,
      querySelectorAll: () => [{ value: "course-group" }], close() { this.open = false; }, focus() {},
      removeAttribute(name) { delete this[name]; },
    });
    return inputs.get(selector);
  };
  const studio = { dirty: true, busy: false, tab: "source", page: {}, original: "turak/draft.md",
    changes: { title: "Unsaved" }, selected: new Map([["photo", true]]), savedSource: "Saved file stays unchanged" };
  get("#post-source").value = "Unsaved page source";
  const context = {
    window: { addEventListener: (name, callback) => { handlers[name] = callback; } },
    studio, $: get, localStorage: { removeItem: key => removed.push(key) },
    activePath: () => "turak/draft.md", renderLibrary() {},
    downloadWorkbenchDraft: (name, source) => downloads.push({ name, source }),
    api: () => { throw new Error("Draft recovery must not write saved files."); },
  };
  const contentStart = script.indexOf('  window.addEventListener("workbench-before-git"');
  const contentEnd = script.indexOf('  window.addEventListener("keydown"', contentStart);
  assert.ok(contentStart >= 0 && contentEnd > contentStart);
  vm.runInNewContext(script.slice(contentStart, contentEnd), context);
  const status = { blockers: [], busy: [] };
  handlers["workbench-before-git"]({ detail: status });
  assert.equal(status.blockers.length, 1);
  studio.busy = true;
  handlers["workbench-before-git"]({ detail: status });
  assert.ok(status.busy[0].includes("page operation"));
  studio.busy = false;
  let detail = { operations: [] };
  handlers["workbench-export-drafts"]({ detail });
  await Promise.all(detail.operations);
  assert.deepEqual(downloads[0], { name: "draft.md", source: "Unsaved page source" });
  assert.equal(studio.dirty, true, "Downloading a page draft does not discard it");
  assert.equal(removed.length, 0);
  handlers["workbench-discard-drafts"]();
  assert.deepEqual(removed, ["ftsk-content-draft"]);
  assert.equal(studio.dirty, false);
  assert.equal(studio.page, null);
  assert.equal(studio.selected.size, 0);
  assert.equal(studio.savedSource, "Saved file stays unchanged");
  assert.equal(get("#content-editor").hidden, true);

  context.memberState = { dirty: true, busy: false, loading: false, editing: true, original: { id: "alice" } };
  context.roleState = { dirty: false };
  context.memberRoleValues = () => ({ roles: [] });
  context.state = { busy: false };
  context.memberFields = ["id", "name", "image", "modal_image"];
  context.memberDocumentDraft = () => ({ path: "tagok/alice/index.md", revision: "doc-before", body: "Document draft" });
  context.clearMemberMergePlan = context.clearMemberRenamePlan = context.memberDraft = context.renderMembers = () => {};
  context.clearCrop = () => {};
  get("#member-id").value = "alice";
  get("#member-name").value = "Alice draft";
  get("#member-aliases").value = "Former name";
  get("#member-group").value = "not-current";
  const closeStart = memberScript.indexOf("function closeMember()");
  const closeEnd = memberScript.indexOf("function openMember(", closeStart);
  const memberStart = memberScript.indexOf('window.addEventListener("workbench-before-git"');
  const memberEnd = memberScript.indexOf("\nmemberControls();", memberStart);
  const automaticStart = memberScript.indexOf("function automaticRoleDraft(");
  const automaticEnd = memberScript.indexOf("\nasync function saveRole(", automaticStart);
  assert.ok(closeStart >= 0 && closeEnd > closeStart && memberStart >= 0 && memberEnd > memberStart);
  vm.runInNewContext(memberScript.slice(automaticStart, automaticEnd) +
    memberScript.slice(closeStart, closeEnd) + memberScript.slice(memberStart, memberEnd), context);
  detail = { operations: [] };
  handlers["workbench-export-drafts"]({ detail });
  await Promise.all(detail.operations);
  const personDraft = JSON.parse(downloads[1].source);
  assert.equal(personDraft.member.name, "Alice draft");
  assert.equal(personDraft.document.body, "Document draft");
  assert.deepEqual(personDraft.categories, ["course-group"]);
  assert.equal(context.memberState.dirty, true);
  context.downloadWorkbenchDraft = () => { throw new Error("fixture export failure"); };
  detail = { operations: [] };
  handlers["workbench-export-drafts"]({ detail });
  await assert.rejects(Promise.all(detail.operations), /fixture export failure/);
  assert.equal(context.memberState.dirty, true, "Failed export retains the draft");
  handlers["workbench-discard-drafts"]();
  assert.equal(context.memberState.dirty, false);
  assert.equal(context.memberState.editing, false);
  assert.equal(context.memberState.original, null);
  context.roleState.dirty = true;
  context.roleState.selected = "helper";
  get("#participant-role-label").value = "Unsaved role label";
  get("#participant-role-id").value = "helper";
  get("#participant-role-aliases").value = "Old label";
  get("#participant-role-exempt").checked = true;
  get("#participant-role-automatic").checked = true;
  get("#participant-role-current_member").value = "false";
  get("#participant-role-course_participant").value = "true";
  context.downloadWorkbenchDraft = (name, source) => downloads.push({ name, source });
  detail = { blockers: [], busy: [] };
  handlers["workbench-before-git"]({ detail });
  assert.ok(detail.blockers.some(message => message.includes("role draft")));
  detail = { operations: [] };
  handlers["workbench-export-drafts"]({ detail });
  await Promise.all(detail.operations);
  const roleDraft = JSON.parse(downloads.at(-1).source);
  assert.equal(roleDraft.label, "Unsaved role label");
  assert.equal(roleDraft.exempt_from_guest, true);
  assert.deepEqual(roleDraft.automatic_when, { current_member: false, course_participant: true });
  get("#participant-role-current_member").value = "";
  assert.deepEqual(JSON.parse(JSON.stringify(context.automaticRoleDraft())), { course_participant: true });
  get("#participant-role-automatic").checked = false;
  assert.equal(context.automaticRoleDraft(), null);
  context.selectRole = () => { context.roleState.dirty = false; };
  handlers["workbench-discard-drafts"]();
  assert.equal(context.roleState.dirty, false);
}

function checkHeroDraftState() {
  const hero = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "workbench", "hero", "hero_focus_picker.html"), "utf8");
  const start = hero.indexOf("      draft: function ()");
  const end = hero.indexOf("      refreshViewport:", start);
  assert.ok(start > 0 && end > start);
  const original = { path: "/images/fixture.webp", alt: "Saved", viewport: 0 };
  const context = {
    state: { ...original }, savedEntry: JSON.stringify({ path: original.path, alt: original.alt }),
    stateToEntry: state => ({ path: state.path, alt: state.alt }),
    config: { images: [{ path: original.path, alt: original.alt }, { path: "/images/other.webp", alt: "Other" }] },
  };
  vm.runInNewContext(`var activeEditor = {${hero.slice(start, end)}};`, context);
  assert.equal(context.activeEditor.draft(), null, "Opening the hero editor is not an unsaved change");
  context.state.viewport = 1;
  assert.equal(context.activeEditor.draft(), null, "Preview-only changes do not block Git");
  context.state.alt = "Unsaved";
  const draft = context.activeEditor.draft();
  assert.equal(draft.images[0].alt, "Unsaved");
  assert.equal(draft.images[1].alt, "Other");
  assert.equal(context.config.images[0].alt, "Saved", "Draft export does not mutate saved config");
  context.savedEntry = JSON.stringify(context.stateToEntry(context.state));
  assert.equal(context.activeEditor.draft(), null, "Successful saves clear the hero draft blocker");
}

async function run() {
  await checkUploadPreviews();
  await checkMemberCVBatch();
  await checkFileNavigation();
  await checkMemberCVSharing();
  await checkEditorBinding();
  await checkMediaDropZones();
  await gitChecks;
  await checkReferenceNavigation("content/turak/2026-gortani-expedicio.md", "turak/2026-gortani-expedicio.md");
  await checkReferenceNavigation("content/tanfolyamok/2026/index.md", "tanfolyamok/2026/index.md");
  await checkReferenceNavigation("turak/2026-trip.md", "turak/2026-trip.md");
  await checkReferenceNavigation("turak/content/example.md", "turak/content/example.md");
  await checkReferenceNavigation("content/turak/2026-trip.md", "turak/2026-trip.md", false);
  await checkImageField();
  await checkMediaPicker();
  checkPageAssetFolders();
  checkEditorWorkspaceNavigation();
  await conversionChecks();
  await checkPageMediaActions();
  checkPersonAvatars();
  checkParticipationLabels();
  checkPersonOverview();
  checkIdentityConflictReasons();
  checkCategoryAssignmentsAndFiltering();
  checkPeopleTypeahead();
  checkChoiceSearchDoesNotChangeDraft();
  checkParticipantRolePicker();
  checkMembershipRolePicker();
  await checkGlobalRoleManager();
  await checkGitDraftRecovery();
  checkHeroDraftState();
  checkPersonDialogLifecycle();
  await checkDeletionReasonsAndReplacementPrompt();
  await checkReplacementSaveOrdering();
  await checkPersonEditorNavigation(true);
  await checkPersonEditorNavigation(false);
  await checkPersonEditorNavigation(true, true);
  await checkReviewedIdChange();
  await checkIdChangeKeepsArticleDraft();
  await checkContactAssignments(false);
  await checkContactAssignments(true);
  console.log("PASS: People navigation, portraits, participation overview, reviewed ID changes and draft protection work.");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
