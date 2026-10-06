/**
 * Contrato usado (SPEC-0016:UT-06): entrypoints/popup/errors ->
 *   hlsErrorText(response, text): string — texto do erro de `resolveHls` no cartão HLS:
 *     { ok: false, error: 'HLS_FETCH_FAILED', status: 401|403 } -> text.hlsErrorExpired
 *     HLS_FETCH_FAILED com outro status ou sem status        -> text.hlsErrorFetch
 *     HLS_PARSE_FAILED -> text.hlsErrorParse; demais/indefinido -> text.hlsErrorGeneric
 *   `public/_locales/{pt_BR,en}/messages.json` têm a chave `hlsErrorExpired` (pt_BR com o texto do contrato §6).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResolveHlsResponse } from '../../src/core/contracts';
import { hlsErrorText } from '../../entrypoints/popup/errors';

const text = {
  hlsErrorFetch: 'FETCH',
  hlsErrorParse: 'PARSE',
  hlsErrorGeneric: 'GENERIC',
  hlsErrorExpired: 'EXPIRED',
};
const fetchFailed = (status?: number): ResolveHlsResponse => ({
  ok: false,
  error: 'HLS_FETCH_FAILED',
  ...(status !== undefined && { status }),
});

describe('texto do erro de resolve HLS', () => {
  it('SPEC-0016:UT-06 HLS_FETCH_FAILED com status 403 usa hlsErrorExpired', () => {
    expect(hlsErrorText(fetchFailed(403), text)).toBe('EXPIRED');
  });

  it('SPEC-0016:UT-06 HLS_FETCH_FAILED com status 401 usa hlsErrorExpired', () => {
    expect(hlsErrorText(fetchFailed(401), text)).toBe('EXPIRED');
  });

  it('SPEC-0016:UT-06 HLS_FETCH_FAILED com 404, 500 ou sem status mantém o texto atual (hlsErrorFetch)', () => {
    expect(hlsErrorText(fetchFailed(404), text)).toBe('FETCH');
    expect(hlsErrorText(fetchFailed(500), text)).toBe('FETCH');
    expect(hlsErrorText(fetchFailed(), text)).toBe('FETCH');
  });

  it('SPEC-0016:UT-06 status 401/403 só vale para HLS_FETCH_FAILED: parse e demais erros mantêm o texto atual', () => {
    expect(hlsErrorText({ ok: false, error: 'HLS_PARSE_FAILED', status: 403 }, text)).toBe('PARSE');
    expect(hlsErrorText({ ok: false, error: 'CANDIDATE_NOT_FOUND' }, text)).toBe('GENERIC');
    expect(hlsErrorText(undefined, text)).toBe('GENERIC');
  });

  it('SPEC-0016:UT-06 ambos os locales têm a chave hlsErrorExpired, com texto próprio e não vazio', () => {
    const messages = (locale: string) =>
      JSON.parse(
        readFileSync(
          join(import.meta.dirname, `../../public/_locales/${locale}/messages.json`),
          'utf8',
        ),
      ) as Record<string, { message: string }>;

    for (const locale of ['pt_BR', 'en']) {
      const all = messages(locale);
      const expired = all['hlsErrorExpired']?.message ?? '';
      expect(expired.trim(), locale).not.toBe('');
      expect(expired, locale).not.toBe(all['hlsErrorFetch']?.message);
      expect(expired, locale).not.toBe(all['hlsErrorGeneric']?.message);
    }
  });

  it('SPEC-0016:UT-06 o texto pt_BR é o do contrato (servidor recusou, link pode ter expirado, reabra a aula)', () => {
    const all = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../public/_locales/pt_BR/messages.json'), 'utf8'),
    ) as Record<string, { message: string }>;

    expect(all['hlsErrorExpired']?.message).toBe(
      'O servidor recusou o acesso ao vídeo (o link pode ter expirado). Reabra a aula e tente de novo.',
    );
  });
});
