import { Buffer } from 'buffer';
// `apng.ts` (animated-texture encoder) uses a global `Buffer`; the browser has
// none, so provide the polyfill before the renderer touches it.
(globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;

import { zipSync } from 'fflate';
import {
  Minecraft,
  Jar,
  render,
  createBlockPreview,
  type BlockModel,
  type BlockPreview,
} from 'minecraft-render';
import './style.css';

// All thumbnails are baked at this resolution regardless of card size.
const THUMB_SIZE = 256;

// ---------------------------------------------------------------------------
// DOM handles
// ---------------------------------------------------------------------------
const dropzone = document.getElementById('dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const vanillaPanel = document.getElementById('vanilla') as HTMLElement;
const vanillaStatus = document.getElementById('vanilla-status') as HTMLElement;
const vanillaPicker = document.getElementById('vanilla-picker') as HTMLElement;
const versionSelect = document.getElementById(
  'version-select',
) as HTMLSelectElement;
const versionLoad = document.getElementById(
  'version-load',
) as HTMLButtonElement;
const controls = document.getElementById('controls') as HTMLElement;
const jarInfo = document.getElementById('jar-info') as HTMLElement;
const search = document.getElementById('search') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLElement;
const renderAllBtn = document.getElementById('render-all') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const grid = document.getElementById('grid') as HTMLElement;

const previewOverlay = document.getElementById('preview') as HTMLElement;
const previewStage = document.getElementById('preview-stage') as HTMLElement;
const previewName = document.getElementById('preview-name') as HTMLElement;
const spinToggle = document.getElementById('spin') as HTMLInputElement;
const previewDownload = document.getElementById(
  'preview-download',
) as HTMLButtonElement;
const previewClose = document.getElementById(
  'preview-close',
) as HTMLButtonElement;

const exportOverlay = document.getElementById('export') as HTMLElement;
const exportCount = document.getElementById('export-count') as HTMLElement;
const exportRes = document.getElementById('export-res') as HTMLSelectElement;
const exportDistance = document.getElementById(
  'export-distance',
) as HTMLInputElement;
const exportDistanceVal = document.getElementById(
  'export-distance-val',
) as HTMLOutputElement;
const exportCamera = document.getElementById(
  'export-camera',
) as HTMLSelectElement;
const exportLight = document.getElementById('export-light') as HTMLInputElement;
const exportLightVal = document.getElementById(
  'export-light-val',
) as HTMLOutputElement;
const exportNoGui = document.getElementById('export-nogui') as HTMLInputElement;
const exampleStage = document.getElementById('example-stage') as HTMLElement;
const exampleCaption = document.getElementById(
  'example-caption',
) as HTMLElement;
const exportProgress = document.getElementById(
  'export-progress',
) as HTMLElement;
const exportBar = document.getElementById('export-bar') as HTMLElement;
const exportStatus = document.getElementById('export-status') as HTMLElement;
const exportRun = document.getElementById('export-run') as HTMLButtonElement;
const exportCancelBtn = document.getElementById(
  'export-cancel',
) as HTMLButtonElement;
const exportCloseBtn = document.getElementById(
  'export-close',
) as HTMLButtonElement;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let minecraft: Minecraft | null = null;
let loadedJars: Jar[] = [];
const cards = new Map<string, HTMLElement>();
// Resolved models are cached (parent resolution is not free) and shared between
// the thumbnail render and the live preview. A cached `Error` means "known bad".
const models = new Map<string, BlockModel | Error>();

let observer: IntersectionObserver | null = null;
const queue: string[] = [];
const queued = new Set<string>();
let draining = false;
let rendererReady = false;

let preview: BlockPreview | null = null;

// One reusable spinning preview shared by every thumbnail's hover state — its
// canvas is relocated into whichever card is hovered, so a single GL context
// serves them all.
let hoverPreview: BlockPreview | null = null;
let hoverInit: Promise<BlockPreview> | null = null;
const hoverCanvas = document.createElement('canvas');
hoverCanvas.className = 'hover-canvas';
let hoverName: string | null = null;

let exportNames: string[] = [];
let exportRunning = false;
let exportCancel = false;

// Live example preview shown inside the export dialog (the first renderable
// block), so parameter changes are visible before committing.
let example: BlockPreview | null = null;
let exampleModel: BlockModel | null = null;
let exampleTimer: number | null = null;

// ---------------------------------------------------------------------------
// Drag & drop
// ---------------------------------------------------------------------------
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) loadJars([...fileInput.files]);
});

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
  }),
);
dropzone.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer?.files ?? [])].filter((f) =>
    /\.(jar|zip)$/i.test(f.name),
  );
  if (files.length) loadJars(files);
});

