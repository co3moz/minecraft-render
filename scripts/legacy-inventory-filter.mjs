// Trims a 1.8 render down to the blocks that actually appear in the inventory.
//
// 1.8 block models carry no `display.gui` (the inventory pose was hard-coded
// in the game), so they are rendered with RENDER_WITHOUT_GUI and every model
// gets a picture, including pieces that are never shown in the inventory
// (pane segments, crop stages, door halves...). In 1.8 the inventory shows a
// block through its item model, whose `parent` points at the block model, so
// only block models referenced that way are kept. That matches what 1.9+
// renders (models with a gui transform) and keeps version diffs meaningful.
//
// Usage: node scripts/legacy-inventory-filter.mjs <client.jar> <png dir>

import * as fs from 'node:fs';
import * as path from 'node:path';
import StreamZip from 'node-stream-zip';

const [jarPath, pngDir] = process.argv.slice(2);
if (!jarPath || !pngDir) {
  console.error('Usage: legacy-inventory-filter.mjs <client.jar> <png dir>');
  process.exit(1);
}

const zip = new StreamZip.async({ file: jarPath });
const inventory = new Set();
for (const name of Object.keys(await zip.entries())) {
  if (!/^assets\/minecraft\/models\/item\/.+\.json$/.test(name)) continue;
  const model = JSON.parse((await zip.entryData(name)).toString());
  const parent = model.parent?.replace(/^minecraft:/, '');
  if (parent?.startsWith('block/')) {
    // Rendered files are named after the block model, `/` replaced by `_`.
    inventory.add(`${parent.slice('block/'.length).replaceAll('/', '_')}.png`);
  }
}
await zip.close();

let kept = 0;
let removed = 0;
for (const file of fs.readdirSync(pngDir)) {
  if (!file.endsWith('.png')) continue;
  if (inventory.has(file)) {
    kept++;
  } else {
    fs.unlinkSync(path.join(pngDir, file));
    removed++;
  }
}

console.log(
  `Kept ${kept} inventory block(s), removed ${removed} non-inventory render(s).`,
);
