import { Test } from 'nole';
import { Jar } from '../utils/jar.js';
import { DownloadTest } from './download.test.js';

export class JarTest extends Test({
  dependencies: {
    downloadTest: () => DownloadTest,
  },
}) {
  jar!: Jar;

  async init() {
    this.jar = Jar.open(this.downloadTest.jarPath);
  }

  async entries() {
    await this.jar.entries('assets');
  }

  async cleanUp() {
    await this.jar.close();
  }
}
