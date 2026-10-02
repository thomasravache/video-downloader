/**
 * Contrato usado (SPEC-0005:UT-04):
 *   src/core/messages.ts -> validateMessage(message, sender: { id? }, extensionId):
 *     { ok: true, message } | { ok: false, error: 'INVALID_MESSAGE' }
 */
import { describe, expect, it } from 'vitest';
import { validateMessage } from '../../src/core/messages';

const SELF = 'self-extension-id';
const own = { id: SELF };

describe('validateMessage', () => {
  it('SPEC-0005:UT-04 aceita detect, download e diagnostics da própria extensão', () => {
    expect(validateMessage({ type: 'detect', tabId: 3 }, own, SELF)).toEqual({
      ok: true,
      message: { type: 'detect', tabId: 3 },
    });
    expect(validateMessage({ type: 'download', candidateId: 'abc' }, own, SELF)).toEqual({
      ok: true,
      message: { type: 'download', candidateId: 'abc' },
    });
    expect(validateMessage({ type: 'diagnostics' }, own, SELF)).toEqual({
      ok: true,
      message: { type: 'diagnostics' },
    });
  });

  it('SPEC-0005:UT-04 rejeita payloads fora do schema com INVALID_MESSAGE', () => {
    const invalid: unknown[] = [
      null,
      undefined,
      'detect',
      42,
      [],
      {},
      { type: 'unknown' },
      { type: 'detect' },
      { type: 'detect', tabId: '3' },
      { type: 'detect', tabId: Number.NaN },
      { type: 'download' },
      { type: 'download', candidateId: 42 },
      { type: 'download', candidateId: '' },
    ];
    for (const message of invalid) {
      expect(validateMessage(message, own, SELF), JSON.stringify(message)).toEqual({
        ok: false,
        error: 'INVALID_MESSAGE',
      });
    }
  });

  it('SPEC-0005:UT-04 rejeita mensagem válida de outro sender.id ou sem sender.id', () => {
    const message = { type: 'detect', tabId: 3 };

    expect(validateMessage(message, { id: 'other-extension' }, SELF)).toEqual({
      ok: false,
      error: 'INVALID_MESSAGE',
    });
    expect(validateMessage(message, {}, SELF)).toEqual({ ok: false, error: 'INVALID_MESSAGE' });
  });
});
