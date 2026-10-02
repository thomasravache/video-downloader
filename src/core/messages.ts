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
  const { type, tabId, candidateId, variantIndex, jobId } = message as {
    type?: unknown;
    tabId?: unknown;
    candidateId?: unknown;
    variantIndex?: unknown;
    jobId?: unknown;
  };
  switch (type) {
    case 'detect':
      return typeof tabId === 'number' && Number.isInteger(tabId)
        ? { ok: true, message: { type, tabId } }
        : INVALID;
    case 'download': {
      if (typeof candidateId !== 'string' || candidateId === '') {
        return INVALID;
      }
      if (!('variantIndex' in message) || variantIndex === undefined) {
        return { ok: true, message: { type, candidateId } };
      }
      return typeof variantIndex === 'number' && Number.isInteger(variantIndex) && variantIndex >= 0
        ? { ok: true, message: { type, candidateId, variantIndex } }
        : INVALID;
    }
    case 'job':
    case 'cancel':
      return typeof jobId === 'string' && jobId !== ''
        ? { ok: true, message: { type, jobId } }
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