resetBtn.addEventListener('click', () => location.reload());
search.addEventListener('input', applyFilter);
renderAllBtn.addEventListener('click', () => openExport(visibleNames()));

// ---------------------------------------------------------------------------
// Load jars → open Minecraft → list blocks
// ---------------------------------------------------------------------------
async function loadJars(files: File[]) {
  try {
    statusEl.textContent = `Reading ${files.length} jar(s)…`;

    // Smallest jar first: a mod jar is tiny, the vanilla jar is huge, and the
    // first jar carrying block models decides the namespace to enumerate — so a
    // mod jar should win over the vanilla fallback beside it.
    const ordered = [...files].sort((a, b) => a.size - b.size);
    const jars = await Promise.all(ordered.map((f) => Jar.fromBlob(f)));
    await openJars(
      jars,
      ordered.map((f) => f.name),
    );
  } catch (err: any) {
    statusEl.textContent = '';
    alert(formatError(err));
    console.error(err);
  }
}

// Shared entry once jars are in hand (from drag & drop or a fetched vanilla
// version): open them, enumerate blocks, and switch to the grid.
async function openJars(jars: Jar[], names: string[]) {
  loadedJars = jars;
  minecraft = Minecraft.open(jars);
  const ns = await minecraft.namespace();
  const blockNames = (await minecraft.getBlockNameList()).sort();

  const info = await minecraft.inspect().catch(() => null);
  jarInfo.innerHTML =
    `<span class="pill">${names.join(', ')}</span>` +
    `<span class="pill">namespace: <b>${ns}</b></span>` +
    (info?.loader ? `<span class="pill">loader: ${info.loader}</span>` : '') +
    `<span class="pill">${blockNames.length} blocks</span>`;

  dropzone.hidden = true;
  vanillaPanel.hidden = true;
  controls.hidden = false;

  await ensureRenderer();
  buildCards(blockNames);
  applyFilter();
  statusEl.textContent = '';
}

function formatError(err: any): string {
  return `Operation failed. Reason: ${err?.message ?? String(err)}`;
}

// ---------------------------------------------------------------------------
// Vanilla versions (fetched through a CORS proxy, no download needed)
// ---------------------------------------------------------------------------
const MANIFEST_URL =
  'https://launchermeta.mojang.com/mc/game/version_manifest.json';

const corsUrl = (url: string) =>
  'https://corsproxy.io?' + encodeURIComponent(url);

async function proxiedFetch(url: string): Promise<Response> {
  const proxied = await fetch(corsUrl(url));
  if (!proxied.ok) throw new Error(`request failed (HTTP ${proxied.status})`);
  return proxied;
}

async function fetchJson(url: string): Promise<any> {
  return (await proxiedFetch(url)).json();
}

