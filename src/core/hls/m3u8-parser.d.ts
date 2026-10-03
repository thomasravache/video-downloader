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
      /** GROUP-ID de áudio da STREAM-INF (SPEC-0014). */
      AUDIO?: string;
    };
  }

  /** `manifest.mediaGroups.AUDIO[groupId][name]` (SPEC-0014); a chave interna é o NAME. */
  export interface ParsedMediaGroupEntry {
    default?: boolean;
    autoselect?: boolean;
    language?: string;
    uri?: string;
  }

  export interface ParsedMediaGroups {
    AUDIO?: Record<string, Record<string, ParsedMediaGroupEntry>>;
  }

  export interface ParsedManifest {
    segments?: ParsedSegment[];
    playlists?: ParsedVariant[];
    endList?: boolean;
    mediaGroups?: ParsedMediaGroups;
  }

  export class Parser {
    manifest: ParsedManifest;
    push(chunk: string): void;
    end(): void;
  }
}
