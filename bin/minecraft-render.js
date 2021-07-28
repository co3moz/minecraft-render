#!/usr/bin/env node

const program = require('commander');
const path = require('path');
const fs = require('fs');
const package = require('../package.json');
const mkdirp = require('mkdirp');
const { Minecraft } = require('../dist');

program
  .usage('<jar> [output]')
  .option('-w, --width [width]', 'width', 1000)
  .option('-t, --height [height]', 'height', 1000)
  .version(package.version)
  .parse(process.argv);

const options = program.opts();

if (!program.args.length) {
  return program.help();
}

async function Main() {
  const minecraft = Minecraft.open(path.resolve(program.args[0]));
  const blocks = await minecraft.getBlockList();
  let i = 0;

  const folder = path.resolve(program.args[1] || 'output');

  await mkdirp(folder);

  const padSize = Math.ceil(Math.log10(blocks.length));
  const totalBlocks = blocks.length.toString().padStart(padSize, '0');

  for await (const block of minecraft.render(blocks, {
    height: parseInt(options.height) || 1000,
    width: parseInt(options.width) || 1000
  })) {
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

Main().catch(e => console.error('Rendering failed!', e));
