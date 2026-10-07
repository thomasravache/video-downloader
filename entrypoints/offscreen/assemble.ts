/**
 * Montagem de HLS no offscreen (SPEC-0012:UT-05). `mux.js` e `mediabunny` só podem ser importados daqui
 * (regras de arquitetura mux-js-only-in-offscreen e mediabunny-only-in-offscreen, ADR-0013, ADR-0014).
 */
import muxjs from 'mux.js';
import {
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import type { EncodedPacket } from 'mediabunny';
import { AssemblyError, MAX_BUFFERED_BYTES } from '../../src/core/hls-download';

function totalBytes(init: Uint8Array | undefined, segments: readonly Uint8Array[]): number {
  return segments.reduce((sum, segment) => sum + segment.byteLength, init?.byteLength ?? 0);
}

/** Recusa antes de tocar nos dados: o total bufferizado passa de 1,5 GiB. */
function assertWithinLimit(init: Uint8Array | undefined, segments: readonly Uint8Array[]): void {
  if (totalBytes(init, segments) > MAX_BUFFERED_BYTES) {
    throw new AssemblyError('TOO_LARGE');
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

interface Pending {
  packet: EncodedPacket;
  add: (packet: EncodedPacket) => Promise<void>;
  next: () => Promise<IteratorResult<EncodedPacket>>;
}

async function remuxWithMediabunny(fmp4: Uint8Array): Promise<Uint8Array> {
  let input: Input | undefined;
  try {
    input = new Input({
      source: new BlobSource(new Blob([fmp4] as BlobPart[])),
      formats: [MP4],
    });
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();

    const videoCodec = videoTrack ? await videoTrack.getCodec() : null;
    const audioCodec = audioTrack ? await audioTrack.getCodec() : null;
    const videoConfig = videoTrack ? await videoTrack.getDecoderConfig() : null;
    const audioConfig = audioTrack ? await audioTrack.getDecoderConfig() : null;

    const hasVideo = Boolean(videoTrack && videoCodec && videoConfig);
    const hasAudio = Boolean(audioTrack && audioCodec && audioConfig);

    if (!hasVideo && !hasAudio) {
      return fmp4;
    }

    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });

    let videoSource: EncodedVideoPacketSource | undefined;
    let audioSource: EncodedAudioPacketSource | undefined;

    if (hasVideo && videoCodec) {
      videoSource = new EncodedVideoPacketSource(videoCodec);
      output.addVideoTrack(videoSource);
    }

    if (hasAudio && audioCodec && audioTrack) {
      audioSource = new EncodedAudioPacketSource(audioCodec);
      const languageCode = await audioTrack.getLanguageCode();
      output.addAudioTrack(audioSource, languageCode === 'und' ? {} : { languageCode });
    }

    await output.start();

    const feeds: Pending[] = [];
    const iterate = async (
      sink: EncodedPacketSink,
      add: (packet: EncodedPacket) => Promise<void>,
    ): Promise<void> => {
      const it = sink.packets()[Symbol.asyncIterator]();
      const first = await it.next();
      if (!first.done) {
        feeds.push({ packet: first.value, add, next: () => it.next() });
      }
    };

    if (hasVideo && videoTrack && videoSource && videoConfig) {
      const vSource = videoSource;
      const vConfig = videoConfig;
      await iterate(new EncodedPacketSink(videoTrack), (p) =>
        vSource.add(p, { decoderConfig: vConfig }),
      );
    }

    if (hasAudio && audioTrack && audioSource && audioConfig) {
      const aSource = audioSource;
      const aConfig = audioConfig;
      await iterate(new EncodedPacketSink(audioTrack), (p) =>
        aSource.add(p, { decoderConfig: aConfig }),
      );
    }

    while (feeds.length > 0) {
      let pick = 0;
      feeds.forEach((f, i) => {
        if (f.packet.timestamp < (feeds[pick] as Pending).packet.timestamp) {
          pick = i;
        }
      });
      const feed = feeds[pick] as Pending;
      await feed.add(feed.packet);
      const next = await feed.next();
      if (next.done) {
        feeds.splice(pick, 1);
      } else {
        feed.packet = next.value;
      }
    }

    await output.finalize();
    if (target.buffer) {
      return new Uint8Array(target.buffer);
    }
    return fmp4;
  } catch {
    return fmp4;
  } finally {
    input?.dispose();
  }
}

/** Segmentos TS (H.264/AAC) -> MP4. `init` opcional (raramente usado em TS). Rejeita com `AssemblyError`. */
export async function assembleTs(
  init: Uint8Array | undefined,
  segments: readonly Uint8Array[],
): Promise<Uint8Array> {
  try {
    assertWithinLimit(init, segments);
    return await transmux(segments);
  } catch (error) {
    throw error instanceof Error ? error : new AssemblyError('ASSEMBLY_FAILED');
  }
}

async function transmux(segments: readonly Uint8Array[]): Promise<Uint8Array> {
  const transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: false });
  let initSegment: Uint8Array | undefined;
  const fragments: Uint8Array[] = [];
  transmuxer.on('data', (segment) => {
    if (segment.data.byteLength === 0) {
      return;
    }
    initSegment ??= segment.initSegment;
    fragments.push(segment.data);
  });
  try {
    for (const segment of segments) {
      transmuxer.push(segment);
      transmuxer.flush();
    }
  } catch {
    throw new AssemblyError('UNSUPPORTED_CODEC', 'segmentos não são TS H.264/AAC');
  }
  if (initSegment === undefined || fragments.length === 0) {
    throw new AssemblyError('UNSUPPORTED_CODEC', 'nenhuma trilha H.264/AAC');
  }
  const fmp4 = concat([initSegment, ...fragments]);
  const normalized = normalizeTrunV1(fmp4);
  return remuxWithMediabunny(normalized);
}

