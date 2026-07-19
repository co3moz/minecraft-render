import { Test } from 'nole';
import { RenderTest } from './render.test.js';
import * as fs from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ModRenderTest } from './mod-render.test.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class GenerateHtmlTest extends Test({
  after: () => [RenderTest, ModRenderTest],
}) {
  async generateHtml() {
    // find .png files on test-data
    const outDir = path.resolve(__dirname, '../../test-data');
    const prefix = process.env.RENDER_FOLDER || '';
    const files = await fs.readdir(outDir);
    const pngFiles = files.filter((file) => file.endsWith('.png'));

    let html = `<html><head>
    <style>
    body {
      margin: 0;
      background:#383838;
    }
    img {
      width: 128px;
      height: 128px;
    }
    img:hover {
      background: #444;
    }
    .container {
      display: flex;
      flex-wrap: wrap;
    }
    a {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-decoration: none;
      color: #fff;
      font-family: monospace;
      font-size: 10px;
      text-overflow: ellipsis;
      overflow: hidden;
      white-space: nowrap;
      width: 128px;
      border: 1px solid #333;
      background: #111;
      padding: 4px;
    }
    a:hover {
      text-decoration: underline;
    }
    </style>
    </head><body>
      <div class="container">
      `;
    for (const file of pngFiles) {
      html += `
      <a href="${file}" target="_blank">
        <img src="${file}" title="${file}"/>
        <p title="${file}">${file.replace('.png', '')}</p>
      </a>
      `;
    }
    html += `</div></body></html>`;
    await fs.writeFile(path.resolve(outDir, 'index.html'), html);
  }
}
