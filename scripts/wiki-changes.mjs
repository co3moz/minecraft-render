// Builds a "Changes" wiki page for every step between consecutive version
// galleries (1.8.9 -> 1.9.4 -> ... -> latest), from the gallery images already
// in the wiki checkout. Each page lists, for the newer version:
//   - changed: blocks in both versions whose render differs (old -> new)
//   - added:   blocks only the newer version has
//   - removed: blocks only the older version has
// Blocks that render identically are left out.
//
// Renders are deterministic (the same model and textures give a byte-identical
// PNG), so files are compared by bytes first and only decoded when the bytes
// differ; a block counts as changed when any pixel of any frame differs.
//
// All pages are regenerated on every run, so the reports stay consistent when a
// gallery is re-rendered or a version is inserted into the chain; pages for
// steps that no longer exist are deleted.
//
// Env:
//   WIKI_DIR   checked-out wiki repo (default ./wiki)
//   REPO       owner/repo for raw image URLs (default $GITHUB_REPOSITORY)

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { galleryVersions, regenerateIndex } from './wiki-index.mjs';

const WIKI_DIR = process.env.WIKI_DIR || './wiki';
const REPO = process.env.REPO || process.env.GITHUB_REPOSITORY || '';

const GRID_COLUMNS = 6;
const PAIR_COLUMNS = 3;

if (!REPO) {
  console.error('REPO (or GITHUB_REPOSITORY) is required to build image URLs.');
  process.exit(1);
}

const versions = galleryVersions(WIKI_DIR);
const written = new Set();

for (let i = 1; i < versions.length; i++) {
  const from = versions[i - 1];
  const to = versions[i];
  const diff = diffGalleries(from, to);
  const pageFile = `Changes-${to}.md`;
  fs.writeFileSync(path.join(WIKI_DIR, pageFile), renderPage(from, to, diff));
  written.add(pageFile);
  console.log(
    `${pageFile}: ${diff.changed.length} changed, ${diff.added.length} added, ${diff.removed.length} removed (from ${from}).`,
  );
}

for (const file of fs.readdirSync(WIKI_DIR)) {
  if (/^Changes-.+\.md$/.test(file) && !written.has(file)) {
    fs.unlinkSync(path.join(WIKI_DIR, file));
    console.log(`Removed stale ${file}.`);
  }
}

regenerateIndex(WIKI_DIR);

function diffGalleries(from, to) {
  const fromDir = path.join(WIKI_DIR, 'images', from);
  const toDir = path.join(WIKI_DIR, 'images', to);
  const fromFiles = listPngs(fromDir);
  const toFiles = listPngs(toDir);
  const fromSet = new Set(fromFiles);
  const toSet = new Set(toFiles);

  const changed = toFiles.filter(
    (f) =>
      fromSet.has(f) &&
      rendersDiffer(path.join(fromDir, f), path.join(toDir, f)),
  );
  const added = toFiles.filter((f) => !fromSet.has(f));
  const removed = fromFiles.filter((f) => !toSet.has(f));

  return { changed, added, removed };
}

function listPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort();
}

function rendersDiffer(a, b) {
  const bufA = fs.readFileSync(a);
  const bufB = fs.readFileSync(b);
  if (bufA.equals(bufB)) return false;

  let imgA, imgB;
  try {
    imgA = decodePng(bufA);
    imgB = decodePng(bufB);
  } catch {
    // Not decodable here: the bytes differ, so report it rather than hide it.
    return true;
  }

  // Different dimensions, frame counts or pixel layouts: treat as changed.
  if (
    imgA.width !== imgB.width ||
    imgA.height !== imgB.height ||
    imgA.color !== imgB.color ||
    imgA.frames.length !== imgB.frames.length
  ) {
    return true;
  }
  return imgA.frames.some((frame, i) => !frame.equals(imgB.frames[i]));
}

function renderPage(from, to, { changed, added, removed }) {
  return `# Minecraft ${to} (from ${from})

**${changed.length}** changed · **${added.length}** added · **${removed.length}** removed

Galleries: [Minecraft ${from}](Blocks-${from}) → [Minecraft ${to}](Blocks-${to})

## Changed (${changed.length})

${changed.length ? pairTable(changed, from, to) : '_None._\n'}
## Added (${added.length})

${added.length ? gridTable(added, to) : '_None._\n'}
## Removed (${removed.length})

${removed.length ? gridTable(removed, from) : '_None._\n'}`;
}

// Old and new render side by side, so the difference is visible at a glance.
function pairTable(files, from, to) {
  return table(files, PAIR_COLUMNS, (png) => {
    const name = blockName(png);
    return (
      `<img src="${imageUrl(from, png)}" width="96" height="96" alt="${name} (${from})" title="${from}">` +
      ` → ` +
      `<img src="${imageUrl(to, png)}" width="96" height="96" alt="${name} (${to})" title="${to}">` +
      `<br><sub>${name}</sub>`
    );
  });
}

function gridTable(files, version) {
  return table(files, GRID_COLUMNS, (png) => {
    const name = blockName(png);
    return `<img src="${imageUrl(version, png)}" width="128" height="128" alt="${name}"><br><sub>${name}</sub>`;
  });
}

function table(files, columns, cell) {
  let html = '<table>\n';
  for (let i = 0; i < files.length; i++) {
    if (i % columns === 0) html += '<tr>\n';
    html += `<td align="center">${cell(files[i])}</td>\n`;
    if (i % columns === columns - 1 || i === files.length - 1)
      html += '</tr>\n';
  }
  return `${html}</table>\n`;
}

function blockName(png) {
  return png.replace(/\.png$/, '');
}

function imageUrl(version, png) {
  return `https://raw.githubusercontent.com/wiki/${REPO}/images/${version}/${encodeURIComponent(png)}`;
}

// Minimal PNG/APNG decoder: 8-bit, non-interlaced, grayscale/RGB(A) — what the
// renderer writes. APNG frames are full-size (see src/utils/apng.ts), so each
// frame's data is decoded on its own. Returns the unfiltered pixel bytes per
// frame, which compare exactly between images of the same color type.
function decodePng(buf) {
  let ihdr = null;
  const frames = [];
  let current = null;

  for (let off = 8; off < buf.length;) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + length);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12],
      };
    } else if (type === 'fcTL') {
      current = [];
      frames.push(current);
    } else if (type === 'IDAT') {
      if (!current) {
        current = [];
        frames.push(current);
      }
      current.push(data);
    } else if (type === 'fdAT') {
      current?.push(data.subarray(4)); // skip the sequence number
    }
    off += 12 + length;
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr?.color];
  if (!ihdr || ihdr.depth !== 8 || !channels || ihdr.interlace) {
    throw new Error('Unsupported PNG format');
  }

  return {
    width: ihdr.width,
    height: ihdr.height,
    color: ihdr.color,
    frames: frames
      .filter((chunks) => chunks.length)
      .map((chunks) =>
        unfilter(
          zlib.inflateSync(Buffer.concat(chunks)),
          ihdr.width,
          ihdr.height,
          channels,
        ),
      ),
  };
}

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[dst + x - bpp] : 0;
      const up = y ? out[dst - stride + x] : 0;
      const upLeft = y && x >= bpp ? out[dst - stride + x - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[dst + x] = (raw[src + x] + predictor) & 0xff;
    }
  }
  return out;
}
