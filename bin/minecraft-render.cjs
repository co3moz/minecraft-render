#!/usr/bin/env node

const program = require('commander');
const path = require('path');
const fs = require('fs');
const package = require('../package.json');
const mkdirp = require('mkdirp');
const { Minecraft, Logger } = require('../dist');

program
  .usage('<jar> [output]')
  .option('-w, --width [width]', 'output image width', 1000)
  .option('-t, --height [height]', 'output image height', 1000)
  .option('-d, --distance [distance]', 'distance between camera and block', 20)
  .option(
    '-v, --verbose',
    'increases logging level',
    (v, p) => (typeof v != 'undefined' ? v : p + 1),
    Logger.categories.info,
  )
  .option('-p, --plane', 'debugging plane and axis', 0)
  .option('-A, --no-animation', 'disables apng generation')
  .option('-f, --filter <regex>', 'regex pattern to filter blocks by name')
  .option(
    '-m, --merge <jar>',
    'additional fallback jar (e.g. the vanilla client jar) for mod assets; repeatable',
    (value, previous) => previous.concat([value]),
    [],
  )
  .option(
    '--auto-vanilla',
    "detect the mod's required Minecraft version and download that vanilla jar if missing",
  )
  .option(
    '--cache-dir <dir>',
    'directory to cache downloaded vanilla jars',
    '.',
  )
  .version(package.version)
  .parse(process.argv);

const options = program.opts();

if (!program.args.length) {
  return program.help();
}

async function Main() {
  Logger.level = options.verbose;

  const primary = path.resolve(program.args[0]);
  const merge = options.merge.map((jar) => path.resolve(jar));

  let minecraft;
  if (options.autoVanilla) {
    minecraft = await Minecraft.forMod(primary, {
      cacheDir: path.resolve(options.cacheDir),
      minecraftJar: merge[0],
      onProgress: (message) => console.log(message),
    });
  } else {
    minecraft = Minecraft.open([primary, ...merge]);
  }

  const blocks = filterByRegex(options.filter, await minecraft.getBlockList());

  let i = 0;
  const folder = path.resolve(program.args[1] || 'output');

  await mkdirp(folder);

  const padSize = Math.ceil(Math.log10(blocks.length));
  const totalBlocks = blocks.length.toString().padStart(padSize, '0');

  const rendererOptions = {
    height: parseInt(options.height),
    width: parseInt(options.width),
    distance: parseInt(options.distance),
    plane: options.plane,
    animation: options.animation,
  };

  const missingJars = new Map();

  for await (const block of minecraft.render(blocks, rendererOptions)) {
    const j = (++i).toString().padStart(padSize, '0');

    if (!block.buffer) {
      const match = /Namespace "([^"]+)" is not loaded.*--merge ([^\s`]+)/.exec(
        block.skip || '',
      );
      if (match) missingJars.set(match[1], match[2]);

      console.log(
        `[${j} / ${totalBlocks}] ${block.blockName} skipped due to "${block.skip}"`,
      );
      continue;
    }

    const filePath = path.join(folder, block.blockName + '.png');
    await fs.promises.writeFile(filePath, block.buffer);

    console.log(
      `[${j} / ${totalBlocks}] ${block.blockName} rendered to ${filePath}`,
    );
  }

  console.log(`Rendering completed! "${folder}"`);

  if (missingJars.size) {
    const suggestions = [...missingJars.values()];
    console.log(
      `\n⚠ ${missingJars.size} referenced jar(s) were not loaded: ${[
        ...missingJars.keys(),
      ].join(', ')}`,
    );
    console.log(
      `Add them and re-run:\n  minecraft-render ${program.args[0]} ${
        program.args[1] || 'output'
      } ${suggestions.map((s) => `--merge ${s}`).join(' ')}`,
    );
  }
}

function filterByRegex(pattern, array) {
  if (!pattern) return array;

  const regex = new RegExp(pattern);

  return array.filter((block) => regex.test(block.blockName));
}

Main().catch((e) => console.error('Rendering failed!', e));
