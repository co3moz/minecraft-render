#!/usr/bin/env node

const program = require('commander');
const path = require('path');
const fs = require('fs');
const pkg = require('../package.json');
const mkdirp = require('mkdirp');
const { Minecraft, Logger } = require('../dist');

program
  .usage('<jar> [output]')
  .option('-w, --width [width]', 'output image width', 1000)
  .option('-t, --height [height]', 'output image height', 1000)
  .option('-d, --distance [distance]', 'distance between camera and block', 20)
  .option('-v, --verbose', 'increases logging level', (v, p) => typeof v != 'undefined' ? v : (p + 1), Logger.categories.info)
  .option('-p, --plane', 'debugging plane and axis', 0)
  .option('-A, --no-animation', 'disables apng generation')
  .option('-f, --filter <regex>', 'regex pattern to filter blocks by name')
  .version(pkg.version)
  .parse(process.argv);

const options = program.opts();

if (!program.args.length) {
  return program.help();
}

async function Main() {
  Logger.level = options.verbose;

  const minecraft = Minecraft.open(path.resolve(program.args[0]));
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
    animation: options.animation
  };

  for await (const block of minecraft.render(blocks, rendererOptions)) {
    const j = (++i).toString().padStart(padSize, '0');

    if (!block.buffer) {
      console.log(`[${j} / ${totalBlocks}] ${block.blockName} skipped due to "${block.skip}"`);
      continue;
    }

    const filePath = path.join(folder, block.blockName + '.png');
    await fs.promises.writeFile(filePath, block.buffer);

    console.log(`[${j} / ${totalBlocks}] ${block.blockName} rendered to ${filePath}`);
  }

  console.log(`Rendering completed! "${folder}"`);
}

function filterByRegex(pattern, array) {
  if (!pattern) return array;

  const regex = new RegExp(pattern);

  return array.filter(block => regex.test(block.blockName));
}

Main().catch(e => console.error('Rendering failed!', e));