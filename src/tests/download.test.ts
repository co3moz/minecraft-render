import { Spec, skipTest } from "nole";
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

export class DownloadTest {
  private targetVersionUrl: string = '';
  private jarUrl: string = '';
  public jarPath: string = '';

  @Spec()
  async getManifest() {
    this.checkExistingJar();
    const response = await fetch(`https://launchermeta.mojang.com/mc/game/version_manifest.json`)
    const manifest = (await response.json()) as VersionManifest;
    this.targetVersionUrl = manifest.versions.find(version => version.type == 'release' || version.id == manifest.latest.release)!.url;
  }

  @Spec()
  async getVersionJarUrl() {
    this.checkExistingJar();
    const response = await fetch(this.targetVersionUrl)
    const version = (await response.json()) as Version;
    this.jarUrl = version.downloads.client.url;
  }

  @Spec(120000)
  async downloadJar() {
    this.checkExistingJar();
    const response = await fetch(this.jarUrl);

    this.jarPath = this.getPath();

    const stream = fs.createWriteStream(this.jarPath);

    await new Promise((resolve, reject) => {
      response.body!.pipe(stream)
      response.body!.on('error', reject);
      stream.on('close', resolve);
    });
  }

  checkExistingJar(): void | never {
    if (this.jarPath) skipTest('Jar already exists');
    const checkPath = this.getPath();
    if (fs.existsSync(checkPath)) {
      this.jarPath = checkPath;
      skipTest('Jar already exists');
    }
  }

  getPath() {
    return path.resolve('test-data/test.jar');
  }
}

interface VersionManifest {
  latest: { release: string, snapshot: string }
  versions: {
    id: string,
    type: 'release' | 'snapshot'
    url: string
    time: string
    releaseTime: string
  }[]
}

interface Version {
  arguments: any
  assetIndex: any
  assets: string
  downloads: {
    client: DownloadInfo
    client_mappings: DownloadInfo
    server: DownloadInfo
  }
  id: string
  javaVersion: any
  libraries: { downloads: any, name: string }[],
  logging: any
  mainClass: string
  minimumLauncherVersion: number
  releaseTime: string
  time: string
  type: 'release' | 'snapshot'
}

interface DownloadInfo {
  sha1: string
  size: number
  url: string
}
