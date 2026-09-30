export interface FilenameInput {
  title?: string;
  mediaUrl: string;
  mimeType?: string;
  /** Relógio injetável; padrão: agora. Usado só no fallback `video-<data>.mp4`. */
  now?: Date;
}

export function toFilename(_input: FilenameInput): string {
  throw new Error('NotImplemented');
}
