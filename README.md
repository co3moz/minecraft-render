[![Rendered image](https://raw.githubusercontent.com/co3moz/minecraft-render/master/docs/soul_campfire_small.png)](https://github.com/co3moz/minecraft-render/blob/master/docs/soul_campfire.png)

minecraft-render
=======================


Renders minecraft block models from .jar file using `THREE.js`. 
Default output format is PNG `1000x1000`.


### Pre-rendered assets

You can find pre-rendered assets on Github Actions artifacts. By clicking the badge down below, you can access action list.

[![Render Test](https://github.com/co3moz/minecraft-render/actions/workflows/ci.yml/badge.svg)](https://github.com/co3moz/minecraft-render/actions/workflows/ci.yml)



### Binaries

Basic usage;

```sh
npx minecraft-render


Usage: minecraft-render <jar> [output]

Options:
  -w, --width [width]        output image width (default: 1000)
  -t, --height [height]      output image height (default: 1000)
  -d, --distance [distance]  distance between camera and block (default: 20)
  -v, --verbose              increases logging level (default: 3)
  -p, --plane                debugging plane and axis (default: 0)
  -A, --no-animation         disables apng generation
  -f, --filter <regex>       regex pattern to filter blocks by name
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

    await fs.promises.writeFile(`./render/${block.blockName}.png`, block.buffer);
  }
}
```


### Tests

Current test configuration is capable of downloading jar files from mojang servers and execute render sequence. You can trigger tests with;

```sh
npm test
```

### Headless render and CI

If you are automating generation process on github or similar CI environments, make sure you configured display server. `xvfb` can be used for this purpose.

```sh
sudo apt-get install xvfb
xvfb-run --auto-servernum minecraft-render ...
```