async function fetchBytes(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const res = await proxiedFetch(url);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function initVanilla() {
  // Keep the whole section hidden until the manifest is confirmed reachable, so
  // a blocked request never leaves a dead control on screen misleading users.
  try {
    const manifest = await fetchJson(MANIFEST_URL);
    const latest: string | undefined = manifest.latest?.release;
    const releases: { id: string; url: string }[] = (
      manifest.versions ?? []
    ).filter((v: any) => v.type === 'release');

    if (!releases.length) throw new Error('no releases in the manifest');

    versionSelect.innerHTML = '';
    for (const v of releases) {
      const opt = document.createElement('option');
      opt.value = v.url;
      opt.dataset.versionId = v.id;
      opt.textContent = v.id === latest ? `${v.id} (latest)` : v.id;
      if (v.id === latest) opt.selected = true;
      versionSelect.appendChild(opt);
    }

    vanillaStatus.textContent = 'No jar? Load a vanilla version directly:';
    vanillaPicker.hidden = false;
    vanillaPanel.hidden = false;
  } catch (err) {
    // Manifest unavailable (proxy/CORS blocked, offline, …): stay hidden.
    console.error('Minecraft version manifest unavailable:', err);
  }
}

async function loadVanilla(versionUrl: string, versionId: string) {
  versionLoad.disabled = true;
  versionSelect.disabled = true;
  vanillaStatus.classList.remove('error');
  try {
    vanillaStatus.textContent = `Fetching Minecraft ${versionId} metadata…`;
    const meta = await fetchJson(versionUrl);
    const jarUrl: string | undefined = meta?.downloads?.client?.url;
    if (!jarUrl) {
      throw new Error(`no client jar is listed for Minecraft ${versionId}`);
    }

    const bytes = await fetchBytes(jarUrl, (loaded, total) => {
      const mb = (loaded / 1e6).toFixed(1);
      vanillaStatus.textContent = total
        ? `Downloading Minecraft ${versionId}… ${mb} / ${(total / 1e6).toFixed(1)} MB`
        : `Downloading Minecraft ${versionId}… ${mb} MB`;
    });

    vanillaStatus.textContent = `Reading Minecraft ${versionId}…`;
    const jar = Jar.fromBytes(`minecraft-${versionId}.jar`, bytes);
    await openJars([jar], [`minecraft-${versionId}.jar`]);
  } catch (err) {
    showVanillaError(err);
    versionLoad.disabled = false;
    versionSelect.disabled = false;
  }
}

function showVanillaError(err: any) {
  vanillaPanel.hidden = false;
  vanillaPicker.hidden = false;
  vanillaStatus.classList.add('error');
  vanillaStatus.textContent = formatError(err);
  console.error(err);
}

versionLoad.addEventListener('click', () => {
  const opt = versionSelect.selectedOptions[0];
  if (opt) loadVanilla(opt.value, opt.dataset.versionId || 'unknown');
});

initVanilla();

async function ensureRenderer() {
  if (!minecraft) return;
  await minecraft.prepareRenderEnvironment({
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    renderWithoutGui: true,
    animation: true,
  });
  rendererReady = true;
}

// ---------------------------------------------------------------------------
// Card grid + lazy render on visibility
// ---------------------------------------------------------------------------
function buildCards(names: string[]) {
  grid.innerHTML = '';
  cards.clear();
  observer?.disconnect();
  observer = new IntersectionObserver(onIntersect, {
    root: null,
    rootMargin: '250px',
  });

  const frag = document.createDocumentFragment();
  for (const name of names) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.name = name;
    card.innerHTML =
      `<div class="thumb"><span class="placeholder">◻</span></div>` +
      `<div class="label" title="${name}">${name}</div>`;
    card.addEventListener('click', () => openPreview(name));
    card.addEventListener('mouseenter', () => onCardEnter(name, card));
    card.addEventListener('mouseleave', () => onCardLeave(name));
    cards.set(name, card);
    frag.appendChild(card);
    observer.observe(card);
  }
  grid.appendChild(frag);
}

function onIntersect(entries: IntersectionObserverEntry[]) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const card = entry.target as HTMLElement;
    const name = card.dataset.name!;
    if (
      card.classList.contains('rendered') ||
      card.classList.contains('skipped') ||
      queued.has(name)
    ) {
      continue;
    }
    queued.add(name);
    queue.push(name);
    drain();
  }
}

