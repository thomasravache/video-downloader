/** Tipos mínimos do `mux.js` 6.3.0 (o pacote não traz .d.ts); só o que a montagem usa. */
declare module 'mux.js' {
  export interface TransmuxedSegment {
    initSegment: Uint8Array;
    data: Uint8Array;
  }
  export class Transmuxer {
    constructor(options?: { keepOriginalTimestamps?: boolean; remux?: boolean });
    on(event: 'data', handler: (segment: TransmuxedSegment) => void): void;
    on(event: 'done', handler: () => void): void;
    push(bytes: Uint8Array): void;
    flush(): void;
  }
  const muxjs: { mp4: { Transmuxer: typeof Transmuxer } };
  export default muxjs;
}
