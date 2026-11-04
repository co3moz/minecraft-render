// Decides which Minecraft versions the wiki-gallery workflow should render, and
// emits them as a GitHub Actions matrix.
//
// Env:
//   VERSIONS   what to consider (default: latest)
//                latest           the latest release only (the weekly run)
//                majors           the newest release of every version line
//                                 (1.8, 1.9, ..., 1.21, 26.1, 26.2, ...)
//                1.20.6,1.12.2    an explicit list of exact version ids
//   WIKI_DIR   checked-out wiki repo; versions that already have a
//              Blocks-<version>.md page there are dropped (default ./wiki;
//              a missing folder means the wiki is empty)
//
// Outputs (to $GITHUB_OUTPUT, or stdout when run locally):
//   matrix     JSON array of { version, without_gui } for `strategy.matrix.include`
//   versions   the same versions, space-separated, for logs / commit messages
//   has_work   'true' when there is at least one version to render

import * as fs from 'node:fs';

const MANIFEST_URL =
  'https://launchermeta.mojang.com/mc/game/version_manifest.json';

const request = (process.env.VERSIONS || '').trim() || 'latest';
const WIKI_DIR = process.env.WIKI_DIR || './wiki';

const manifest = await (await fetch(MANIFEST_URL)).json();
const releases = manifest.versions.filter((v) => v.type === 'release');
const known = new Set(manifest.versions.map((v) => v.id));

let candidates;
if (request === 'latest') {
  candidates = [manifest.latest.release];
} else if (request === 'majors') {
  // The manifest lists newest first, so the first release seen per line is
  // that line's newest patch.
  const byLine = new Map();
  for (const v of releases) {
    if (!isSupported(v.id)) continue;
    const line = versionLine(v.id);
    if (!byLine.has(line)) byLine.set(line, v.id);
  }
  candidates = [...byLine.values()];
} else {
  candidates = [...new Set(request.split(/[\s,]+/).filter(Boolean))];
  const unknown = candidates.filter((id) => !known.has(id));
  if (unknown.length)
    fail(`Unknown Minecraft version(s): ${unknown.join(', ')}`);
  const unsupported = candidates.filter((id) => !isSupported(id));
  if (unsupported.length) {
    fail(
      `Unsupported version(s): ${unsupported.join(', ')}. ` +
        'Block models are JSON only since 1.8.',
    );
  }
}

const published = existingGalleries(WIKI_DIR);
const skipped = candidates.filter((id) => published.has(id));
const todo = candidates.filter((id) => !published.has(id));

if (skipped.length) console.log(`Already in the wiki: ${skipped.join(', ')}`);
console.log(
  todo.length ? `To render: ${todo.join(', ')}` : 'Nothing to render.',
);

const matrix = todo.map((version) => ({
  version,
  without_gui: isLegacyModelFormat(version),
}));

writeOutputs({
  matrix: JSON.stringify(matrix),
  versions: todo.join(' '),
  has_work: String(todo.length > 0),
});

// `1.21.11` -> `1.21`, `26.1.2` -> `26.1`, `26.3` -> `26.3`.
function versionLine(id) {
  return id.split('.').slice(0, 2).join('.');
}

// JSON block models (what the renderer reads) were introduced in 1.8.
function isSupported(id) {
  const [major, minor] = id.split('.').map((x) => parseInt(x, 10) || 0);
  return major > 1 || minor >= 8;
}

// 1.8 models carry no `display.gui` (the inventory pose was hard-coded in the
// game), so they are rendered with the default vanilla inventory transform.
function isLegacyModelFormat(id) {
  return versionLine(id) === '1.8';
}

function existingGalleries(dir) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs
      .readdirSync(dir)
      .filter((f) => /^Blocks-.+\.md$/.test(f))
      .map((f) => f.replace(/^Blocks-/, '').replace(/\.md$/, '')),
  );
}

function writeOutputs(outputs) {
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  } else {
    console.log(lines.join('\n'));
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
