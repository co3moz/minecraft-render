#!/usr/bin/env node

const program = require('commander');
const path = require('path');
const fs = require('fs');
const package = require('../package.json');
const { Minecraft } = require('../dist');
const { cwd } = require('process');

program
  .usage('<jar>')
  .version(package.version)
  .parse(process.argv);

if (!program.args.length) {
  return program.help();
}

async function Main(jarPath) {
  const minecraft = Minecraft.open(jarPath);
  const blocks = await minecraft.getBlockList();
  let i = 0;

  const folder = path.resolve(cwd(), path.basename(jarPath));

  if (!(await fileStat(folder))) {
    await makeFolder(folder);
  }

  const padSize = Math.ceil(Math.log10(blocks.length));
  const totalBlocks = blocks.length.toString().padStart(padSize, '0');

  for await (const block of minecraft.render(blocks)) {
    const j = (++i).toString().padStart(padSize, '0');

    if (!block.buffer) {
      console.log(`[${j} / ${totalBlocks}] ${block.blockName} skipped due to "${block.skip}"`);
      continue;
    }

    const filePath = path.resolve(`${folder}/${block.blockName}.png`);
    await writeFileAsync(filePath, block.buffer);

    console.log(`[${j} / ${totalBlocks}] ${block.blockName} rendered to ${filePath}`)
  }

  console.log(`Rendering completed! "${folder}"`);
}

function writeFileAsync(path, buffer) {
  return new Promise((resolve, reject) => {
    fs.writeFile(path, buffer, err => {
      if (err) reject(err);
      else resolve();
    })
  })
}

function fileStat(path) {
  return new Promise((resolve, reject) => {
    fs.stat(path, (err, stats) => {
      if (err) resolve(null);
      else resolve(stats);
    })
  })
}

function makeFolder(path) {
  return new Promise((resolve, reject) => {
    fs.mkdir(path, err => {
      if (err) reject(err);
      else resolve();
    })
  })
}

Main(path.resolve(cwd(), program.args[0])).catch(e => console.error('Rendering failed! ' + ((e && e.stack) || e)));
