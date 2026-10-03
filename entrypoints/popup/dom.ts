/** Ajuste de DOM do popup (SPEC-0015). */

interface ParentLike<T> {
  childNodes: ArrayLike<T>;
  insertBefore(node: T, ref: T | null): unknown;
}

/**
 * Deixa os filhos de `parent` na ordem de `wanted`, MOVENDO só os nós fora da posição: um nó que já está no
 * lugar nunca é removido nem reinserido (o foco do teclado, um `<select>` aberto e o `open` de um
 * `<details>` sobrevivem a um reagrupamento). Filhos que sobram no fim não são tocados.
 */
export function syncChildren<T>(parent: ParentLike<T>, wanted: readonly T[]): void {
  wanted.forEach((node, at) => {
    if (parent.childNodes[at] !== node) {
      parent.insertBefore(node, parent.childNodes[at] ?? null);
    }
  });
}
