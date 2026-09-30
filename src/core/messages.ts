import type { Message } from './contracts';

export type MessageValidation =
  { ok: true; message: Message } | { ok: false; error: 'INVALID_MESSAGE' };

/** Aceita só mensagens do schema v1 vindas da própria extensão (`sender.id === extensionId`). */
export function validateMessage(
  _message: unknown,
  _sender: { id?: string },
  _extensionId: string,
): MessageValidation {
  throw new Error('NotImplemented');
}
