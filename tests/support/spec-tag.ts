/** Compõe a tag de rastreabilidade usada nos nomes de teste: `SPEC-0005:UT-01`. */
export function specTag(specId: string, testId: string): string {
  return `${specId}:${testId}`;
}
