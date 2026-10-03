/**
 * Contrato usado (SPEC-0016:UT-05): entrypoints/background/request-context ->
 *   createRequestContextManager({ dnr, extensionId }) -> { acquire({hosts, origin}), removeOrphans() }
 *   - `dnr` é o recorte de `browser.declarativeNetRequest` (updateSessionRules / getSessionRules);
 *   - `acquire` instala UMA regra de sessão (a do contrato, via buildContextRule) com id na faixa reservada
 *     7_000_000+ e devolve um lease; `lease.release()` remove essa regra e é idempotente (a 2ª chamada não
 *     remove nada); ids de leases vivos nunca colidem (em paralelo também); no máximo 4 regras simultâneas:
 *     o 5º `acquire` rejeita e nada é instalado; liberar abre vaga;
 *   - `acquire` com hosts/origem inválidos rejeita sem instalar regra;
 *   - `removeOrphans` (partida do service worker) remove só as regras da faixa reservada.
 */
import { describe, expect, it } from 'vitest';
import { createRequestContextManager } from '../../entrypoints/background/request-context';
import { createDnrFake } from './support/dnr-fake';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = 'https://player.exemplo.test';
const RESERVED = 7_000_000;

function setup() {
  const dnr = createDnrFake();
  const manager = createRequestContextManager({ dnr, extensionId: EXT });
  const lease = (host = 'cdn.exemplo.test') => manager.acquire({ hosts: [host], origin: ORIGIN });
  return { dnr, manager, lease };
}

describe('gerenciador de regras de contexto', () => {
  it('SPEC-0016:UT-05 acquire instala uma regra de sessão do contrato com id na faixa reservada', async () => {
    const { dnr, lease } = setup();

    await lease();

    expect(dnr.rules()).toHaveLength(1);
    const [rule] = dnr.rules();
    expect(rule?.id).toBeGreaterThanOrEqual(RESERVED);
    expect(rule).toMatchObject({
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'origin', operation: 'set', value: ORIGIN },
          { header: 'referer', operation: 'set', value: `${ORIGIN}/` },
        ],
      },
      condition: {
        requestDomains: ['cdn.exemplo.test'],
        initiatorDomains: [EXT],
        resourceTypes: ['xmlhttprequest'],
      },
    });
  });

  it('SPEC-0016:UT-05 release remove a regra', async () => {
    const { dnr, lease } = setup();
    const held = await lease();

    await held.release();

    expect(dnr.rules()).toEqual([]);
  });

  it('SPEC-0016:UT-05 release duplicado é idempotente: a 2ª chamada não toca nas regras (nem na de outro lease)', async () => {
    const { dnr, lease } = setup();
    const first = await lease('a.exemplo.test');
    const second = await lease('b.exemplo.test');
    await first.release();
    const callsAfterFirst = dnr.calls.length;

    await first.release();

    expect(dnr.calls.length).toBe(callsAfterFirst);
    expect(
      dnr
        .rules()
        .map((r) => (r as { condition?: { requestDomains?: string[] } }).condition?.requestDomains),
    ).toEqual([['b.exemplo.test']]);
    await second.release();
    expect(dnr.rules()).toEqual([]);
  });

  it('SPEC-0016:UT-05 release concorrente do mesmo lease remove uma vez só', async () => {
    const { dnr, lease } = setup();
    const held = await lease();

    await Promise.all([held.release(), held.release(), held.release()]);

    expect(dnr.rules()).toEqual([]);
    expect(dnr.calls.filter((c) => c.removeRuleIds.length > 0)).toHaveLength(1);
  });

  it('SPEC-0016:UT-05 acquire em paralelo (4) não colide: ids distintos, todos na faixa reservada', async () => {
    const { dnr, lease } = setup();

    await Promise.all(['a', 'b', 'c', 'd'].map((x) => lease(`${x}.exemplo.test`)));

    const ids = dnr.ids();
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => id >= RESERVED)).toBe(true);
  });

  it('SPEC-0016:UT-05 limite de 4 regras simultâneas: o 5º acquire rejeita sem instalar; liberar abre vaga', async () => {
    const { dnr, lease } = setup();
    const held = await Promise.all(['a', 'b', 'c', 'd'].map((x) => lease(`${x}.exemplo.test`)));

    await expect(lease('e.exemplo.test')).rejects.toBeInstanceOf(Error);
    expect(dnr.rules()).toHaveLength(4);

    await held[0]?.release();
    await expect(lease('e.exemplo.test')).resolves.toBeDefined();
    expect(dnr.rules()).toHaveLength(4);
  });

  it('SPEC-0016:UT-05 ids são reutilizáveis sem colisão depois de release (sequência acquire/release/acquire)', async () => {
    const { dnr, lease } = setup();

    for (let i = 0; i < 10; i++) {
      const held = await lease(`h${String(i)}.exemplo.test`);
      expect(dnr.ids()).toHaveLength(1);
      await held.release();
    }

    expect(dnr.rules()).toEqual([]);
  });

  it('SPEC-0016:UT-05 hosts ou origem inválidos: acquire rejeita e nenhuma regra é instalada', async () => {
    const { dnr, manager } = setup();

    await expect(manager.acquire({ hosts: [], origin: ORIGIN })).rejects.toBeInstanceOf(Error);
    await expect(
      manager.acquire({ hosts: ['https://x.test/a'], origin: ORIGIN }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      manager.acquire({ hosts: ['x.test'], origin: `chrome-extension://${EXT}` }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      manager.acquire({ hosts: ['x.test'], origin: `${ORIGIN}/caminho` }),
    ).rejects.toBeInstanceOf(Error);

    expect(dnr.everAdded()).toEqual([]);
  });

  it('SPEC-0016:UT-05 removeOrphans remove só as regras da faixa reservada (as de outros usos ficam)', async () => {
    const { dnr, manager } = setup();
    dnr.seed([
      { id: 5 },
      { id: 6_999_999 },
      { id: 7_000_001 },
      { id: 7_000_042 },
      { id: 9_000_000 },
    ]);

    await manager.removeOrphans();

    expect(dnr.ids().sort((a, b) => a - b)).toEqual([5, 6_999_999]);
  });

  it('SPEC-0016:UT-05 removeOrphans sem órfãs não falha e não remove nada', async () => {
    const { dnr, manager } = setup();
    dnr.seed([{ id: 5 }]);

    await manager.removeOrphans();

    expect(dnr.ids()).toEqual([5]);
    expect(dnr.calls.flatMap((c) => c.removeRuleIds)).toEqual([]);
  });

  it('SPEC-0016:UT-05 depois de removeOrphans um novo acquire não colide com o que existia', async () => {
    const { dnr, manager, lease } = setup();
    dnr.seed([{ id: 7_000_001 }, { id: 7_000_002 }]);
    await manager.removeOrphans();

    await lease();

    expect(dnr.ids()).toHaveLength(1);
  });

  it('SPEC-0016:UT-05 acquire com uma regra órfã ainda ativa (sem removeOrphans) não colide com ela', async () => {
    const { dnr, lease } = setup();
    dnr.seed([{ id: 7_000_001 }, { id: 7_000_002 }]);

    await lease();

    expect(new Set(dnr.ids()).size).toBe(3);
  });
});
