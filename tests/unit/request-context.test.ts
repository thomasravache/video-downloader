/**
 * Contrato usado (SPEC-0016 §6), funções PURAS de src/core/request-context:
 *  - contextFor(candidate) -> { origin, referer: origin + '/' } | undefined   (UT-02)
 *  - buildContextRule({ id, hosts, origin, extensionId }) ->
 *      { ok: true, rule } | { ok: false, error }                              (UT-03)
 *    rule = { id, priority: 1,
 *             action: { type: 'modifyHeaders', requestHeaders: [
 *               { header: 'origin',  operation: 'set', value: origin },
 *               { header: 'referer', operation: 'set', value: origin + '/' } ] },
 *             condition: { requestDomains: <hosts únicos, minúsculos>, initiatorDomains: [extensionId],
 *                          resourceTypes: ['xmlhttprequest'] } }
 *    Recusa: lista vazia, host vazio/não-nome (esquema, caminho, query, porta, espaço), mais de 8 hosts,
 *    origem que não seja EXATAMENTE esquema+host[+porta] http(s), ou a origem da própria extensão.
 */
import { describe, expect, it } from 'vitest';
import type { VideoCandidate } from '../../src/core/contracts';
import { buildContextRule, contextFor } from '../../src/core/request-context';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = 'https://player.exemplo.test';

function candidate(over: Partial<VideoCandidate> = {}): VideoCandidate {
  return {
    id: 'a1',
    providerId: 'network',
    tabId: 1,
    pageUrl: '',
    mediaUrl: 'https://cdn.exemplo.test/hls/master.m3u8',
    protection: 'none',
    support: 'unsupported-stream',
    frameId: 3,
    frameUrl: '',
    kind: 'hls',
    source: 'network',
    ...over,
  };
}

describe('contextFor', () => {
  it('SPEC-0016:UT-02 candidato com initiatorOrigin devolve { origin, referer: origin + "/" }', () => {
    expect(contextFor(candidate({ initiatorOrigin: ORIGIN }))).toEqual({
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    });
  });

  it('SPEC-0016:UT-02 origem com porta mantém a porta no Origin e no Referer', () => {
    expect(contextFor(candidate({ initiatorOrigin: 'http://localhost:8080' }))).toEqual({
      origin: 'http://localhost:8080',
      referer: 'http://localhost:8080/',
    });
  });

  it('SPEC-0016:UT-02 candidato sem initiatorOrigin devolve undefined', () => {
    expect(contextFor(candidate())).toBeUndefined();
  });
});

describe('buildContextRule', () => {
  const ok = { id: 7_000_001, hosts: ['cdn.exemplo.test'], origin: ORIGIN, extensionId: EXT };

  it('SPEC-0016:UT-03 hosts e origem válidos produzem exatamente a regra do contrato', () => {
    expect(buildContextRule(ok)).toEqual({
      ok: true,
      rule: {
        id: 7_000_001,
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
      },
    });
  });

  it('SPEC-0016:UT-03 hosts em maiúsculas e repetidos viram únicos e minúsculos (ordem da primeira aparição)', () => {
    const result = buildContextRule({
      ...ok,
      hosts: ['CDN.exemplo.test', 'cdn.exemplo.test', 'Vod.Exemplo.test', '127.0.0.1'],
    });

    expect(result.ok && result.rule.condition.requestDomains).toEqual([
      'cdn.exemplo.test',
      'vod.exemplo.test',
      '127.0.0.1',
    ]);
  });

  it('SPEC-0016:UT-03 a regra só altera origin e referer (nenhum outro cabeçalho, nenhum cookie)', () => {
    const result = buildContextRule(ok);

    expect(
      result.ok && result.rule.action.requestHeaders.map((h) => `${h.header}:${h.operation}`),
    ).toEqual(['origin:set', 'referer:set']);
  });

  it('SPEC-0016:UT-03 até 8 hosts distintos são aceitos', () => {
    const hosts = Array.from({ length: 8 }, (_, i) => `h${String(i)}.exemplo.test`);

    expect(buildContextRule({ ...ok, hosts }).ok).toBe(true);
  });

  it('SPEC-0016:UT-03 mais de 8 hosts distintos são recusados (repetidos não contam)', () => {
    const hosts = Array.from({ length: 9 }, (_, i) => `h${String(i)}.exemplo.test`);

    expect(buildContextRule({ ...ok, hosts }).ok).toBe(false);
    expect(
      buildContextRule({ ...ok, hosts: [...hosts.slice(0, 8), ...hosts.slice(0, 8)] }).ok,
    ).toBe(true);
  });

  it('SPEC-0016:UT-03 lista vazia e host vazio, com esquema, caminho, query, porta ou espaço são recusados', () => {
    const invalid = [
      '',
      ' ',
      'https://cdn.exemplo.test',
      'chrome-extension://abc',
      'ftp://cdn.exemplo.test',
      'cdn.exemplo.test/hls',
      'cdn.exemplo.test?token=x',
      'cdn.exemplo.test:8080',
      'cdn exemplo.test',
      '*.exemplo.test',
      'cdn.exemplo.test#a',
    ];

    expect(buildContextRule({ ...ok, hosts: [] }).ok, 'lista vazia').toBe(false);
    for (const host of invalid) {
      expect(
        buildContextRule({ ...ok, hosts: ['cdn.exemplo.test', host] }).ok,
        JSON.stringify(host),
      ).toBe(false);
    }
  });

  it('SPEC-0016:UT-03 origem da própria extensão é recusada', () => {
    for (const origin of [
      `chrome-extension://${EXT}`,
      'chrome-extension://outra',
      `moz-extension://${EXT}`,
    ]) {
      expect(buildContextRule({ ...ok, origin }).ok, origin).toBe(false);
    }
  });

  it('SPEC-0016:UT-03 origem que não é exatamente http(s)://host[:porta] é recusada', () => {
    for (const origin of [
      '',
      'null',
      'player.exemplo.test',
      `${ORIGIN}/`,
      `${ORIGIN}/caminho`,
      `${ORIGIN}?q=1`,
      `${ORIGIN}#f`,
      'ftp://player.exemplo.test',
      'file:///tmp',
      'https://u:p@player.exemplo.test',
      'https://player.exemplo.test\r\nX-Evil: 1',
    ]) {
      expect(buildContextRule({ ...ok, origin }).ok, JSON.stringify(origin)).toBe(false);
    }
  });

  it('SPEC-0016:UT-03 origens http e https, com e sem porta, são aceitas e o referer ganha "/"', () => {
    for (const origin of [
      'http://127.0.0.1:8123',
      'https://player.exemplo.test:8443',
      'http://localhost',
    ]) {
      const result = buildContextRule({ ...ok, origin });

      expect(result.ok && result.rule.action.requestHeaders[1]?.value, origin).toBe(`${origin}/`);
    }
  });
});
