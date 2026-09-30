/**
 * SPEC-0006:UT-03 — mascaramento de segredos no logger/formatador de erros de release.
 * Contrato: scripts/release/redact.ts — `redact(text, secrets)` e `formatError(error, secrets)`.
 */
import { describe, expect, it } from 'vitest';
import { formatError, redact } from '../../scripts/release/redact.ts';
import { CREDS } from './helpers';

const TOKEN = CREDS.refreshToken;

describe('SPEC-0006:UT-03 redact/formatError', () => {
  it('SPEC-0006:UT-03 erro com o refresh token na mensagem sai com ***', () => {
    const out = formatError(new Error(`invalid_grant for token ${TOKEN}, retry`), [TOKEN]);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('***');
    expect(out).toContain('invalid_grant');
  });

  it('SPEC-0006:UT-03 mascara todas as ocorrências e vários segredos', () => {
    const out = redact(`${TOKEN} ${CREDS.clientSecret} ${TOKEN}`, [TOKEN, CREDS.clientSecret]);
    expect(out).toBe('*** *** ***');
  });

  it('SPEC-0006:UT-03 mascara a forma URL-encoded do segredo', () => {
    const out = redact(`refresh_token=${encodeURIComponent(TOKEN)}&x=1`, [TOKEN]);
    expect(out).not.toContain(encodeURIComponent(TOKEN));
    expect(out).toBe('refresh_token=***&x=1');
  });

  it('SPEC-0006:UT-03 mascara no stack e na cause', () => {
    const err = new Error('outer', { cause: new Error(`inner ${TOKEN}`) });
    err.stack = `Error: outer\n    at upload (${TOKEN})`;
    const out = formatError(err, [TOKEN]);
    expect(out).not.toContain(TOKEN);
  });

  it('SPEC-0006:UT-03 aceita valores lançados que não são Error', () => {
    expect(formatError(`boom ${TOKEN}`, [TOKEN])).toBe('boom ***');
    expect(formatError({ detail: TOKEN }, [TOKEN])).not.toContain(TOKEN);
    expect(formatError(undefined, [TOKEN])).toEqual(expect.any(String));
  });

  it('SPEC-0006:UT-03 segredo vazio é ignorado e texto sem segredo fica intacto', () => {
    expect(redact('nada a esconder', [''])).toBe('nada a esconder');
    expect(redact('nada a esconder', [TOKEN])).toBe('nada a esconder');
  });
});
