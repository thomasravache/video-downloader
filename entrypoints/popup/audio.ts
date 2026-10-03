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

/** Opção do seletor "Áudio" (SPEC-0015). */
export interface AudioOption {
  /** Posição em `HlsInfo.audio`: o `audioIndex` enviado no download. */
  index: number;
  /** Nome da faixa; com idioma: `Nome (idioma)`. Só texto (o chamador usa `textContent`). */
  label: string;
  /** É a faixa que o download escolheria sem índice (`chooseAudio`): vem selecionada. */
  default: boolean;
}

/**
 * Função pura (sem DOM): opções do `audio-select` da variante `variantIndex`: as faixas do grupo dela, na
 * ordem de `hls.audio`; lista vazia quando o grupo tem 0 ou 1 faixa (sem seletor; fica o "Inclui áudio").
 */
export function audioOptions(hls: HlsInfo, variantIndex: number): AudioOption[] {
  const group = hls.variants[variantIndex]?.audioGroup;
  const tracks = (hls.audio ?? []).filter((track) => track.groupId === group);
  if (group === undefined || tracks.length < 2) {
    return [];
  }
  const chosen = chooseAudio(hls, variantIndex);
  return tracks.map((track) => ({
    index: track.index,
    label: track.language === undefined ? track.name : `${track.name} (${track.language})`,
    default: typeof chosen === 'object' && chosen.index === track.index,
  }));
}
