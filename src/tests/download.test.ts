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

  async getManifest() {
    checkExistingJar(this);
    const response = await fetch(
      `https://launchermeta.mojang.com/mc/game/version_manifest.json`,
    );
    const manifest = (await response.json()) as VersionManifest;
    this.targetVersionUrl = manifest.versions.find(
      (version) =>
        version.type == 'release' || version.id == manifest.latest.release,
    )!.url;
  }

  async getVersionJarUrl() {
    checkExistingJar(this);
    const response = await fetch(this.targetVersionUrl);
    const version = (await response.json()) as Version;
    this.jarUrl = version.downloads.client.url;
  }

  async downloadJar() {
    checkExistingJar(this);
    const response = await fetch(this.jarUrl);

    this.jarPath = getPath();

    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      fs.createWriteStream(this.jarPath),
    );
  }
}

function checkExistingJar(instance: DownloadTest): void | never {
  if (instance.jarPath) skipTest('Jar already exists');
  const checkPath = getPath();
  if (fs.existsSync(checkPath)) {
    instance.jarPath = checkPath;
    skipTest('Jar already exists');
  }
}

function getPath() {
  return path.resolve(__dirname, '../../test-data/test.jar');
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
