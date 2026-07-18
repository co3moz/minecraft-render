import * as fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';

const MANIFEST_URL =
  'https://launchermeta.mojang.com/mc/game/version_manifest.json';

export interface VersionRef {
  id: string;
  url: string;
}

/**
 * Resolves a Minecraft version requirement (an exact id like `1.21.1`, or a
 * range like `~1.21` / `>=1.20` / `[1.20,)`) to a concrete published version
 * from Mojang's manifest. Best-effort: prefers an exact id, then the newest
 * release sharing the requirement's base version. Returns null if nothing fits.
 */
export async function resolveMinecraftVersion(
  requirement: string,
): Promise<VersionRef | null> {
  const manifest = await fetchJson(MANIFEST_URL);
  const versions: Array<{ id: string; type: string; url: string }> =
    manifest.versions ?? [];

  const base = requirement.match(/\d+(?:\.\d+)*/)?.[0] ?? requirement;
  const matches = (id: string) => id === base || id.startsWith(`${base}.`);

  const exact = versions.find((v) => v.id === base);
  const release = versions.find((v) => v.type === 'release' && matches(v.id));
  const any = versions.find((v) => matches(v.id));
  const chosen = exact ?? release ?? any;

  return chosen ? { id: chosen.id, url: chosen.url } : null;
}

/** Downloads the client jar for a resolved version to `destPath`. */
export async function downloadMinecraftJar(
  version: VersionRef,
  destPath: string,
): Promise<void> {
  const meta = await fetchJson(version.url);
  const clientUrl: string | undefined = meta?.downloads?.client?.url;
  if (!clientUrl) {
    throw new Error(`No client download for Minecraft ${version.id}`);
  }

  const response = await fetch(clientUrl);
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download Minecraft ${version.id}: ${response.status}`,
    );
  }

  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    fs.createWriteStream(destPath),
  );
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return response.json();
}
