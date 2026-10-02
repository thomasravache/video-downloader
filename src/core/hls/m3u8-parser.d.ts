/** Tipos mínimos do `m3u8-parser` 7.2.0 (o pacote não traz .d.ts); só o que `parseHlsPlaylist` usa. */
declare module 'm3u8-parser' {
  export interface ParsedSegment {
    uri?: string;
    duration?: number;
    map?: { uri?: string };
  }

  export interface ParsedVariant {
    uri?: string;
    attributes?: {
      BANDWIDTH?: number;
      RESOLUTION?: { width?: number; height?: number };
      CODECS?: string;
    };
  }

  export interface ParsedManifest {
    segments?: ParsedSegment[];
    playlists?: ParsedVariant[];
    endList?: boolean;
  }

  export class Parser {
    manifest: ParsedManifest;
    push(chunk: string): void;
    end(): void;
  }
}