async function drain() {
  if (draining || !minecraft) return;
  draining = true;
  try {
    while (queue.length) {
      if (!rendererReady) break;
      const name = queue.shift()!;
      queued.delete(name);
      const card = cards.get(name);
      if (!card || card.classList.contains('rendered')) continue;
      await renderThumb(name, card);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    draining = false;
  }
}

async function renderThumb(name: string, card: HTMLElement) {
  try {
    const model = await getModel(name);
    const result = await render(minecraft!, model);
    if (result.skip || !result.buffer) {
      markSkip(card, shortReason(result.skip ?? 'no output'));
    } else {
      markImage(card, result.buffer);
    }
  } catch (err: any) {
    markSkip(card, shortReason(err?.message ?? 'error'));
  }
}

async function getModel(name: string): Promise<BlockModel> {
  const cached = models.get(name);
  if (cached instanceof Error) throw cached;
  if (cached) return cached;
  try {
    const model = await minecraft!.getModel(name);
    models.set(name, model);
    return model;
  } catch (err: any) {
    const e = err instanceof Error ? err : new Error(String(err));
    models.set(name, e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Hover-to-spin (shared live preview relocated into the hovered card)
// ---------------------------------------------------------------------------
// Lazily create the single shared preview, guarding against two hovers racing
// to create it (which would leak a second GL context).
function ensureHoverPreview(model: BlockModel): Promise<BlockPreview> {
  if (hoverPreview) return Promise.resolve(hoverPreview);
  if (!hoverInit) {
    hoverInit = createBlockPreview(hoverCanvas, minecraft!, model, {
      autoRotate: true,
      input: false,
    }).then((p) => (hoverPreview = p));
  }
  return hoverInit;
}

async function onCardEnter(name: string, card: HTMLElement) {
  if (!minecraft) return;
  hoverName = name;

  let model: BlockModel;
  try {
    model = await getModel(name);
  } catch {
    return; // unresolved model — leave the static thumbnail
  }
  if (hoverName !== name || !model.elements?.length) return;

  const thumb = card.querySelector('.thumb') as HTMLElement;
  thumb.appendChild(hoverCanvas); // moves the shared canvas into this card
  // Hide the static thumbnail so it doesn't show through the transparent
  // spinning canvas (which would look like two overlaid blocks).
  thumb.classList.add('spinning');

  const p = await ensureHoverPreview(model);
  if (hoverName !== name) return; // moved on while (re)initialising
  await p.setBlock(model);
  if (hoverName !== name) return;
  p.setActive(true);
  p.resize();
}

function onCardLeave(name: string) {
  if (hoverName === name) hoverName = null;
  hoverPreview?.setActive(false);
  const thumb = hoverCanvas.parentElement;
  thumb?.classList.remove('spinning');
  hoverCanvas.remove();
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------
function applyFilter() {
  const q = search.value.trim().toLowerCase();
  let visible = 0;
  for (const [name, card] of cards) {
    const show = !q || name.toLowerCase().includes(q);
    card.hidden = !show;
    if (show) visible++;
  }
  renderAllBtn.textContent = `Render all → download (${visible})`;
  renderAllBtn.disabled = visible === 0;
}

function visibleNames(): string[] {
  return [...cards.entries()]
    .filter(([, card]) => !card.hidden)
    .map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Card visuals
// ---------------------------------------------------------------------------
function markImage(card: HTMLElement, buffer: Uint8Array) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'image/png' }));
  const thumb = card.querySelector('.thumb') as HTMLElement;
  const keepCanvas = thumb.contains(hoverCanvas);
  thumb.innerHTML = '';
  if (keepCanvas) thumb.appendChild(hoverCanvas);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  img.alt = card.dataset.name ?? '';
  img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  thumb.prepend(img);
  card.classList.remove('skipped');
  card.classList.add('rendered');
}

function markSkip(card: HTMLElement, reason: string) {
  const thumb = card.querySelector('.thumb') as HTMLElement;
  thumb.innerHTML = `<span class="skip" title="${reason}">${reason}</span>`;
  card.classList.remove('rendered');
  card.classList.add('skipped');
}

function shortReason(msg: string): string {
  return msg.length > 60 ? msg.slice(0, 57) + '…' : msg;
}

// ---------------------------------------------------------------------------
// Live rotatable preview (click)
// ---------------------------------------------------------------------------
async function openPreview(name: string) {
  if (!minecraft) return;
  let model: BlockModel;
  try {
    model = await getModel(name);
  } catch (err: any) {
    alert(`Can't preview "${name}": ${err?.message ?? err}`);
    return;
  }
  if (!model.elements?.length) {
    alert(`"${name}" has no geometry to preview.`);
    return;
  }

  previewName.textContent = name;

  // A canvas whose WebGL context was force-lost (on dispose) can't get a working
  // context again, so give each open a fresh canvas.
  preview?.dispose();
  preview = null;
  const canvas = document.createElement('canvas');
  previewStage.replaceChildren(canvas);
  previewOverlay.hidden = false;

  try {
    preview = await createBlockPreview(canvas, minecraft, model, {
      autoRotate: spinToggle.checked,
    });
  } catch (err: any) {
    closePreview();
    alert(`Preview failed: ${err?.message ?? err}`);
  }
}

function closePreview() {
  preview?.dispose();
  preview = null;
  previewStage.replaceChildren();
  previewOverlay.hidden = true;
}

previewClose.addEventListener('click', closePreview);
previewOverlay.addEventListener('click', (e) => {
  if (e.target === previewOverlay) closePreview();
});
spinToggle.addEventListener('change', () =>
  preview?.setAutoRotate(spinToggle.checked),
);
previewDownload.addEventListener('click', () => {
  const name = previewName.textContent || '';
  closePreview();
  openExport([name]);
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!exportOverlay.hidden && !exportRunning) closeExport();
  else if (!previewOverlay.hidden) closePreview();
});
window.addEventListener('resize', () => preview?.resize());

// ---------------------------------------------------------------------------
// Export / renderer screen
// ---------------------------------------------------------------------------
function openExport(names: string[]) {
  if (!names.length) return;
  exportNames = names;
  exportCount.textContent =
    names.length === 1
      ? `1 block will be rendered at the default pose and downloaded as PNG.`
      : `${names.length} blocks will be rendered and downloaded as a single .zip.`;
  exportProgress.hidden = true;
  exportBar.style.width = '0%';
  exportStatus.textContent = '';
  exportCancelBtn.hidden = true;
  exportRun.disabled = false;
  exportDistanceVal.textContent = exportDistance.value;
  exportLightVal.textContent = `${exportLight.value}°`;
  exportOverlay.hidden = false;
  setupExample();
}

function closeExport() {
  if (exportRunning) return; // must cancel first
  disposeExample();
  exportOverlay.hidden = true;
}

// --- live example ---------------------------------------------------------
function exampleOptions() {
  return {
    input: false,
    autoRotate: false,
    cameraType: (exportCamera.value === 'perspective'
      ? 'perspective'
      : 'orthographic') as 'perspective' | 'orthographic',
    distance: Number(exportDistance.value) || 20,
    lightAngle: Number(exportLight.value) || 0,
  };
}

async function setupExample() {
  disposeExample();
  if (!minecraft) return;
  exampleModel = null;
  // The first block that actually has geometry to show.
  for (const name of exportNames) {
    try {
      const model = await getModel(name);
      if (model.elements?.length) {
        exampleModel = model;
        exampleCaption.textContent = `live example · ${name}`;
        break;
      }
    } catch {
      /* keep looking */
    }
  }
  if (!exampleModel) {
    exampleCaption.textContent = 'no previewable block';
    return;
  }
  await createExample();
}

async function createExample() {
  if (!minecraft || !exampleModel) return;
  // A fresh canvas each time: a disposed preview force-loses its GL context, so
  // the element can't be reused.
  example?.dispose();
  example = null;
  const canvas = document.createElement('canvas');
  exampleStage.replaceChildren(canvas);
  try {
    example = await createBlockPreview(
      canvas,
      minecraft,
      exampleModel,
      exampleOptions(),
    );
  } catch (err) {
    console.error(err);
  }
}

function disposeExample() {
  if (exampleTimer) {
    clearTimeout(exampleTimer);
    exampleTimer = null;
  }
  example?.dispose();
  example = null;
  exampleModel = null;
  exampleStage.replaceChildren();
}

// Camera type / distance change the camera object or frustum, so the example is
// rebuilt (debounced); the light angle only repositions the light, so it can be
// applied live for a smooth slider.
function scheduleExampleRebuild() {
  if (exampleTimer) clearTimeout(exampleTimer);
  exampleTimer = window.setTimeout(() => createExample(), 120);
}

exportCloseBtn.addEventListener('click', closeExport);
exportOverlay.addEventListener('click', (e) => {
  if (e.target === exportOverlay) closeExport();
});
exportCancelBtn.addEventListener('click', () => {
  exportCancel = true;
});
exportRun.addEventListener('click', runExport);

exportCamera.addEventListener('change', scheduleExampleRebuild);
exportDistance.addEventListener('input', () => {
  exportDistanceVal.textContent = exportDistance.value;
  scheduleExampleRebuild();
});
exportLight.addEventListener('input', () => {
  exportLightVal.textContent = `${exportLight.value}°`;
  example?.setLightAngle(Number(exportLight.value) || 0);
});

async function runExport() {
  if (exportRunning || !loadedJars.length) return;
  const names = exportNames;
  const size = Number(exportRes.value);
  const distance = Number(exportDistance.value) || 20;
  const cameraType =
    exportCamera.value === 'perspective' ? 'perspective' : 'orthographic';
  const lightAngle = Number(exportLight.value) || 0;
  const renderWithoutGui = exportNoGui.checked;

  exportRunning = true;
  exportCancel = false;
  exportRun.disabled = true;
  exportCancelBtn.hidden = false;
  exportProgress.hidden = false;
  // Pause the example's render loop so it doesn't compete with the export.
  example?.setActive(false);
  setExportProgress(0, names.length, 'Resolving models…');

  // A separate Minecraft instance over the same jars keeps the export's render
  // environment (at export resolution) from disturbing the live thumbnail one.
  const exporter = Minecraft.open(loadedJars);
  const outputs: { name: string; buffer: Uint8Array }[] = [];

  try {
    const resolved: BlockModel[] = [];
    for (const name of names) {
      if (exportCancel) break;
      try {
        resolved.push(await exporter.getModel(name));
      } catch {
        /* unresolved — skip */
      }
    }

    let done = 0;
    setExportProgress(0, resolved.length, 'Rendering…');
    for await (const result of exporter.render(resolved, {
      width: size,
      height: size,
      distance,
      cameraType,
      lightAngle,
      renderWithoutGui,
      animation: true,
    })) {
      if (exportCancel) break;
      if (!result.skip && result.buffer) {
        outputs.push({
          name: safeName(result.blockName ?? 'block'),
          buffer: result.buffer,
        });
      }
      setExportProgress(++done, resolved.length, 'Rendering…');
      await new Promise((r) => setTimeout(r, 0));
    }
  } catch (err: any) {
    console.error(err);
    alert(`Render failed: ${err?.message ?? err}`);
  } finally {
    await exporter.close().catch(() => {});
  }

  if (exportCancel) {
    resetExportUI();
    return;
  }
  if (!outputs.length) {
    alert('Nothing was rendered (all blocks skipped).');
    resetExportUI();
    return;
  }

  if (outputs.length === 1) {
    download(`${outputs[0].name}.png`, outputs[0].buffer, 'image/png');
  } else {
    setExportProgress(outputs.length, outputs.length, 'Zipping…');
    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (const out of outputs) {
      let key = `${out.name}.png`;
      let n = 2;
      while (used.has(key)) key = `${out.name}-${n++}.png`;
      used.add(key);
      files[key] = out.buffer;
    }
    // PNGs are already compressed; store (level 0) for speed.
    const zipped = zipSync(files, { level: 0 });
    download('renders.zip', zipped, 'application/zip');
  }

  resetExportUI();
  closeExport();
}

function setExportProgress(done: number, total: number, label: string) {
  exportBar.style.width = total ? `${(done / total) * 100}%` : '0%';
  exportStatus.textContent = `${label} ${done} / ${total}`;
}

function resetExportUI() {
  exportRunning = false;
  exportRun.disabled = false;
  exportCancelBtn.hidden = true;
  exportProgress.hidden = true;
  exportBar.style.width = '0%';
  // Resume the example loop (the dialog stays open after a cancel).
  example?.setActive(true);
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_');
}

function download(filename: string, data: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
