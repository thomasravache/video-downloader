// SPEC-0006 — contrato (scaffold). Garante que o build public não contém providers sem 'public'.
export interface FlavorGuardOptions {
  distDir: string;
  /** Diretório(s) cujos subdiretórios contêm `provider.json` (ex.: src/providers e PROVIDERS_EXTRA_DIR). */
  providersDir: string | readonly string[];
}

/** Lança "FORBIDDEN_PROVIDER_IN_PUBLIC:<id>" ou "INVALID_PROVIDER_MANIFEST..." ; síncrono. */
export function checkFlavorGuard(_options: FlavorGuardOptions): void {
  throw new Error('NotImplemented');
}
