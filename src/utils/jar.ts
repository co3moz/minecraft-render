import StreamZip from 'node-stream-zip';
import type { ZipEntry } from 'node-stream-zip';

export class Jar {
  protected zip: any;

  protected constructor(public file: string) {
    this.zip = new StreamZip.async({ file });
  }

  static open(file: string) {
    return new Jar(file);
  }

  async close() {
    await this.zip.close();
  }

  async entries(path: string): Promise<ZipEntry[]> {
    return Object.entries(await this.zip.entries())
      .filter(([key]) => key.startsWith(path))
      .map(([_, value]) => value as ZipEntry);
  }

  read(path: string | ZipEntry) {
    return this.zip.entryData(typeof path === 'string' ? path : path.name);
  }

  async readJson(path: string | ZipEntry) {
    return JSON.parse((await this.read(path)).toString());
  }
}
