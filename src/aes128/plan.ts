/**
 * Montagem de EncryptionPlan e derivação de IV para HLS AES-128 (SPEC-0017).
 * Marcador obrigatório:
 * VD_AES128_LOCAL_ONLY
 */
import type { EncryptionKey, EncryptionPlan } from '../core/hls-download/protocol';

export const VD_AES128_LOCAL_ONLY = 'VD_AES128_LOCAL_ONLY';

export function deriveIv(mediaSequence: number, segmentIndex: number): Uint8Array {
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  const seq = BigInt(mediaSequence) + BigInt(segmentIndex);
  view.setBigUint64(8, seq, false);
  return iv;
}

function parseAttributes(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Ex: METHOD=AES-128,URI="key.bin",IV=0x0123...
  const regex = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(tagBody)) !== null) {
    const key = match[1];
    const val = match[2] ?? match[3];
    if (key && val !== undefined) {
      attrs[key] = val.trim();
    }
  }
  return attrs;
}

export function buildEncryptionPlan(playlistText: string, baseUrl: string): EncryptionPlan {
  const lines = playlistText
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let mediaSequence = 0;
  const keys: EncryptionKey[] = [];
  const segmentKeys: (number | null)[] = [];
  let currentKeyIndex: number | null = null;
  let initKey: number | null | undefined = undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    if (line === '#EXTM3U' && i > 0) {
      currentKeyIndex = null;
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      const seqStr = line.slice('#EXT-X-MEDIA-SEQUENCE:'.length).trim();
      const parsed = parseInt(seqStr, 10);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        mediaSequence = parsed;
      }
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const body = line.slice('#EXT-X-KEY:'.length);
      const attrs = parseAttributes(body);
      const method = attrs['METHOD'];

      if (method === 'NONE') {
        currentKeyIndex = null;
      } else if (method === 'AES-128') {
        const uri = attrs['URI'];
        if (!uri) {
          throw new Error('EXT-X-KEY METHOD=AES-128 sem URI');
        }
        let resolvedUrl: string;
        try {
          resolvedUrl = new URL(uri, baseUrl).href;
        } catch {
          throw new Error(`URI de chave inválida: ${uri}`);
        }
        let iv: string | undefined = undefined;
        if (attrs['IV']) {
          const rawIv = attrs['IV'].toLowerCase();
          iv = rawIv.startsWith('0x') ? rawIv.slice(2) : rawIv;
        }

        // Verifica se chave já existe
        const existingIndex = keys.findIndex((k) => k.url === resolvedUrl && k.iv === iv);
        if (existingIndex >= 0) {
          currentKeyIndex = existingIndex;
        } else {
          if (keys.length >= 8) {
            throw new Error('Mais de 8 chaves distintas');
          }
          const newKey: EncryptionKey = {
            url: resolvedUrl,
            ...(iv !== undefined && { iv }),
          };
          keys.push(newKey);
          currentKeyIndex = keys.length - 1;
        }
      } else {
        throw new Error(`Método não suportado: ${method ?? 'desconhecido'}`);
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
      if (currentKeyIndex !== null) {
        const activeKey = keys[currentKeyIndex];
        if (!activeKey?.iv) {
          if (attrs['BYTERANGE']) {
            initKey = null;
          } else {
            throw new Error('Init segment (EXT-X-MAP) exige IV explícito');
          }
        } else {
          initKey = currentKeyIndex;
        }
      } else {
        initKey = null;
      }
    } else if (line.startsWith('#EXTINF:')) {
      // O próximo elemento não-tag é o segmento
      let nextLineIndex = i + 1;
      while (nextLineIndex < lines.length) {
        const nextLine = lines[nextLineIndex];
        if (nextLine === undefined || !nextLine.startsWith('#')) break;
        // Trata tags inline se houver
        if (nextLine.startsWith('#EXT-X-KEY:')) {
          const body = nextLine.slice('#EXT-X-KEY:'.length);
          const attrs = parseAttributes(body);
          if (attrs['METHOD'] === 'NONE') currentKeyIndex = null;
        }
        nextLineIndex++;
      }
      if (nextLineIndex < lines.length) {
        segmentKeys.push(currentKeyIndex);
        i = nextLineIndex; // avança o ponteiro para a linha da URL
      }
    } else if (!line.startsWith('#')) {
      // Caso de segmento sem EXTINF ou já processado
      // Se não foi processado por EXTINF acima, adiciona
    }
  }

  return {
    keys,
    segmentKeys,
    ...(initKey !== undefined && { initKey }),
    mediaSequence,
  };
}
