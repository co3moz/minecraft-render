import { Jar } from './jar.js';

export type JarLoader = 'fabric' | 'forge' | 'neoforge' | 'vanilla' | 'unknown';

export interface JarInfo {
  loader: JarLoader;
  /** Mod id (mods) or absent (vanilla). */
  id?: string;
  /** Human-readable name. */
  name?: string;
  /** Mod version (mods) or the Minecraft version (vanilla). */
  version?: string;
  /** Required Minecraft version/range (mods) or the exact version (vanilla). */
  minecraft?: string;
  /** Required loader version, e.g. fabricloader / forge. */
  loaderVersion?: string;
  /** Raw dependency map, when available. */
  dependencies?: Record<string, string>;
}

/**
 * Identifies what a jar is by looking for loader manifests: `fabric.mod.json`
 * (Fabric/Quilt), `META-INF/[neoforge.]mods.toml` (Forge/NeoForge), or a root
 * `version.json` (a vanilla client jar). Returns the loader plus, for mods, the
 * Minecraft version they depend on — enough to locate the matching vanilla jar.
 */
export async function inspectJar(source: string | Jar): Promise<JarInfo> {
  const jar = source instanceof Jar ? source : Jar.open(source);

  const fabric = await readJson(jar, 'fabric.mod.json');
  if (fabric) {
    const depends: Record<string, string> = fabric.depends ?? {};
    return {
      loader: 'fabric',
      id: fabric.id,
      name: fabric.name,
      version: fabric.version,
      minecraft: depends.minecraft,
      loaderVersion: depends.fabricloader,
      dependencies: depends,
    };
  }

  for (const path of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
    const toml = await readText(jar, path);
    if (toml) {
      const minecraft = matchToml(
        toml,
        /modId\s*=\s*"minecraft"[\s\S]*?versionRange\s*=\s*"([^"]*)"/,
      );
      return {
        loader: path.includes('neoforge') ? 'neoforge' : 'forge',
        id: matchToml(toml, /modId\s*=\s*"([^"]*)"/),
        name: matchToml(toml, /displayName\s*=\s*"([^"]*)"/),
        version: matchToml(toml, /version\s*=\s*"([^"]*)"/),
        minecraft,
      };
    }
  }

  const vanilla = await readJson(jar, 'version.json');
  if (vanilla?.id) {
    return { loader: 'vanilla', minecraft: vanilla.id, version: vanilla.id };
  }

  return { loader: 'unknown' };
}

async function readText(jar: Jar, path: string): Promise<string | null> {
  try {
    return (await jar.read(path)).toString();
  } catch {
    return null;
  }
}

async function readJson(jar: Jar, path: string): Promise<any | null> {
  const text = await readText(jar, path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function matchToml(toml: string, pattern: RegExp): string | undefined {
  return toml.match(pattern)?.[1];
}
