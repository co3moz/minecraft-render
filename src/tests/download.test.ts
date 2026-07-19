import { Test, skipTest } from 'nole';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DownloadTest extends Test({ timeout: 120000 }) {
  private targetVersionUrl: string = '';
  private jarUrl: string = '';
  public jarPath: string = '';
  public versionId: string = '';

  async getManifest() {
    checkExistingJar(this);
    const response = await fetch(
      `https://launchermeta.mojang.com/mc/game/version_manifest.json`,
    );
    const manifest = (await response.json()) as VersionManifest;
    const targetVersion = manifest.versions.find(
      (version) =>
        version.type == 'release' || version.id == manifest.latest.release,
    )!;
    this.targetVersionUrl = targetVersion.url;
    this.versionId = targetVersion.id;
  }

  async getVersionJarUrl() {
    checkExistingJar(this);
    const response = await fetch(this.targetVersionUrl);
    const version = (await response.json()) as Version;
    this.jarUrl = version.downloads.client.url;
    // Prefer the id reported by the version metadata itself.
    this.versionId = version.id;
  }

  async downloadJar() {
    checkExistingJar(this);
    const response = await fetch(this.jarUrl);

    this.jarPath = getPath(this.versionId);

    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      fs.createWriteStream(this.jarPath),
    );
  }
}

function checkExistingJar(instance: DownloadTest): void | never {
  if (instance.jarPath) skipTest('Jar already exists');
  // The jar is named after its version, which we do not know up front, so look
  // for any previously downloaded minecraft-<version>.jar and reuse it. This
  // keeps the offline fast-path: no network round-trip when a jar is present.
  const existing = findExistingJar();
  if (existing) {
    instance.jarPath = existing.path;
    instance.versionId = existing.versionId;
    skipTest('Jar already exists');
  }
}

function findExistingJar(): { path: string; versionId: string } | null {
  const dir = path.resolve(__dirname, '../../test-data');
  if (!fs.existsSync(dir)) return null;
  const match = fs
    .readdirSync(dir)
    .find((file) => /^minecraft-.+\.jar$/.test(file));
  if (!match) return null;
  return {
    path: path.join(dir, match),
    versionId: match.replace(/^minecraft-/, '').replace(/\.jar$/, ''),
  };
}

function getPath(versionId: string) {
  return path.resolve(__dirname, `../../test-data/minecraft-${versionId}.jar`);
}

interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: {
    id: string;
    type: 'release' | 'snapshot';
    url: string;
    time: string;
    releaseTime: string;
  }[];
}

interface Version {
  arguments: any;
  assetIndex: any;
  assets: string;
  downloads: {
    client: DownloadInfo;
    client_mappings: DownloadInfo;
    server: DownloadInfo;
  };
  id: string;
  javaVersion: any;
  libraries: { downloads: any; name: string }[];
  logging: any;
  mainClass: string;
  minimumLauncherVersion: number;
  releaseTime: string;
  time: string;
  type: 'release' | 'snapshot';
}

interface DownloadInfo {
  sha1: string;
  size: number;
  url: string;
}
