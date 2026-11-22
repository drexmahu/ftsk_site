const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../tools/workbench/web/content.js"), "utf8");
const start = source.indexOf("  async function applyPDFImport()");
const end = source.indexOf("\n  async function editPageImages(", start);
assert(start >= 0 && end > start, "PDF apply helper must remain accessible at module scope");

function fixture({ mode = "append", body = "Original story.", cover = "", selected = ["photo-1"], confirm = true } = {}) {
  const fields = {
    "#post-body": { value: body },
    "#pdf-import-images": { querySelectorAll: () => selected.map(value => ({ value })) },
    "#pdf-import-cover": { value: cover },
    "#pdf-import-mode": { value: mode },
    "#pdf-import-keep-pdf": { checked: true },
    "#pdf-import-width": { value: "1600", reportValidity: () => true },
    "#pdf-import-height": { value: "1600", reportValidity: () => true },
    "#pdf-import-quality": { value: "82", reportValidity: () => true },
    "#pdf-import-apply": { disabled: false },
    "#pdf-import-text": { value: "" },
  };
  const state = {
    pdfImport: { id: "review", path: "turak/report.md", pdf_url: "/pdfs/report.pdf",
      reviewedDone: [...selected], reviewed: Object.fromEntries(selected.map(id => [id, [{url: `/images/turak/report/${id}.webp`}]])) },
    pdfApplied: false,
    busy: false,
  };
  const calls = [];
  const changes = [];
  let dirty = false;
  const apply = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
    studio: state,
    $: selector => {
      assert(fields[selector], `Unknown field ${selector}`);
      return fields[selector];
    },
    activePath: () => "turak/report.md",
    selectedPDFImages: () => selected,
    rootAPI: "/api/workbench/content/",
    confirm: () => confirm,
    sync: async () => {},
    setBusy: value => { state.busy = value; },
    pdfStatus: () => {},
    feedback: () => {},
    markDirty: () => { dirty = true; },
    change: (key, value) => changes.push([key, value]),
    api: async (url, options) => {
      calls.push({ url, ...JSON.parse(JSON.stringify(options)) });
      return {
        markdown: "Recovered story." + (options.payload.keep_pdf ? '\n{{< pdf src="/pdfs/report.pdf" >}}' : ""),
        images: Object.entries(options.payload.image_files).flatMap(([id, urls]) => urls.map(url => ({id, url}))),
        folder: "turak/report",
      };
    },
  });
  return { apply, fields, state, calls, changes, dirty: () => dirty };
}

