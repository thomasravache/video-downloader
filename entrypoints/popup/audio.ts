/** Texto "Inclui áudio: <nome>" do cartão HLS (SPEC-0014:UT-05). Só a assinatura: sem lógica. */
import type { HlsInfo } from '../../src/core/hls';

/**
 * Função pura (sem DOM): o texto quando o download da variante `variantIndex` vai juntar uma faixa de áudio
 * (`chooseAudio` devolve uma faixa), com `format(nome)` fornecendo a tradução; `undefined` caso contrário.
 */
export function audioIncludedText(
  _hls: HlsInfo,
  _variantIndex: number,
  _format: (name: string) => string,
): string | undefined {
  throw new Error('NotImplemented: audioIncludedText (SPEC-0014)');
}
