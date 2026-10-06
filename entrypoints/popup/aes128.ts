import type { HlsInfo } from '../../src/core/hls';

/**
 * Retorna o texto explicativo sobre HLS com AES-128 quando aplicável.
 */
export function aes128NoteText(_hls: HlsInfo | undefined, _noteText: string): string | undefined {
  throw new Error('NotImplemented');
}
