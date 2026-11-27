/**
 * Contrato usado (SPEC-0024:UT-08, UT-09):
 *   src/core/network.ts -> attributeTabs(initiator: string | undefined, tabs: readonly { id; url? }[]): number[]
 *     abas cuja URL tem a mesma origem que o `initiator` http(s); vazio quando o initiator é ausente ou não http(s).
 *   src/core/service.ts -> Service.onNetworkResponse(response, openTabs?)
 *     resposta com `tabId = -1` e `initiator` http(s) entra na lista de cada aba de `openTabs` com a mesma origem;
 *     o diagnóstico conta `network.sw_attributed` (contador `network.sw_attributed` na entrada `counters`, ou
 *     evento `network.sw_attributed` só com números) e nunca guarda URL com query (ADR-0009).
 */
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/core/contracts';
import { attributeTabs } from '../../src/core/network';
import { HLS_TYPE, response, setupService } from './support/detect-service';

const META = new Set(['ts', 'level', 'event', 'correlationId']);

/** `network.sw_attributed` no diagnóstico: contagem no `counters.network` ou evento com só números. */
function swAttributed(entries: LogEntry[]): { count: number; numbersOnly: boolean } | undefined {
  const counters = entries.find((e) => e.event === 'counters');
  const network = counters?.['network'] as Record<string, unknown> | undefined;
  const counted = network?.['sw_attributed'];
  if (typeof counted === 'number') {
    return { count: counted, numbersOnly: true };
  }
  const logs = entries.filter((e) => e.event === 'network.sw_attributed');
  if (logs.length === 0) {
    return undefined;
  }
  const extra = logs.flatMap((e) => Object.entries(e).filter(([key]) => !META.has(key)));
  return {
    count: logs.length,
    numbersOnly: extra.length > 0 && extra.every(([, value]) => typeof value === 'number'),
  };
}

describe('attributeTabs (D8)', () => {
  const tabs = [
    { id: 12, url: 'https://site.x/aula' },
    { id: 13, url: 'https://outro.y/' },
    { id: 14, url: undefined },
  ];

  it('SPEC-0024:UT-08 initiator https://site.x atribui só à aba da mesma origem', () => {
    expect(attributeTabs('https://site.x', tabs)).toEqual([12]);
  });

  it('SPEC-0024:UT-08 duas abas da mesma origem recebem a resposta', () => {
    const both = [...tabs, { id: 15, url: 'https://site.x/outra-aula?id=2' }];

    expect([...attributeTabs('https://site.x', both)].sort((a, b) => a - b)).toEqual([12, 15]);
  });

  it('SPEC-0024:UT-08 initiator ausente, null ou chrome-extension:// não atribui a nenhuma aba', () => {
    const withExtensionTab = [...tabs, { id: 16, url: 'chrome-extension://abc/popup.html' }];

    expect(attributeTabs(undefined, withExtensionTab)).toEqual([]);
    expect(attributeTabs(null as unknown as undefined, withExtensionTab)).toEqual([]);
    expect(attributeTabs('chrome-extension://abc', withExtensionTab)).toEqual([]);
  });

  it('SPEC-0024:UT-08 (guarda: passa antes da mudança) resposta do service worker sem aba de mesma origem é descartada', async () => {
    const { service, network } = setupService();

    await service.onNetworkResponse(
      response({
        url: 'https://cdn.site.x/hls/master.m3u8',
        tabId: -1,
        frameId: -1,
        contentType: HLS_TYPE,
        contentLength: 700,
        initiator: 'https://site.x',
      }),
      [{ id: 13, url: 'https://outro.y/' }],
    );

    expect(await network.forTab(13)).toEqual([]);
    expect(await network.forTab(-1)).toEqual([]);
  });
});

describe('privacidade da atribuição do service worker (D8)', () => {
  it('SPEC-0024:UT-09 atribuição com URL com query: o diagnóstico tem network.sw_attributed só com a contagem e nenhuma entrada contém "?"', async () => {
    const { service, network, diagnostics } = setupService();

    await service.onNetworkResponse(
      response({
        url: 'https://cdn.site.x/hls/master.m3u8?token=segredo&id=9',
        tabId: -1,
        frameId: -1,
        contentType: HLS_TYPE,
        contentLength: 700,
        initiator: 'https://site.x',
      }),
      [{ id: 12, url: 'https://site.x/aula?id=7' }],
    );

    expect((await network.forTab(12)).map((c) => c.mediaUrl)).toEqual([
      'https://cdn.site.x/hls/master.m3u8?token=segredo&id=9',
    ]);
    const entries = diagnostics.snapshot();
    expect(swAttributed(entries), JSON.stringify(entries)).toEqual({
      count: 1,
      numbersOnly: true,
    });
    for (const entry of entries) {
      expect(JSON.stringify(entry)).not.toContain('?');
    }
    expect(JSON.stringify(entries)).not.toContain('segredo');
  });
});
