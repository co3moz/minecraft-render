// Shared by the wiki scripts: rebuilds Home.md and _Sidebar.md from the pages
// present in a checked-out wiki, so the index always reflects the full set.

import * as fs from 'node:fs';
import * as path from 'node:path';

// Sections, in order: version galleries and change reports newest-first, then
// mods alphabetically.
export function regenerateIndex(wikiDir) {
  const files = fs.readdirSync(wikiDir);

  const versions = galleryVersions(wikiDir)
    .reverse()
    .map((v) => `- [Minecraft ${v}](Blocks-${v})`);

  const changes = files
    .filter((f) => /^Changes-.+\.md$/.test(f))
    .map((f) => f.replace(/^Changes-/, '').replace(/\.md$/, ''))
    .sort((a, b) => compareVersions(b, a))
    .map((v) => `- [${pageTitle(wikiDir, `Changes-${v}.md`)}](Changes-${v})`);

  const mods = files
    .filter((f) => /^Mod-.+\.md$/.test(f))
    .map((f) => f.replace(/^Mod-/, '').replace(/\.md$/, ''))
    .sort((a, b) => a.localeCompare(b))
    .map((m) => `- [${m}](Mod-${m})`);

  const sections = [];
  if (versions.length) sections.push(`## Versions\n\n${versions.join('\n')}`);
  if (changes.length) sections.push(`## Changes\n\n${changes.join('\n')}`);
  if (mods.length) sections.push(`## Mods\n\n${mods.join('\n')}`);
  const body = sections.join('\n\n');

  const home = `# minecraft-render gallery

Rendered block & item galleries. Updated automatically.

${body}
`;
  fs.writeFileSync(path.join(wikiDir, 'Home.md'), home);

  const sidebar = sections.map((s) => s.replace(/^## /, '### ')).join('\n\n');
  fs.writeFileSync(path.join(wikiDir, '_Sidebar.md'), `${sidebar}\n`);

  console.log(
    `Index rebuilt: ${versions.length} version(s), ${changes.length} change page(s), ${mods.length} mod(s).`,
  );
}

/** Versions that have a Blocks-<version>.md gallery, oldest first. */
export function galleryVersions(wikiDir) {
  return fs
    .readdirSync(wikiDir)
    .filter((f) => /^Blocks-.+\.md$/.test(f))
    .map((f) => f.replace(/^Blocks-/, '').replace(/\.md$/, ''))
    .sort(compareVersions);
}

/** Orders version ids numerically, oldest first (`1.9.4` < `1.21.11` < `26.1`). */
export function compareVersions(a, b) {
  const pa = a.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

// The page's `# heading`, used as its link text.
function pageTitle(wikiDir, file) {
  const first = fs
    .readFileSync(path.join(wikiDir, file), 'utf8')
    .split('\n')[0];
  return first.replace(/^#\s*/, '').trim() || file.replace(/\.md$/, '');
}
