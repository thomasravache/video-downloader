import type { Message } from './contracts';

export type MessageValidation =
  { ok: true; message: Message } | { ok: false; error: 'INVALID_MESSAGE' };

const INVALID: MessageValidation = { ok: false, error: 'INVALID_MESSAGE' };

/** Aceita só mensagens do schema v1 vindas da própria extensão (`sender.id === extensionId`). */
export function validateMessage(
  message: unknown,
  sender: { id?: string },
  extensionId: string,
): MessageValidation {
  if (extensionId === '' || sender.id !== extensionId) {
    return INVALID;
  }
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return INVALID;
  }
  const { type, tabId, candidateId } = message as {
    type?: unknown;
    tabId?: unknown;
    candidateId?: unknown;
  };
  switch (type) {
    case 'detect':
      return typeof tabId === 'number' && Number.isInteger(tabId)
        ? { ok: true, message: { type, tabId } }
        : INVALID;
    case 'download':
      return typeof candidateId === 'string' && candidateId !== ''
        ? { ok: true, message: { type, candidateId } }
        : INVALID;
    case 'resolveHls':
      return typeof candidateId === 'string' && candidateId !== ''
        ? { ok: true, message: { type, candidateId } }
        : INVALID;
    case 'diagnostics':
      return { ok: true, message: { type } };
    default:
      return INVALID;
  }
}
