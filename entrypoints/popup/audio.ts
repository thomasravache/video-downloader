/** Texto "Inclui áudio: <nome>" do cartão HLS (SPEC-0014:UT-05). */
import type { HlsInfo } from '../../src/core/hls';
import { chooseAudio } from '../../src/core/hls-download';

/**
 * Função pura (sem DOM): o texto quando o download da variante `variantIndex` vai juntar uma faixa de áudio
 * (`chooseAudio` devolve uma faixa), com `format(nome)` fornecendo a tradução; `undefined` caso contrário.
 */
export function audioIncludedText(
  hls: HlsInfo,
  variantIndex: number,
  format: (name: string) => string,
): string | undefined {
  const track = chooseAudio(hls, variantIndex);
  return typeof track === 'object' ? format(track.name) : undefined;
}
