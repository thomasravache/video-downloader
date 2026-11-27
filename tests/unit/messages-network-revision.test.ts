/**
 * Contrato usado (SPEC-0024:UT-12): src/core/messages.ts -> validateMessage(message, sender, extensionId)
 *   { type: 'network-revision', tabId } com `tabId` inteiro >= 0 da própria extensão é válida e sai sem campos extras;
 *   `tabId` ausente, negativo, não inteiro ou string -> { ok: false, error: 'INVALID_MESSAGE' }.
 */
import { describe, expect, it } from 'vitest';
import { validateMessage } from '../../src/core/messages';

const SELF = 'self-extension-id';
const own = { id: SELF };
const INVALID = { ok: false, error: 'INVALID_MESSAGE' };

describe('validateMessage: network-revision', () => {
  it('SPEC-0024:UT-12 { type: network-revision, tabId: 3 } é válida', () => {
    expect(validateMessage({ type: 'network-revision', tabId: 3 }, own, SELF)).toEqual({
      ok: true,
      message: { type: 'network-revision', tabId: 3 },
    });
    expect(validateMessage({ type: 'network-revision', tabId: 0, extra: 'x' }, own, SELF)).toEqual({
      ok: true,
      message: { type: 'network-revision', tabId: 0 },
    });
  });

  it('SPEC-0024:UT-12 (guarda: passa antes da mudança) tabId ausente, -1, 1.5 ou string dá INVALID_MESSAGE', () => {
    const invalid: unknown[] = [
      { type: 'network-revision' },
      { type: 'network-revision', tabId: -1 },
      { type: 'network-revision', tabId: 1.5 },
      { type: 'network-revision', tabId: '3' },
      { type: 'network-revision', tabId: Number.NaN },
    ];
    for (const message of invalid) {
      expect(validateMessage(message, own, SELF), JSON.stringify(message)).toEqual(INVALID);
    }
  });

  it('SPEC-0024:UT-12 (guarda: passa antes da mudança) network-revision de outra extensão dá INVALID_MESSAGE', () => {
    expect(validateMessage({ type: 'network-revision', tabId: 3 }, { id: 'other' }, SELF)).toEqual(
      INVALID,
    );
  });
});
