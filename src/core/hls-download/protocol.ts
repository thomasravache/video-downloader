/** Protocolo background <-> offscreen (SPEC-0012). Só tipos. */
import type { JobError } from './errors';
import type { ByteRange } from './segments';

/** Faixa de áudio separada de um job com junção (SPEC-0014); mesma forma de `urls`/`ranges` do vídeo. */
export interface OffscreenAudio {
  urls: string[];
  initUrl?: string;
  ranges?: (ByteRange | null | undefined)[];
  initRange?: ByteRange;
}

export interface OffscreenStart {
  target: 'offscreen';
  type: 'start';
  jobId: string;
  /** Segmentos da playlist re-analisada da variante escolhida, na ordem. */
  urls: string[];
  /** EXT-X-MAP (fMP4), quando houver. */
  initUrl?: string;
  fmp4: boolean;
  /** Faixas alinhadas a `urls` (SPEC-0013); se presente, `length === urls.length`. `null` (o
   * `sendMessage` serializa `undefined` assim) equivale a "sem faixa". */
  ranges?: (ByteRange | null | undefined)[];
  /** Faixa do `initUrl` (SPEC-0013); só com `initUrl`. */
  initRange?: ByteRange;
  /** Faixa de áudio a juntar ao vídeo num único MP4 (SPEC-0014). */
  audio?: OffscreenAudio;
}
export interface OffscreenCancel {
  target: 'offscreen';
  type: 'cancel';
  jobId: string;
}
export interface OffscreenRevoke {
  target: 'offscreen';
  type: 'revoke';
  jobId: string;
  blobUrl: string;
}
export type OffscreenCommand = OffscreenStart | OffscreenCancel | OffscreenRevoke;

export type OffscreenEvent =
  | { type: 'progress'; segmentsDone: number; segmentsTotal: number; bytesDone: number }
  | { type: 'assembling' }
  | { type: 'ready'; blobUrl: string; bytes: number }
  | { type: 'failed'; error: JobError };

/** Offscreen -> background, via `runtime.sendMessage`. */
export interface OffscreenEventMessage {
  target: 'background';
  jobId: string;
  event: OffscreenEvent;
}
