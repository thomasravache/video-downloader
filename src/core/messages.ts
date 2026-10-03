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
  const { type, tabId, candidateId, variantIndex, audioIndex, jobId } = message as {
    type?: unknown;
    tabId?: unknown;
    candidateId?: unknown;
    variantIndex?: unknown;
    audioIndex?: unknown;
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
      const isIndex = (value: unknown): value is number =>
        typeof value === 'number' && Number.isInteger(value) && value >= 0;
      if (variantIndex !== undefined && !isIndex(variantIndex)) {
        return INVALID;
      }
      if (audioIndex !== undefined && !isIndex(audioIndex)) {
        return INVALID;
      }
      return {
        ok: true,
        message: {
          type,
          candidateId,
          ...(variantIndex !== undefined && { variantIndex }),
          ...(audioIndex !== undefined && { audioIndex }),
        },
      };
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
