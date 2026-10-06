import type { HlsInfo } from '../../src/core/hls';

/**
 * Retorna o texto explicativo sobre HLS com AES-128 quando aplicável.
 */
export function aes128NoteText(hls: HlsInfo | undefined, noteText: string): string | undefined {
  if (hls !== undefined && hls.aes128 === true && !hls.encrypted) {
    return noteText;
  }
  return undefined;
}