const CONTAINERS = ['moov', 'trak', 'mdia', 'minf', 'stbl'];
const MARKERS = ['sinf', 'schm', 'encv', 'enca'];

function typeAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at + 4] ?? 0,
    bytes[at + 5] ?? 0,
    bytes[at + 6] ?? 0,
    bytes[at + 7] ?? 0,
  );
}

/**
 * As caixas de `start` a `end` são legíveis (tamanhos de 32/64 bits ou "até o fim", sem passar do limite,
 * cobrindo o trecho todo)? Desce pelos contêineres conhecidos. Qualquer inconsistência devolve `false`.
 */
function boxesReadable(bytes: Uint8Array, start: number, end: number): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = start;
  while (at < end) {
    if (at + 8 > end) {
      return false;
    }
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) {
        return false;
      }
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (!Number.isSafeInteger(size) || size < header || at + size > end) {
      return false;
    }
    if (CONTAINERS.includes(typeAt(bytes, at)) && !boxesReadable(bytes, at + header, at + size)) {
      return false;
    }
    at += size;
  }
  return at === end && start < end;
}

function includesTag(bytes: Uint8Array, tag: string): boolean {
  const codes = Array.from(tag, (c) => c.charCodeAt(0));
  for (let at = 0; at + 4 <= bytes.byteLength; at++) {
    if (codes.every((code, i) => bytes[at + i] === code)) {
      return true;
    }
  }
  return false;
}

/**
 * O init declara (ou pode declarar) amostras criptografadas? Falha FECHADO: procura os marcadores
 * `sinf`/`schm`/`encv`/`enca` em qualquer ponto do init, qualquer que seja o aninhamento ou o tamanho de
 * caixa (inclusive `moov` de 64 bits), e um init cujas caixas não podem ser lidas conta como criptografado.
 */
export function initIsEncrypted(init: Uint8Array): boolean {
  return !boxesReadable(init, 0, init.byteLength) || MARKERS.some((tag) => includesTag(init, tag));
}

/** fMP4: `init` + segmentos concatenados (init primeiro). Rejeita com `AssemblyError` (ENCRYPTED se o init tem sinf/schm). */
export function assembleFmp4(
  init: Uint8Array,
  segments: readonly Uint8Array[],
): Promise<Uint8Array> {
  try {
    assertWithinLimit(init, segments);
    if (initIsEncrypted(init)) {
      throw new AssemblyError('ENCRYPTED', 'init com caixa de criptografia');
    }
    return Promise.resolve(concat([init, ...segments]));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new AssemblyError('ASSEMBLY_FAILED'));
  }
}

interface BoxRange {
  type: string;
  start: number;
  payload: number;
  end: number;
}

function parseBoxRanges(bytes: Uint8Array, start = 0, end = bytes.byteLength): BoxRange[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: BoxRange[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = dv.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) {
        break;
      }
      size = Number(dv.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (!Number.isSafeInteger(size) || size < header || at + size > end) {
      break;
    }
    const type = typeAt(bytes, at);
    boxes.push({ type, start: at, payload: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

/**
 * Normaliza caixas trun em versão 1 quando contêm composition time offset negativo (SPEC-0018).
 */
export function normalizeTrunV1(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes);
  const topBoxes = parseBoxRanges(out, 0, out.byteLength);
  for (const moof of topBoxes) {
    if (moof.type !== 'moof') {
      continue;
    }
    const trafs = parseBoxRanges(out, moof.payload, moof.end);
    for (const traf of trafs) {
      if (traf.type !== 'traf') {
        continue;
      }
      const truns = parseBoxRanges(out, traf.payload, traf.end);
      for (const trun of truns) {
        if (trun.type !== 'trun') {
          continue;
        }
        if (trun.payload + 4 <= trun.end) {
          const version = out[trun.payload];
          const flagByte1 = out[trun.payload + 2] ?? 0;
          // flags & 0x0800 (composition-time-offsets-present): no byte 1 (offset 2) o bit 0x08 está ativo
          if (version === 0 && (flagByte1 & 0x08) !== 0) {
            out[trun.payload] = 1;
          }
        }
      }
    }
  }
  return out;
}
