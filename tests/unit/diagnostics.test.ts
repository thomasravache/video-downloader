/**
 * Contrato usado (SPEC-0005:IT-05, ADR-0009): src/core/diagnostics.ts
 *   createDiagnostics({ capacity?, now?, newId? }) -> { newCorrelationId, log, count, snapshot }
 *   redactUrls(text): remove query string, fragmento e credenciais de URLs.
 */
import { describe, expect, it } from 'vitest';
import { createDiagnostics, redactUrls } from '../../src/core/diagnostics';

describe('diagnostics', () => {
  it('SPEC-0005:IT-05 redactUrls remove query, fragmento e credenciais', () => {
    expect(
      redactUrls('falhou https://u:p@cdn.test/a.mp4?token=abc#x e blob:https://s.test/id?k=1'),
    ).toBe('falhou https://cdn.test/a.mp4 e blob:https://s.test/id');
  });

  it('SPEC-0005:IT-05 toda entrada tem correlationId e as URLs dos campos saem sem query', () => {
    const diagnostics = createDiagnostics({ newId: () => 'id-1' });
    diagnostics.log('info', 'x', 'corr-1', {
      url: 'https://a.test/v.mp4?token=abc',
      nested: { urls: ['https://b.test/?s=1'] },
      error: new Error('boom https://c.test/?q=1'),
    });

    const [entry] = diagnostics.snapshot();
    expect(entry?.correlationId).toBe('corr-1');
    expect(JSON.stringify(entry)).not.toMatch(/token=|s=1|q=1/);
  });

  it('SPEC-0005:IT-05 o ring buffer descarta as entradas mais antigas', () => {
    const diagnostics = createDiagnostics({ capacity: 2 });
    for (const event of ['a', 'b', 'c']) {
      diagnostics.log('info', event, 'c');
    }

    expect(diagnostics.snapshot().map((e) => e.event)).toEqual(['b', 'c', 'counters']);
  });

  it('SPEC-0005:IT-05 contadores por provider aparecem na entrada final', () => {
    const diagnostics = createDiagnostics();
    diagnostics.count('generic', 'detections');
    diagnostics.count('generic', 'downloadsStarted');
    diagnostics.count('generic', 'downloadsStarted');

    const last = diagnostics.snapshot().at(-1);
    expect(last).toMatchObject({
      event: 'counters',
      providers: { generic: { detections: 1, downloadsStarted: 2, downloadsFailed: 0 } },
    });
    expect(last?.correlationId).toEqual(expect.any(String));
  });
});
