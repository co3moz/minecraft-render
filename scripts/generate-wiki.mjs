// Builds a GitHub wiki page for a single rendered Minecraft version.
//
// Reads the PNGs produced by the render tests in TEST_DATA_DIR, derives the
// version from the downloaded minecraft-<version>.jar (or the VERSION env),
// copies the images into the wiki repo, and writes a per-version page plus a
// regenerated Home/_Sidebar index that links every version present.
//
// Wiki markup is sanitized by GitHub (no <style>/CSS), but <table> and <img>
// survive, so the grid is an HTML table. Images are referenced by their raw
// wiki URL, which resolves regardless of how the page is nested.
//
// Env:
//   TEST_DATA_DIR  source of the .png files and minecraft-*.jar (default ./test-data)
//   WIKI_DIR       checked-out wiki repo to write into (default ./wiki)
//   REPO           owner/repo, used to build raw image URLs (default $GITHUB_REPOSITORY)
//   VERSION        override the version instead of deriving it from the jar name
//   COLUMNS        images per row in the grid (default 6)

import * as fs from 'node:fs';
import * as path from 'node:path';

const TEST_DATA_DIR = process.env.TEST_DATA_DIR || './test-data';
const WIKI_DIR = process.env.WIKI_DIR || './wiki';
const REPO = process.env.REPO || process.env.GITHUB_REPOSITORY || '';
const COLUMNS = parseInt(process.env.COLUMNS || '6', 10);

if (!REPO) {
  console.error('REPO (or GITHUB_REPOSITORY) is required to build image URLs.');
  process.exit(1);
}

const version = process.env.VERSION || deriveVersion(TEST_DATA_DIR);
if (!version) {
  console.error(
    `Could not determine version: no VERSION env and no minecraft-*.jar in ${TEST_DATA_DIR}.`,
  );
  process.exit(1);
}

const pngs = fs
  .readdirSync(TEST_DATA_DIR)
  .filter((f) => f.endsWith('.png'))
  .sort();

if (pngs.length === 0) {
  console.error(`No .png files found in ${TEST_DATA_DIR}; nothing to publish.`);
  process.exit(1);
}

// Copy the images into the wiki under a per-version folder.
const imagesDir = path.join(WIKI_DIR, 'images', version);
fs.mkdirSync(imagesDir, { recursive: true });
for (const png of pngs) {
  fs.copyFileSync(path.join(TEST_DATA_DIR, png), path.join(imagesDir, png));
}

// Raw wiki content is served from this host; relative wiki links are flaky, so
// reference images absolutely.
const rawBase = `https://raw.githubusercontent.com/wiki/${REPO}/images/${version}`;

let table = '<table>\n';
for (let i = 0; i < pngs.length; i++) {
  if (i % COLUMNS === 0) table += '<tr>\n';
  const png = pngs[i];
  const name = png.replace(/\.png$/, '');
  const url = `${rawBase}/${encodeURIComponent(png)}`;
  table += `<td align="center"><img src="${url}" width="128" height="128" alt="${name}"><br><sub>${name}</sub></td>\n`;
  if (i % COLUMNS === COLUMNS - 1 || i === pngs.length - 1) table += '</tr>\n';
}
table += '</table>\n';

const page = `# Minecraft ${version}

${pngs.length} blocks / items rendered at 256×256.

${table}`;

const pageName = `Blocks-${version}.md`;
fs.writeFileSync(path.join(WIKI_DIR, pageName), page);
console.log(`Wrote ${pageName} (${pngs.length} images).`);

regenerateIndex(WIKI_DIR);

function deriveVersion(dir) {
  if (!fs.existsSync(dir)) return '';
  const jar = fs.readdirSync(dir).find((f) => /^minecraft-.+\.jar$/.test(f));
  return jar ? jar.replace(/^minecraft-/, '').replace(/\.jar$/, '') : '';
}

// Rebuild Home.md and _Sidebar.md from every Blocks-<version>.md present so the
// index always reflects the full set of published versions, newest first.
function regenerateIndex(wikiDir) {
  const versions = fs
    .readdirSync(wikiDir)
    .filter((f) => /^Blocks-.+\.md$/.test(f))
    .map((f) => f.replace(/^Blocks-/, '').replace(/\.md$/, ''))
    .sort(compareVersionsDesc);

  const links = versions
    .map((v) => `- [Minecraft ${v}](Blocks-${v})`)
    .join('\n');

  const home = `# minecraft-render gallery

Rendered block & item galleries per Minecraft release. Updated automatically.

## Versions

${links}
`;
  fs.writeFileSync(path.join(wikiDir, 'Home.md'), home);

  const sidebar = `### Versions

${links}
`;
  fs.writeFileSync(path.join(wikiDir, '_Sidebar.md'), sidebar);

  console.log(`Index rebuilt for ${versions.length} version(s).`);
}

function compareVersionsDesc(a, b) {
  const pa = a.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}
