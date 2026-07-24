// Browser counterpart to `jar.ts`. Node reads the jar (a zip) off disk with
// `node-stream-zip`; here we unzip an in-memory byte buffer with `fflate`,
// exposing the same `entries`/`read`/`readJson` surface the renderer relies on.
// The package's `browser` field swaps this in for `jar.ts` at bundle time.
import { unzipSync, type Unzipped } from 'fflate';
import { Buffer } from 'buffer';

// Only these paths are ever read by the renderer/inspector, so we skip
// inflating the rest — a vanilla client jar is tens of MB and thousands of
// files otherwise.
function wanted(name: string): boolean {
  return (
    name.startsWith('assets/') ||
    name.startsWith('data/') ||
    name.startsWith('META-INF/') ||
    name === 'fabric.mod.json' ||
    name === 'quilt.mod.json' ||
    name === 'version.json' ||
    name === 'pack.mcmeta'
  );
}

export class Jar {
  private files: Unzipped;

  protected constructor(
    public file: string,
    data: Uint8Array,
  ) {
    this.files = unzipSync(data, { filter: (f) => wanted(f.name) });
  }

  /**
   * The Node signature takes a file path; in the browser there is no
   * filesystem, so use {@link fromBytes} / {@link fromBlob} instead.
   */
  static open(_file: string): Jar {
    throw new Error(
      'Jar.open(path) is not available in the browser. Use Jar.fromBytes() or Jar.fromBlob().',
    );
  }

  /** Builds a Jar from raw zip bytes (e.g. a dropped file's ArrayBuffer). */
  static fromBytes(name: string, data: Uint8Array | ArrayBuffer): Jar {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return new Jar(name, bytes);
  }

  /** Builds a Jar from a File/Blob (drag-and-drop or `<input type=file>`). */
  static async fromBlob(blob: Blob, name?: string): Promise<Jar> {
    const buffer = await blob.arrayBuffer();
    return Jar.fromBytes(name ?? (blob as File).name ?? 'jar', buffer);
  }

  async close(): Promise<void> {
    // Nothing to release for an in-memory archive.
  }

  async entries(path: string): Promise<{ name: string }[]> {
    return Object.keys(this.files)
      .filter((name) => name.startsWith(path))
      .map((name) => ({ name }));
  }

  async read(path: string | { name: string }): Promise<Buffer> {
    const key = typeof path === 'string' ? path : path.name;
    const data = this.files[key];
    if (!data) {
      throw new Error(`Entry not found in jar: ${key}`);
    }
    return Buffer.from(data);
  }

  async readJson(path: string | { name: string }): Promise<any> {
    return JSON.parse((await this.read(path)).toString());
  }
}
