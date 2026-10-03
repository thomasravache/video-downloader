/**
 * Contrato usado (SPEC-0015, revisão): entrypoints/popup/dom -> syncChildren(parent, wanted)
 * Deixa os filhos de `parent` na ordem de `wanted` MOVENDO só os nós que não estão na posição certa (um nó já no
 * lugar nunca é removido/reinserido: foco, <select> aberto e `<details open>` sobrevivem a um reagrupamento).
 */
import { describe, expect, it } from 'vitest';
import { syncChildren } from '../../entrypoints/popup/dom';

interface FakeNode {
  name: string;
}
function fakeParent(initial: FakeNode[]) {
  const childNodes = [...initial];
  const moves: string[] = [];
  return {
    childNodes,
    moves,
    insertBefore(node: FakeNode, ref: FakeNode | null): void {
      moves.push(node.name);
      const at = childNodes.indexOf(node);
      if (at >= 0) {
        childNodes.splice(at, 1);
      }
      childNodes.splice(ref === null ? childNodes.length : childNodes.indexOf(ref), 0, node);
    },
  };
}
const n = (name: string): FakeNode => ({ name });
const order = (p: { childNodes: FakeNode[] }): string[] => p.childNodes.map((c) => c.name);

describe('syncChildren', () => {
  it('SPEC-0015:UT-02 mesma ordem: nenhum nó é movido (identidade e foco preservados)', () => {
    const [a, b, c] = [n('a'), n('b'), n('c')] as [FakeNode, FakeNode, FakeNode];
    const parent = fakeParent([a, b, c]);

    syncChildren(parent, [a, b, c]);

    expect(parent.moves).toEqual([]);
    expect(parent.childNodes).toEqual([a, b, c]);
  });

  it('SPEC-0015:UT-02 nó novo e nó fora de ordem entram na posição certa; quem já estava no lugar não é movido', () => {
    const [a, b, c, d] = [n('a'), n('b'), n('c'), n('d')] as [
      FakeNode,
      FakeNode,
      FakeNode,
      FakeNode,
    ];
    const parent = fakeParent([a, b]);

    syncChildren(parent, [a, c, b, d]);

    expect(order(parent)).toEqual(['a', 'c', 'b', 'd']);
    expect(parent.moves).not.toContain('a');
  });

  it('SPEC-0015:UT-02 nó de outro pai é puxado para dentro; sobras no fim não são tocadas', () => {
    const [a, b, extra] = [n('a'), n('b'), n('extra')] as [FakeNode, FakeNode, FakeNode];
    const parent = fakeParent([a, extra]);

    syncChildren(parent, [a, b]);

    expect(order(parent)).toEqual(['a', 'b', 'extra']);
    expect(parent.moves).toEqual(['b']);
  });
});