async function main() {
  const existing = fixture({ body: 'Original story.\n\n{{< pdf src="/pdfs/report.pdf" >}}' });
  await existing.apply();
  assert.equal(existing.calls[0].payload.keep_pdf, false, "Append must preserve, not duplicate, an existing PDF link");
  assert(existing.fields["#post-body"].value.startsWith("Original story."));
  assert.equal((existing.fields["#post-body"].value.match(/\{\{< pdf /g) || []).length, 1);
  assert(existing.fields["#post-body"].value.includes("Recovered story."));
  assert.equal(existing.state.busy, false);
  assert.equal(existing.state.pdfApplied, true);
  assert.equal(existing.fields["#pdf-import-apply"].disabled, true);
  assert.equal(existing.dirty(), true);
  await assert.rejects(existing.apply(), /Extract a PDF first/);
  assert.equal(existing.calls.length, 1);

  const fresh = fixture();
  await fresh.apply();
  assert.equal(fresh.calls[0].payload.keep_pdf, true);
  assert(fresh.fields["#post-body"].value.includes("/pdfs/report.pdf"));
  assert.equal(fresh.calls[0].payload.width, 1600);

  const photos = fixture({ mode: "images", cover: "/images/turak/report/photo-1.webp" });
  await photos.apply();
  assert.equal(photos.fields["#post-body"].value, "Original story.");
  assert.deepEqual(photos.changes.map(([key]) => key), ["thumbImg.image_path", "featuredImg.image_path"]);
  assert.deepEqual(photos.calls[0].payload.image_files, {"photo-1": ["/images/turak/report/photo-1.webp"]});

  const unreviewed = fixture();
  unreviewed.state.pdfImport.reviewedDone = [];
  await assert.rejects(unreviewed.apply(), /Prepare all selected photos/);
  assert.equal(unreviewed.calls.length, 0);

  const variants = fixture({cover: "/images/turak/report/cropped.webp"});
  variants.state.pdfImport.reviewed["photo-1"].push({url: "/images/turak/report/cropped.webp"});
  await variants.apply();
  assert.deepEqual(variants.calls[0].payload.image_files["photo-1"], [
    "/images/turak/report/photo-1.webp", "/images/turak/report/cropped.webp",
  ]);
  assert.equal(variants.changes[0][1], "/images/turak/report/cropped.webp", "Heading selection uses the exact reviewed version, not the first source output");

  await checkPhotoPreparation();

  const replace = fixture({ mode: "replace" });
  await replace.apply();
  assert(!replace.fields["#post-body"].value.includes("Original story."));
  const cancelled = fixture({ mode: "replace", confirm: false });
  await cancelled.apply();
  assert.equal(cancelled.calls.length, 0);
  assert.equal(cancelled.dirty(), false);

  const invalidCover = fixture({ cover: "missing" });
  await assert.rejects(invalidCover.apply(), /Select the chosen heading photo/);
  assert.equal(invalidCover.calls.length, 0);
  const empty = fixture({ mode: "images", selected: [] });
  await assert.rejects(empty.apply(), /Select at least one photo/);
  const stale = fixture();
  stale.state.pdfImport.path = "turak/another.md";
  await assert.rejects(stale.apply(), /page path changed/);
  assert.equal(stale.calls.length, 0);

  console.log("PASS: PDF imports preserve stories and links, require reviewed covers, guard stale/repeated exports and honor append/replace/images-only modes.");
}

async function checkPhotoPreparation() {
  const begin = source.indexOf("  async function preparePDFPhotos()");
  const finish = source.indexOf("\n  async function applyPDFImport()", begin);
  const ids = Array.from({length: 101}, (_, index) => `photo-${index + 1}`);
  const extraction = {id: "session", path: "turak/report.md", folder: "turak/report", reviewed: {}, reviewedDone: [],
    images: ids.map((id, index) => ({id, number: index + 1, preview: `/preview/${id}.png`}))};
  const studio = {pdfImport: extraction, pdfApplied: false, busy: false};
  const batches = [], downloads = [], notices = [];
  let cancel = true;
  const prepare = vm.runInNewContext(`(${source.slice(begin, finish).trim()})`, {
    studio, state: {git: {branch: "fixture"}}, activePath: () => extraction.path, selectedPDFImages: () => ids,
    $: () => ({reportValidity: () => true, value: "1600"}), sync: async () => {},
    setBusy: value => {studio.busy = value;}, pdfStatus: (text, error) => notices.push({text, error}), renderPDFOutputs() {},
    File: class {constructor(_, name) {this.name = name;}},
    fetch: async url => {downloads.push(url); return {ok: true, blob: async () => ({})};},
    window: {workbenchImages: {open: async options => {
      options.validate(); batches.push(options.files.length);
      if (batches.length === 2 && cancel) return {results: [], completedNames: [], sourceErrors: []};
      return {
        results: options.files.map(file => ({sourceName: file.name, files: [{url: `/images/turak/report/${file.name}.webp`}]})),
        completedNames: options.files.map(file => file.name), sourceErrors: [],
      };
    }}},
  });
  await prepare();
  assert.deepEqual(batches, [100, 1], "PDF selections exceeding 100 must use bounded shared-editor batches");
  assert.equal(extraction.reviewedDone.length, 100, "Cancelling a later batch keeps earlier reviewed results");
  assert(notices.at(-1).text.includes("No story was inserted"));
  cancel = false;
  await prepare();
  assert.deepEqual(batches, [100, 1, 1], "Retry must prepare only unfinished sources, never duplicate saved batches");
  assert.equal(downloads.length, 102);
  assert.equal(extraction.reviewedDone.length, 101);
  assert.equal(studio.busy, false);

  extraction.reviewedDone.splice(extraction.reviewedDone.indexOf(ids[0]), 1);
  const count = downloads.length;
  await assert.rejects(prepare(), /Some versions are already saved/);
  assert.equal(downloads.length, count, "Partial source results need an explicit saved-output decision before retry");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
