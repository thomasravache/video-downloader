/**
 * Gerador de segmentos de fixture para Elementary Stream / Packed Audio AAC com ID3 e ADTS (SPEC-0021).
 * Não é teste. Usado para simular o comportamento de áudio HLS do YouTube (ex: itags 234 e 233).
 */

/**
 * Constrói uma tag ID3v2.4 com frame PRIV contendo carimbo de tempo
 * 'com.apple.streaming.transportStreamTimestamp' (RFC 8216 §3.4).
 */
export function makeId3Tag(ptsTicks: number): Uint8Array {
  const owner = new TextEncoder().encode('com.apple.streaming.transportStreamTimestamp\0');
  const payload = new Uint8Array(owner.length + 8);
  payload.set(owner, 0);

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  view.setBigUint64(owner.length, BigInt(ptsTicks));

  const frameId = new TextEncoder().encode('PRIV');
  const frameHeader = new Uint8Array(10);
  frameHeader.set(frameId, 0);
  const frameView = new DataView(frameHeader.buffer, frameHeader.byteOffset, frameHeader.byteLength);
  frameView.setUint32(4, payload.length);

  const tagPayloadLength = frameHeader.length + payload.length;
  const tagHeader = new Uint8Array(10);
  tagHeader.set(new TextEncoder().encode('ID3'), 0);
  tagHeader[3] = 4; // v2.4
  tagHeader[4] = 0;
  tagHeader[5] = 0;
  // Tamanho em formato syncsafe integer (7 bits por byte)
  tagHeader[6] = (tagPayloadLength >> 21) & 0x7f;
  tagHeader[7] = (tagPayloadLength >> 14) & 0x7f;
  tagHeader[8] = (tagPayloadLength >> 7) & 0x7f;
  tagHeader[9] = tagPayloadLength & 0x7f;

  const out = new Uint8Array(tagHeader.length + tagPayloadLength);
  out.set(tagHeader, 0);
  out.set(frameHeader, tagHeader.length);
  out.set(payload, tagHeader.length + frameHeader.length);
  return out;
}

/**
 * Constrói um quadro ADTS (cabeçalho de 7 bytes + payload AAC falso).
 * Padrão: MPEG-4, AAC-LC, 44100Hz, Stereo.
 */
export function makeAdtsFrame(payloadSize = 20): Uint8Array {
  const frameLen = 7 + payloadSize;
  const header = new Uint8Array(7);
  header[0] = 0xff;
  header[1] = 0xf1; // MPEG-4, layer 0, no CRC
  header[2] = 0x50; // profile AAC LC (1), freq 44100Hz (4)
  header[3] = 0x80 | ((frameLen >> 11) & 0x03); // channel stereo (2) + frameLen bits [12..11]
  header[4] = (frameLen >> 3) & 0xff; // frameLen bits [10..3]
  header[5] = ((frameLen & 7) << 5) | 0x1f; // frameLen bits [2..0] + buffer fullness bits [10..6]
  header[6] = 0xfc; // buffer fullness bits [5..0] + 0 raw data blocks

  const payload = new Uint8Array(payloadSize).fill(0x12);
  const out = new Uint8Array(frameLen);
  out.set(header, 0);
  out.set(payload, 7);
  return out;
}

/**
 * Constrói um segmento de áudio packed AAC composto por uma tag ID3 seguida por N quadros ADTS.
 */
export function makePackedAacSegment(ptsTicks: number, frameCount = 43, payloadSize = 20): Uint8Array {
  const parts: Uint8Array[] = [makeId3Tag(ptsTicks)];
  for (let i = 0; i < frameCount; i++) {
    parts.push(makeAdtsFrame(payloadSize));
  }
  const total = parts.reduce((acc, p) => acc + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/**
 * Constrói um segmento contendo apenas quadros ADTS (sem cabeçalho ID3).
 */
export function makeAdtsOnlySegment(frameCount = 43, payloadSize = 20): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < frameCount; i++) {
    parts.push(makeAdtsFrame(payloadSize));
  }
  const total = parts.reduce((acc, p) => acc + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}
