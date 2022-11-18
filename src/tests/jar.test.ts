import { Dependency, Hook, HookType, Spec } from 'nole';
import { Jar } from '../utils/jar.js';
import { DownloadTest } from './download.test.js';

export class JarTest {
  @Dependency(DownloadTest)
  downloadTest!: DownloadTest;

  jar!: Jar;

  @Spec()
  async init() {
    this.jar = Jar.open(this.downloadTest.jarPath);
  }

  @Spec()
  async entries() {
    await this.jar.entries('assets');
  }

  @Hook(HookType.CleanUp)
  async cleanUp() {
    await this.jar.close();
  }
}