/**
 * Junção de uma trilha de vídeo e uma de áudio (fMP4) num único MP4 (SPEC-0014, ADR-0014). A biblioteca de
 * mídia (mediabunny) só pode ser importada daqui (regra de arquitetura mediabunny-only-in-offscreen).
 * Os pacotes são copiados (sem recodificar) das duas fontes para um MP4 de duas trilhas.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import type { EncodedPacket } from 'mediabunny';
import { AssemblyError } from '../../src/core/hls-download';

export interface MergeTrack {
  /** Init (`moov`) do fMP4 da trilha. */
  init: Uint8Array;
  /** Fragmentos (`moof`+`mdat`) na ordem. */
  segments: readonly Uint8Array[];
}

interface Pending {
  packet: EncodedPacket;
  add: (packet: EncodedPacket) => Promise<void>;
  next: () => Promise<IteratorResult<EncodedPacket>>;
}

/** Saída: MP4 com 1 trilha de vídeo e 1 de áudio, pacotes copiados. Rejeita com `AssemblyError`. */
export async function assembleMerged(video: MergeTrack, audio: MergeTrack): Promise<Uint8Array> {
  const inputs: Input[] = [];
  try {
    const open = (track: MergeTrack): Input => {
      const input = new Input({
        source: new BlobSource(new Blob([track.init, ...track.segments] as BlobPart[])),
        formats: ALL_FORMATS,
      });
      inputs.push(input);
      return input;
    };
    const videoTrack = await open(video).getPrimaryVideoTrack();
    const audioTrack = await open(audio).getPrimaryAudioTrack();
    if (!videoTrack || !audioTrack) {
      throw new AssemblyError('ASSEMBLY_FAILED', 'faltou trilha de vídeo ou de áudio');
    }
    const videoConfig = await videoTrack.getDecoderConfig();
    const audioConfig = await audioTrack.getDecoderConfig();
    const videoCodec = await videoTrack.getCodec();
    const audioCodec = await audioTrack.getCodec();
    if (!videoCodec || !audioCodec || !videoConfig || !audioConfig) {
      throw new AssemblyError('UNSUPPORTED_CODEC', 'codec não suportado na junção');
    }

    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    const audioSource = new EncodedAudioPacketSource(audioCodec);
    output.addVideoTrack(videoSource);
    output.addAudioTrack(audioSource);
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
    await iterate(new EncodedPacketSink(videoTrack), (p) =>
      videoSource.add(p, { decoderConfig: videoConfig }),
    );
    await iterate(new EncodedPacketSink(audioTrack), (p) =>
      audioSource.add(p, { decoderConfig: audioConfig }),
    );

    // Intercala por timestamp, como um mux normal faria.
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
    if (!target.buffer) {
      throw new AssemblyError('ASSEMBLY_FAILED', 'sem saída');
    }
    return new Uint8Array(target.buffer);
  } catch (error) {
    throw error instanceof AssemblyError ? error : new AssemblyError('ASSEMBLY_FAILED');
  } finally {
    for (const input of inputs) {
      input.dispose();
    }
  }
}
