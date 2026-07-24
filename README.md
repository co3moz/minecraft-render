[![Rendered image](https://raw.githubusercontent.com/co3moz/minecraft-render/master/docs/soul_campfire.png)](https://github.com/co3moz/minecraft-render/blob/master/docs/soul_campfire.png)

minecraft-render
=======================

Renders minecraft block models from a .jar file using `THREE.js`.
Default output format is PNG `1000x1000`. Vanilla and **mod** jars are supported,
and rendering can be **parallelized** across worker processes.

### Pre-rendered assets

Pre-rendered block & item galleries live in the [wiki](https://github.com/co3moz/minecraft-render/wiki),
with a separate page per Minecraft release. A weekly job renders any new
release automatically.

Browse them here: [minecraft-render wiki](https://github.com/co3moz/minecraft-render/wiki)

[![Render Test](https://github.com/co3moz/minecraft-render/actions/workflows/ci.yml/badge.svg)](https://github.com/co3moz/minecraft-render/actions/workflows/ci.yml)
[![Wiki Gallery](https://github.com/co3moz/minecraft-render/actions/workflows/wiki-gallery.yml/badge.svg)](https://github.com/co3moz/minecraft-render/actions/workflows/wiki-gallery.yml)

### Binaries

> Please ensure Node.js version 22 or above is installed to run the binaries.

Basic usage;

```sh
npx minecraft-render


Usage: minecraft-render <jar> [output]

Options:
  -w, --width [width]        output image width (default: 1000)
  -t, --height [height]      output image height (default: 1000)
  -d, --distance [distance]  distance between camera and block (default: 20)
  -c, --camera <type>        camera projection: orthographic (default) or perspective
  -l, --light-angle <deg>    rotate the key light around the vertical axis (default: 0)
  -v, --verbose              increases logging level (default: 3)
  -p, --plane                debugging plane and axis (default: 0)
  -A, --no-animation         disables apng generation
  -f, --filter <regex>       regex pattern to filter blocks by name
  -m, --merge <jar>          extra fallback jar (e.g. the vanilla client jar) for mod assets; repeatable
  --auto-vanilla             detect the mod's required Minecraft version and download that vanilla jar if missing
  --cache-dir <dir>          directory to cache downloaded vanilla jars (default: .)
  -V, --version              output the version number
  -h, --help                 display help for command
```

```sh
npx minecraft-render minecraft-version.1.17.1.jar output-folder/


...
[0168 / 1710] observer rendered to output-folder\observer.png
[0169 / 1710] comparator_on_subtract skipped due to "no gui"
[0170 / 1710] template_trapdoor_open skipped due to "no gui"
...
```

Filtering and rendering options

```sh
npx minecraft-render minecraft-version.1.17.1.jar --filter "soul_campfire" --no-animation --width 100 --height 100 output/ --verbose


[1 / 1] soul_campfire rendered to output-folder\soul_campfire.png
```

### Using Rendering API

```ts
import { Minecraft } from 'minecraft-render';
import fs from 'fs';

async function main() {
  const minecraft = Minecraft.open('./minecraft-version.1.17.1.jar');
  const blocks = await minecraft.getBlockList();

  for await (const block of minecraft.render(blocks)) {
    if (!block.buffer) {
      console.log(`${block.blockName} skipped due to ${block.skip}`);
      continue;
    }

    await fs.promises.writeFile(
      `./render/${block.blockName}.png`,
      block.buffer,
    );
  }
}
```

### Mod support

[![Rendered image - from create mod](https://raw.githubusercontent.com/co3moz/minecraft-render/master/docs/experience_block.png)](https://raw.githubusercontent.com/co3moz/minecraft-render/master/docs/experience_block.png)

Mod jars work alongside vanilla jars. Assets are resolved by **namespace**
(`minecraft:`, `travelersbackpack:`, …) instead of assuming `minecraft`, and the
mod's namespace is auto-detected from the jar.

Mod models usually reference vanilla assets (`minecraft:block/…`), so a mod jar
alone is not enough — the matching vanilla jar is used as a fallback. Provide it
yourself, or let minecraft-render resolve and download it:

```sh
# manual: mod jar + vanilla jar (repeat --merge for more jars)
npx minecraft-render mymod.jar output/ --merge minecraft-1.21.jar

# automatic: read the required Minecraft version from the mod and download it
npx minecraft-render mymod.jar output/ --auto-vanilla --cache-dir ./cache
```

```ts
import { Minecraft, inspectJar } from 'minecraft-render';

// what is this jar, and what does it need?
console.log(await inspectJar('mymod.jar'));
// { loader: 'fabric', id: 'mymod', minecraft: '~1.21', loaderVersion: '>=0.15', ... }

// open with an explicit vanilla fallback...
const mc = Minecraft.open(['mymod.jar', 'minecraft-1.21.jar']);

// ...or resolve + download the required vanilla jar automatically
const mc2 = await Minecraft.forMod('mymod.jar', { cacheDir: './cache' });
```

Notes:

- Loaders detected: Fabric (`fabric.mod.json`), Forge/NeoForge (`mods.toml`), vanilla (`version.json`).
- `texture_size` (Blockbench / hi-res atlases) is honored.
- Models that use a custom loader (e.g. Fabric's `fabric:type`) can't be rendered — their geometry lives in the mod's code, so they are skipped.
- If a model references another mod's namespace that isn't loaded, the block is skipped with a message suggesting the jar to add (`--merge <namespace>.<version>.jar`).

### Parallel rendering

`render` is single-threaded; `renderParallel` renders across a pool of worker
processes and yields results as they complete. Rendering is CPU-bound, so this
scales across cores.

```ts
const mc = Minecraft.open('minecraft.jar');
const names = await mc.getBlockNameList();

for await (const { blockName, buffer, skip } of mc.renderParallel(names, {
  width: 500,
  height: 500,
  concurrency: 8, // worker processes; defaults to (CPU cores − 1)
})) {
  if (buffer) await fs.promises.writeFile(`render/${blockName}.png`, buffer);
}
```

`renderParallel` always uses worker processes (even at `concurrency: 1`), and a
worker is **recycled** — its process is restarted — every `RECYCLE_EVERY` blocks.
`headless-gl` never returns its native memory to the OS, so process exit is the
only thing that reclaims it; recycling keeps memory and per-block time flat over
long runs.

| Parameter       | Where                                    | Default       | Purpose                                                    |
| --------------- | ---------------------------------------- | ------------- | ---------------------------------------------------------- |
| `concurrency`   | `renderParallel(names, { concurrency })` | CPU cores − 1 | number of worker processes                                 |
| `RECYCLE_EVERY` | environment variable                     | 50            | blocks a worker renders before it is retired and respawned |

### Tests

Current test configuration is capable of downloading jar files from mojang servers and execute render sequence. You can trigger tests with;

```sh
npm test
```

The test harness reads a few env vars: `WORKERS` (→ `concurrency`),
`RECYCLE_EVERY`, `WIDTH`, `HEIGHT`, `DISTANCE`, `ANIMATION`, `BLOCK_NAMES`
(comma-separated filter) and `RENDER_FOLDER`.
