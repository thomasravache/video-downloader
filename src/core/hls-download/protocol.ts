/** Protocolo background <-> offscreen (SPEC-0012). Só tipos. */
import type { JobError } from './errors';
import type { ByteRange } from './segments';

export interface OffscreenStart {
  target: 'offscreen';
  type: 'start';
  jobId: string;
  /** Segmentos da playlist re-analisada da variante escolhida, na ordem. */
  urls: string[];
  /** EXT-X-MAP (fMP4), quando houver. */
  initUrl?: string;
  fmp4: boolean;
  /** Faixas alinhadas a `urls` (SPEC-0013); se presente, `length === urls.length`. */
  ranges?: (ByteRange | undefined)[];
  /** Faixa do `initUrl` (SPEC-0013); só com `initUrl`. */
  initRange?: ByteRange;
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
