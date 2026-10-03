/** Escolha da faixa de áudio de um download HLS (SPEC-0014:UT-03). */
import type { HlsAudioTrack, HlsInfo } from '../hls';

/**
 * `variantIndex` da master, `audioIndex` opcional (posição em `info.audio`).
 * 'none': a variante não tem áudio separado; 'invalid': `audioIndex` de outro grupo, inexistente, negativo
 * ou não inteiro.
 */
export function chooseAudio(
  info: HlsInfo,
  variantIndex: number,
  audioIndex?: number,
): HlsAudioTrack | 'none' | 'invalid' {
  const group = info.variants[variantIndex]?.audioGroup;
  const tracks = (info.audio ?? []).filter((track) => track.groupId === group);
  if (group === undefined || tracks.length === 0) {
    return audioIndex === undefined ? 'none' : 'invalid';
  }
  if (audioIndex === undefined) {
    return tracks.find((track) => track.default) ?? (tracks[0] as HlsAudioTrack);
  }
  return Number.isInteger(audioIndex)
    ? (tracks.find((track) => track.index === audioIndex) ?? 'invalid')
    : 'invalid';
}
