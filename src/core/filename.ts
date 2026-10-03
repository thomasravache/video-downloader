export interface FilenameInput {
  title?: string;
  mediaUrl: string;
  mimeType?: string;
  /** Rótulo da qualidade HLS (SPEC-0012): o nome vira `<título> - <rótulo>.mp4`. */
  label?: string;
  /** Relógio injetável; padrão: agora. Usado só no fallback `video-<data>.mp4`. */
  now?: Date;
}

export const MAX_FILENAME_LENGTH = 120;

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/x-m4v': 'm4v',
  'video/mpeg': 'mpg',
};
const KNOWN_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'ogg', 'mov', 'mkv', 'm4v', 'mpg', 'mpeg']);
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

function sanitize(text: string): string {
  const cleaned = text
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  return RESERVED_NAMES.test(cleaned) ? `_${cleaned}` : cleaned;
}

function lastSegment(mediaUrl: string): string {
  let path = mediaUrl;
  try {
    path = new URL(mediaUrl).pathname;
  } catch {
    path = mediaUrl.split(/[?#]/)[0] ?? '';
  }
  const segment = path.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function extensionOf(name: string): string | undefined {
  const match = /\.([a-z0-9]{2,5})$/i.exec(name);
  const ext = match?.[1]?.toLowerCase();
  return ext !== undefined && KNOWN_EXTENSIONS.has(ext) ? ext : undefined;
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text).slice(0, max);
  while (chars.join('').length > max) {
    chars.pop();
  }
  return chars.join('').replace(/[. ]+$/, '');
}

/** `sanitize(title ?? último segmento da URL)` + extensão (mimeType, depois URL), ≤ 120 caracteres. */
export function toFilename(input: FilenameInput): string {
  const segment = lastSegment(input.mediaUrl);
  const mime = input.mimeType?.split(';')[0]?.trim().toLowerCase();
  const extension = (mime !== undefined ? EXT_BY_MIME[mime] : undefined) ?? extensionOf(segment);

  let base = sanitize(input.title ?? '');
  if (base === '') {
    const withoutExt =
      extensionOf(segment) !== undefined ? segment.replace(/\.[^.]+$/, '') : segment;
    base = sanitize(withoutExt);
  }
  if (base === '') {
    const date = (input.now ?? new Date()).toISOString().slice(0, 10);
    return `video-${date}.mp4`;
  }

  if (input.label !== undefined && sanitize(input.label) !== '') {
    // HLS (SPEC-0012): sempre MP4; o título é truncado primeiro, rótulo e extensão são preservados.
    const suffix = ` - ${sanitize(input.label)}.mp4`;
    const head = truncate(base, Math.max(1, MAX_FILENAME_LENGTH - suffix.length));
    return `${head === '' ? 'video' : head}${suffix}`.slice(-MAX_FILENAME_LENGTH);
  }

  const ext = extension ?? 'mp4';
  const name = truncate(base, MAX_FILENAME_LENGTH - ext.length - 1);
  return `${name === '' ? 'video' : name}.${ext}`;
}
