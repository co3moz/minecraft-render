// Builds a GitHub wiki gallery page from a folder of rendered PNGs.
//
// Two kinds of galleries share this script:
//   - version (default): a vanilla Minecraft release. The slug is the version,
//     derived from the downloaded minecraft-<version>.jar unless VERSION is set.
//     Page: Blocks-<version>.md, images: images/<version>/.
//   - mod (KIND=mod): a mod jar. NAME is required and becomes the slug.
//     Page: Mod-<name>.md, images: images/mod-<name>/.
//
// Wiki markup is sanitized by GitHub (no <style>/CSS), but <table> and <img>
// survive, so the grid is an HTML table. Images are referenced by their raw
// wiki URL, which resolves regardless of how the page is nested.
//
// Env:
//   SRC_DIR / TEST_DATA_DIR  folder holding the .png files (default ./test-data)
//   WIKI_DIR                 checked-out wiki repo to write into (default ./wiki)
//   REPO                     owner/repo for raw image URLs (default $GITHUB_REPOSITORY)
//   COLUMNS                  images per row in the grid (default 6)
//   KIND                     'version' (default) or 'mod'
//   VERSION                  version slug override (version kind)
//   NAME                     mod slug (required for mod kind)
//   LABEL                    heading/index text override (default derived from slug)
//
// The version galleries are produced automatically by the wiki-gallery
// workflow. To add a mod gallery by hand (no Actions needed):
//
//   1. npm run build                       # if dist/ is stale
//   2. npx minecraft-render mod.jar ./out/create \
//        --auto-vanilla -w 256 -t 256      # render the mod's blocks to ./out/create
//   3. git clone https://github.com/<owner>/<repo>.wiki.git wiki
//   4. REPO=<owner>/<repo> SRC_DIR=./out/create WIKI_DIR=./wiki \
//        KIND=mod NAME=Create LABEL="Create (1.21.1)" node scripts/generate-wiki.mjs
//   5. cd wiki && git add -A && git commit -m "Add Create mod gallery" && git push
//
// Repeat steps 2 and 4 (varying NAME/LABEL) for each additional mod.

import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_DIR =
  process.env.SRC_DIR || process.env.TEST_DATA_DIR || './test-data';
const WIKI_DIR = process.env.WIKI_DIR || './wiki';
const REPO = process.env.REPO || process.env.GITHUB_REPOSITORY || '';
const COLUMNS = parseInt(process.env.COLUMNS || '6', 10);
const KIND = process.env.KIND || 'version';

if (!REPO) {
  console.error('REPO (or GITHUB_REPOSITORY) is required to build image URLs.');
  process.exit(1);
}

const target = resolveTarget();

const pngs = fs
  .readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.png'))
  .sort();

if (pngs.length === 0) {
  console.error(`No .png files found in ${SRC_DIR}; nothing to publish.`);
  process.exit(1);
}

// Copy the images into the wiki under a per-gallery folder.
const imagesDir = path.join(WIKI_DIR, 'images', target.imageSlug);
fs.mkdirSync(imagesDir, { recursive: true });
for (const png of pngs) {
  fs.copyFileSync(path.join(SRC_DIR, png), path.join(imagesDir, png));
}

// Raw wiki content is served from this host; relative wiki links are flaky, so
// reference images absolutely.
const rawBase = `https://raw.githubusercontent.com/wiki/${REPO}/images/${target.imageSlug}`;

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

const page = `# ${target.label}

${pngs.length} blocks / items rendered.

${table}`;

fs.writeFileSync(path.join(WIKI_DIR, target.pageFile), page);
console.log(`Wrote ${target.pageFile} (${pngs.length} images).`);

regenerateIndex(WIKI_DIR);

function resolveTarget() {
  if (KIND === 'mod') {
    const name = process.env.NAME;
    if (!name) {
      console.error('KIND=mod requires NAME (the mod slug).');
      process.exit(1);
    }
    const slug = slugify(name);
    return {
      pageFile: `Mod-${slug}.md`,
      imageSlug: `mod-${slug}`,
      label: process.env.LABEL || name,
    };
  }

  const version = process.env.VERSION || deriveVersion(SRC_DIR);
  if (!version) {
    console.error(
      `Could not determine version: no VERSION env and no minecraft-*.jar in ${SRC_DIR}.`,
    );
    process.exit(1);
  }
  return {
    pageFile: `Blocks-${version}.md`,
    imageSlug: version,
    label: process.env.LABEL || `Minecraft ${version}`,
  };
}

function slugify(value) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveVersion(dir) {
  if (!fs.existsSync(dir)) return '';
  const jar = fs.readdirSync(dir).find((f) => /^minecraft-.+\.jar$/.test(f));
  return jar ? jar.replace(/^minecraft-/, '').replace(/\.jar$/, '') : '';
}

// Rebuild Home.md and _Sidebar.md from every gallery page present so the index
// always reflects the full set, grouped by kind and newest-first per group.
function regenerateIndex(wikiDir) {
  const files = fs.readdirSync(wikiDir);

  const versions = files
    .filter((f) => /^Blocks-.+\.md$/.test(f))
    .map((f) => f.replace(/^Blocks-/, '').replace(/\.md$/, ''))
    .sort(compareVersionsDesc)
    .map((v) => `- [Minecraft ${v}](Blocks-${v})`);

  const mods = files
    .filter((f) => /^Mod-.+\.md$/.test(f))
    .map((f) => f.replace(/^Mod-/, '').replace(/\.md$/, ''))
    .sort((a, b) => a.localeCompare(b))
    .map((m) => `- [${m}](Mod-${m})`);

  const sections = [];
  if (versions.length) sections.push(`## Versions\n\n${versions.join('\n')}`);
  if (mods.length) sections.push(`## Mods\n\n${mods.join('\n')}`);
  const body = sections.join('\n\n');

  const home = `# minecraft-render gallery

Rendered block & item galleries. Updated automatically.

${body}
`;
  fs.writeFileSync(path.join(wikiDir, 'Home.md'), home);

  const sidebar = sections
    .map((s) => s.replace(/^## /, '### '))
    .join('\n\n');
  fs.writeFileSync(path.join(wikiDir, '_Sidebar.md'), `${sidebar}\n`);

  console.log(
    `Index rebuilt: ${versions.length} version(s), ${mods.length} mod(s).`,
  );
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
