/**
 * Junção de uma trilha de vídeo e uma de áudio (fMP4) num único MP4 (SPEC-0014, ADR-0014). Só a assinatura:
 * a biblioteca de mídia (mediabunny) só pode ser importada daqui.
 */

export interface MergeTrack {
  /** Init (`moov`) do fMP4 da trilha. */
  init: Uint8Array;
  /** Fragmentos (`moof`+`mdat`) na ordem. */
  segments: readonly Uint8Array[];
}

/** Saída: MP4 com 1 trilha de vídeo e 1 de áudio, pacotes copiados. Rejeita com `AssemblyError`. */
export function assembleMerged(_video: MergeTrack, _audio: MergeTrack): Promise<Uint8Array> {
  return Promise.reject(new Error('NotImplemented: assembleMerged (SPEC-0014)'));
}
