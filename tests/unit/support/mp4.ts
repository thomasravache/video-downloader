/**
 * Leitor mínimo de caixas MP4 para os testes do SPEC-0012 (sem ffprobe; não é teste).
 * Lê as caixas de topo, as trilhas (`tkhd`/`mdhd`/`hdlr`) e, em MP4 fragmentado (`moof`/`traf`/`trun`,
 * como o que o mux.js e o fMP4 do HLS produzem), soma as durações das amostras.
 */

export interface Box {
  type: string;
  /** Início da caixa (cabeçalho). */
  start: number;
  /** Início do conteúdo. */
  payload: number;
  end: number;
}

export interface TrackInfo {
  trackId: number;
  /** 'vide' | 'soun' | ... */
  handler: string;
  width: number;
  height: number;
  timescale: number;
  durationSec: number;
}

export interface Mp4Info {
  topLevel: string[];
  tracks: TrackInfo[];
  /** Maior duração entre as trilhas. */
  durationSec: number;
  /** Tipos de caixa encontrados em qualquer nível (ex.: 'avc1', 'sinf'). */
  allTypes: Set<string>;
}

const CONTAINERS = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'moof',
  'traf',
  'mvex',
  'edts',
  'dinf',
]);

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function readBoxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
  const dv = view(bytes);
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = dv.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    let header = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) {
      throw new Error(`caixa MP4 inválida: ${type} em ${String(at)} (tamanho ${String(size)})`);
    }
    boxes.push({ type, start: at, payload: at + header, end: at + size });
    at += size;
  }
  if (at !== end) {
    throw new Error('bytes sobrando depois da última caixa MP4');
  }
  return boxes;
}

const child = (bytes: Uint8Array, box: Box, type: string): Box | undefined =>
  readBoxes(bytes, box.payload, box.end).find((b) => b.type === type);

const children = (bytes: Uint8Array, box: Box, type: string): Box[] =>
  readBoxes(bytes, box.payload, box.end).filter((b) => b.type === type);

function collectTypes(bytes: Uint8Array, boxes: Box[], into: Set<string>): void {
  for (const box of boxes) {
    into.add(box.type);
    if (CONTAINERS.has(box.type)) {
      collectTypes(bytes, readBoxes(bytes, box.payload, box.end), into);
    } else if (box.type === 'stsd') {
      // full box (4) + entry_count (4), depois as entradas (avc1/mp4a/encv...).
      const entries = readBoxes(bytes, box.payload + 8, box.end);
      for (const entry of entries) {
        into.add(entry.type);
        // Entradas de amostra: avc1/encv têm 78 bytes antes das caixas filhas; mp4a/enca têm 28.
        const skip = ['avc1', 'encv', 'hvc1', 'hev1'].includes(entry.type) ? 78 : 28;
        try {
          collectTypes(bytes, readBoxes(bytes, entry.payload + skip, entry.end), into);
        } catch {
          // Entrada desconhecida: só o tipo conta.
        }
      }
    } else if (box.type === 'sinf') {
      collectTypes(bytes, readBoxes(bytes, box.payload, box.end), into);
    }
  }
}

/** Interpreta um MP4 (progressivo ou fragmentado). Lança se a estrutura de caixas for inválida. */
export function inspectMp4(bytes: Uint8Array): Mp4Info {
  const dv = view(bytes);
  const top = readBoxes(bytes);
  const allTypes = new Set<string>();
  collectTypes(bytes, top, allTypes);
  const moov = top.find((b) => b.type === 'moov');
  const tracks: (TrackInfo & { mdhdDuration: number })[] = [];
  const trexDefaults = new Map<number, number>();
  if (moov) {
    for (const trak of children(bytes, moov, 'trak')) {
      const tkhd = child(bytes, trak, 'tkhd');
      const mdia = child(bytes, trak, 'mdia');
      const mdhd = mdia && child(bytes, mdia, 'mdhd');
      const hdlr = mdia && child(bytes, mdia, 'hdlr');
      if (!tkhd || !mdhd || !hdlr) {
        throw new Error('trak sem tkhd/mdhd/hdlr');
      }
      const v1 = bytes[tkhd.payload] === 1;
      const trackId = dv.getUint32(tkhd.payload + (v1 ? 20 : 12));
      // width/height: 16.16 nos últimos 8 bytes do tkhd.
      const width = dv.getUint32(tkhd.end - 8) / 65536;
      const height = dv.getUint32(tkhd.end - 4) / 65536;
      const m1 = bytes[mdhd.payload] === 1;
      const timescale = dv.getUint32(mdhd.payload + (m1 ? 20 : 12));
      const rawDuration = m1
        ? Number(dv.getBigUint64(mdhd.payload + 24))
        : dv.getUint32(mdhd.payload + 16);
      const unknown = rawDuration === 0 || rawDuration === 0xffffffff;
      const handler = String.fromCharCode(...bytes.subarray(hdlr.payload + 8, hdlr.payload + 12));
      tracks.push({
        trackId,
        handler,
        width,
        height,
        timescale,
        mdhdDuration: unknown ? 0 : rawDuration,
        durationSec: unknown ? 0 : rawDuration / timescale,
      });
    }
    const mvex = child(bytes, moov, 'mvex');
    if (mvex) {
      for (const trex of children(bytes, mvex, 'trex')) {
        trexDefaults.set(dv.getUint32(trex.payload + 4), dv.getUint32(trex.payload + 12));
      }
    }
  }
  // Fragmentos: soma das durações das amostras por trilha.
  const fragmentTicks = new Map<number, number>();
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of children(bytes, moof, 'traf')) {
      const tfhd = child(bytes, traf, 'tfhd');
      if (!tfhd) {
        continue;
      }
      const flags = dv.getUint32(tfhd.payload) & 0xffffff;
      const trackId = dv.getUint32(tfhd.payload + 4);
      let at = tfhd.payload + 8;
      if (flags & 0x1) at += 8;
      if (flags & 0x2) at += 4;
      const defaultDuration = flags & 0x8 ? dv.getUint32(at) : (trexDefaults.get(trackId) ?? 0);
      for (const trun of children(bytes, traf, 'trun')) {
        const tf = dv.getUint32(trun.payload) & 0xffffff;
        const count = dv.getUint32(trun.payload + 4);
        let p = trun.payload + 8;
        if (tf & 0x1) p += 4;
        if (tf & 0x4) p += 4;
        const stride =
          (tf & 0x100 ? 4 : 0) + (tf & 0x200 ? 4 : 0) + (tf & 0x400 ? 4 : 0) + (tf & 0x800 ? 4 : 0);
        let ticks = 0;
        for (let i = 0; i < count; i++) {
          ticks += tf & 0x100 ? dv.getUint32(p + i * stride) : defaultDuration;
        }
        fragmentTicks.set(trackId, (fragmentTicks.get(trackId) ?? 0) + ticks);
      }
    }
  }
  const result: TrackInfo[] = tracks.map(({ mdhdDuration, ...track }) => {
    const ticks = fragmentTicks.get(track.trackId) ?? 0;
    return {
      ...track,
      durationSec: mdhdDuration > 0 ? track.durationSec : ticks / track.timescale,
    };
  });
  return {
    topLevel: top.map((b) => b.type),
    tracks: result,
    durationSec: Math.max(0, ...result.map((t) => t.durationSec)),
    allTypes,
  };
}
