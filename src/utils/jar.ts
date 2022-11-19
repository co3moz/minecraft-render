import pkg, { ZipEntry } from 'node-stream-zip';

const { async } = pkg

export class Jar {
  protected zip: InstanceType<typeof async>;

  protected constructor(public file: string) {
    this.zip = new async({ file });
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
      .map(([_, value]) => value);
  }

  read(path: string | ZipEntry) {
    return this.zip.entryData(typeof path === "string" ? path : path.name);
  }

  async readJson(path: string | ZipEntry) {
    return JSON.parse((await this.read(path)).toString());
  }
}