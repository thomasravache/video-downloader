/** Escolha da faixa de áudio de um download HLS (SPEC-0014:UT-03). Só a assinatura: sem lógica. */
import type { HlsAudioTrack, HlsInfo } from '../hls';

/**
 * `variantIndex` da master, `audioIndex` opcional (posição em `info.audio`).
 * 'none': a variante não tem áudio separado; 'invalid': `audioIndex` de outro grupo, inexistente, negativo
 * ou não inteiro.
 */
export function chooseAudio(
  _info: HlsInfo,
  _variantIndex: number,
  _audioIndex?: number,
): HlsAudioTrack | 'none' | 'invalid' {
  throw new Error('NotImplemented: chooseAudio (SPEC-0014)');
}
