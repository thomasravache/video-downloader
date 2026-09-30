// SPEC-0006 — mascaramento de segredos na saída de release.

const MASK = '***';

/** Substitui cada ocorrência de cada segredo (e da forma URL-encoded) por `***`. Segredos vazios são ignorados. */
export function redact(text: string, secrets: readonly string[]): string {
  const needles = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    needles.add(secret);
    needles.add(encodeURIComponent(secret));
  }
  // Mais longos primeiro: um segredo contido em outro não deve deixar sobras.
  return [...needles]
    .sort((a, b) => b.length - a.length)
    .reduce((out, needle) => out.split(needle).join(MASK), text);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack ?? '';
    const head = stack.includes(error.message)
      ? stack
      : `${error.name}: ${error.message}\n${stack}`;
    return error.cause === undefined ? head : `${head}\nCaused by: ${describe(error.cause)}`;
  }
  if (typeof error === 'string') return error;
  if (error === undefined) return 'undefined';
  try {
    return JSON.stringify(error);
  } catch {
    return 'unserializable error';
  }
}

/** Formata qualquer valor lançado (Error com stack/cause, string, objeto) como texto já redigido. */
export function formatError(error: unknown, secrets: readonly string[]): string {
  return redact(describe(error), secrets);
}
