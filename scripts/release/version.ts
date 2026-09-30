// SPEC-0006 — contrato (scaffold; a lógica vem no GREEN). Erasable syntax only (Node 24 type stripping).
export interface VersionInfo {
  /** Versão SemVer sem o prefixo "v". */
  version: string;
  /** true para `X.Y.Z-rc.N`. */
  prerelease: boolean;
}

/** Tag `vX.Y.Z[-rc.N]` deve ser igual a `v${pkgVersion}`; senão lança Error com "VERSION_MISMATCH". */
export function verifyVersion(_tag: string, _pkgVersion: string): VersionInfo {
  throw new Error('NotImplemented');
}

/** true se a tag/versão termina em `-rc.N`. */
export function isPrerelease(_tagOrVersion: string): boolean {
  throw new Error('NotImplemented');
}
