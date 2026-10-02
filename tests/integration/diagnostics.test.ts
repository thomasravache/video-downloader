/**
 * Contrato usado (SPEC-0005:IT-05, ADR-0009): logger real em src/core/diagnostics, exposto pela
 * mensagem `{ type: 'diagnostics' }` -> `{ ok: true, entries: LogEntry[] }`; toda entrada tem
 * `correlationId` (string não vazia) e URLs são registradas sem query string.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, startBackground, video } from './support/background';
import type { BackgroundHarness } from './support/background';

const MEDIA = 'https://cdn.example.test/media/aula.mp4';
const MEDIA_WITH_QUERY = `${MEDIA}?token=abc`;
let bg: BackgroundHarness;

beforeEach(() => {
  bg = startBackground();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('diagnóstico local', () => {
  it('SPEC-0005:IT-05 após baixar URL com ?token=abc nenhuma entrada contém token= e todas têm correlationId', async () => {
    const { candidates } = await bg.detect(
      page([video({ src: MEDIA_WITH_QUERY, currentSrc: MEDIA_WITH_QUERY })], {
        pageUrl: 'https://site.example.test/aula?session=segredo&token=abc',
      }),
    );
    const response = await bg.send({ type: 'download', candidateId: candidates[0]?.id });
    expect(response).toMatchObject({ ok: true });
    // O download usa a URL original (com query); só o log é sanitizado.
    expect((bg.download.mock.calls[0]?.[0] as { url: string }).url).toBe(MEDIA_WITH_QUERY);

    const diagnostics = (await bg.send({ type: 'diagnostics' })) as {
      ok: boolean;
      entries: Record<string, unknown>[];
    };

    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.entries.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(diagnostics.entries);
    expect(serialized).not.toContain('token=');
    expect(serialized).not.toContain('session=');
    expect(serialized).toContain('cdn.example.test/media/aula.mp4');
    for (const entry of diagnostics.entries) {
      expect(entry['correlationId'], JSON.stringify(entry)).toEqual(expect.any(String));
      expect(entry['correlationId']).not.toBe('');
    }
  });
});
