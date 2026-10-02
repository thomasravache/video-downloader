/**
 * Montagem de HLS no offscreen (SPEC-0012:UT-05). Assinaturas apenas; `mux.js` só pode ser
 * importado daqui (regra de arquitetura mux-js-only-in-offscreen, ADR-0013).
 */

/** Segmentos TS (H.264/AAC) -> MP4. `init` opcional (raramente usado em TS). Rejeita com `AssemblyError`. */
export function assembleTs(
  _init: Uint8Array | undefined,
  _segments: readonly Uint8Array[],
): Promise<Uint8Array> {
  return Promise.reject(new Error('NotImplemented'));
}

/** fMP4: `init` + segmentos concatenados (init primeiro). Rejeita com `AssemblyError` (ENCRYPTED se o init tem sinf/schm). */
export function assembleFmp4(
  _init: Uint8Array,
  _segments: readonly Uint8Array[],
): Promise<Uint8Array> {
  return Promise.reject(new Error('NotImplemented'));
}
