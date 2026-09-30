// SPEC-0006 — contrato (scaffold). Mascaramento de segredos na saída de release.

/** Substitui cada ocorrência de cada segredo (e da forma URL-encoded) por `***`. Segredos vazios são ignorados. */
export function redact(_text: string, _secrets: readonly string[]): string {
  throw new Error('NotImplemented');
}

/** Formata qualquer valor lançado (Error com stack/cause, string, objeto) como texto já redigido. */
export function formatError(_error: unknown, _secrets: readonly string[]): string {
  throw new Error('NotImplemented');
}
