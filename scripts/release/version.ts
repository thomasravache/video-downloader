// SPEC-0006 — verificação de versão da tag (job `verify-version`). Erasable syntax only (Node 24 type stripping).
export interface VersionInfo {
  /** Versão SemVer sem o prefixo "v". */
  version: string;
  /** true para `X.Y.Z-rc.N`. */
  prerelease: boolean;
}

const TAG = /^v(\d+\.\d+\.\d+(?:-rc\.\d+)?)$/;
const RC = /-rc\.\d+$/;

/** true se a tag/versão termina em `-rc.N`. */
export function isPrerelease(tagOrVersion: string): boolean {
  return RC.test(tagOrVersion);
}

/** Extrai a versão de uma tag `vX.Y.Z[-rc.N]`; formato inválido lança "VERSION_MISMATCH". */
export function versionFromTag(tag: string): string {
  const match = TAG.exec(tag);
  if (!match?.[1]) {
    throw new Error(`VERSION_MISMATCH: tag "${tag}" não tem o formato vX.Y.Z ou vX.Y.Z-rc.N`);
  }
  return match[1];
}

/** Tag `vX.Y.Z[-rc.N]` deve ser igual a `v${pkgVersion}`; senão lança Error com "VERSION_MISMATCH". */
export function verifyVersion(tag: string, pkgVersion: string): VersionInfo {
  const version = versionFromTag(tag);
  if (version !== pkgVersion) {
    throw new Error(
      `VERSION_MISMATCH: a tag "${tag}" não bate com a versão do package.json ("${pkgVersion}")`,
    );
  }
  return { version, prerelease: isPrerelease(version) };
}
