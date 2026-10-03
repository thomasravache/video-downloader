/**
 * Contrato usado (SPEC-0014:UT-01, UT-02; estende SPEC-0011@1 de forma aditiva):
 *   parseHlsPlaylist(text, baseUrl): HlsInfo
 *     HlsInfo.audio?: HlsAudioTrack[] = { index, groupId, name, language?, default, url }[]
 *       - de `#EXT-X-MEDIA:TYPE=AUDIO` COM URI (faixa sem URI = áudio embutido na variante: não entra);
 *       - `index` = posição na lista devolvida; `name` sem caracteres de controle e <= 80; `language` <= 16;
 *         `url` absoluta, só http(s); no máximo 20 faixas; `audio` ausente se não há faixa com URI;
 *     HlsVariant.audioGroup?: AUDIO="grupo" da STREAM-INF.
 * As asserções são sobre a NOSSA saída (HlsInfo), não sobre `mediaGroups` do m3u8-parser (o shim de tipos
 * src/core/hls/m3u8-parser.d.ts já expõe `mediaGroups`, mas o parser usa o NAME como chave: nomes repetidos no
 * mesmo grupo colapsam, por isso o Implementer deve preferir ler as linhas `#EXT-X-MEDIA` do texto bruto).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHlsPlaylist } from '../../src/core/hls';
import type { HlsAudioTrack } from '../../src/core/hls';

const BASE = 'https://cdn.example.test/hls/master.m3u8';
const STREAMS = (group: string): string =>
  `#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080,AUDIO="${group}"\nv1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,AUDIO="${group}"\nv720.m3u8\n`;
const master = (...lines: string[]): string => `#EXTM3U\n#EXT-X-VERSION:7\n${lines.join('\n')}\n`;
const track = (attributes: string): string => `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",${attributes}`;
const audioOf = (text: string): HlsAudioTrack[] => parseHlsPlaylist(text, BASE).audio ?? [];
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

describe('parseHlsPlaylist: faixas de áudio e audioGroup', () => {
  it('SPEC-0014:UT-01 uma faixa DEFAULT: nome, idioma, default, url resolvida e audioGroup nas variantes', () => {
    const text = master(
      track('NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="a.m3u8"'),
      STREAMS('a1'),
    );

    const info = parseHlsPlaylist(text, BASE);

    expect(info.type).toBe('master');
    expect(info.audio).toEqual([
      {
        index: 0,
        groupId: 'a1',
        name: 'English',
        language: 'en',
        default: true,
        url: 'https://cdn.example.test/hls/a.m3u8',
      },
    ]);
    expect(info.variants.map((v) => v.audioGroup)).toEqual(['a1', 'a1']);
  });

  it('SPEC-0014:UT-01 várias faixas e grupos: index sequencial na ordem do arquivo, DEFAULT=NO/ausente vira false, URI absoluta e relativa', () => {
    const text = master(
      track('NAME="English",LANGUAGE="en",DEFAULT=YES,URI="en/a.m3u8"'),
      track(
        'NAME="Português",LANGUAGE="pt-BR",DEFAULT=NO,URI="https://other.example.test/pt.m3u8"',
      ),
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a2",NAME="Deutsch",URI="de.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=3200000,AUDIO="a1"\nv1080.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="a2"\nv480.m3u8',
    );

    const info = parseHlsPlaylist(text, BASE);

    expect(info.audio?.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(info.audio?.map((t) => [t.groupId, t.name, t.default])).toEqual([
      ['a1', 'English', true],
      ['a1', 'Português', false],
      ['a2', 'Deutsch', false],
    ]);
    expect(info.audio?.map((t) => t.url)).toEqual([
      'https://cdn.example.test/hls/en/a.m3u8',
      'https://other.example.test/pt.m3u8',
      'https://cdn.example.test/hls/de.m3u8',
    ]);
    expect(info.audio?.[2]?.language).toBeUndefined();
    expect(info.variants.map((v) => v.audioGroup)).toEqual(['a1', 'a2']);
  });

  it('SPEC-0014:UT-01 variante sem AUDIO= não tem audioGroup; master sem EXT-X-MEDIA não tem audio; playlist de mídia nunca tem audio', () => {
    const plain = parseHlsPlaylist(master('#EXT-X-STREAM-INF:BANDWIDTH=1000000\nv.m3u8'), BASE);
    expect(plain.audio).toBeUndefined();
    expect(plain.variants[0]?.audioGroup).toBeUndefined();

    const media = parseHlsPlaylist(
      '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\ns0.ts\n#EXT-X-ENDLIST\n',
      BASE,
    );
    expect(media.audio).toBeUndefined();
  });

  it('SPEC-0014:UT-01 só TYPE=AUDIO entra (SUBTITLES, VIDEO e CLOSED-CAPTIONS não); audioGroup vale mesmo quando o grupo não tem faixa com URI', () => {
    const text = master(
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s1",NAME="Legendas",LANGUAGE="pt",URI="subs.m3u8"',
      '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="vv",NAME="Câmera 2",URI="cam2.m3u8"',
      '#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID="cc",NAME="CC",INSTREAM-ID="CC1"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="a1"\nv.m3u8',
    );

    const info = parseHlsPlaylist(text, BASE);

    expect(info.audio).toBeUndefined();
    expect(info.variants[0]?.audioGroup).toBe('a1');
  });

  it('SPEC-0014:UT-01 a fixture master de split-av descreve o que o E2E espera (English, DEFAULT, audio.m3u8, grupo a1)', () => {
    const text = readFileSync(
      resolve(import.meta.dirname, '../../e2e/fixtures/hls/split-av/master.m3u8'),
      'utf8',
    );

    const info = parseHlsPlaylist(text, 'http://127.0.0.1:1/hls/split-av/master.m3u8');

    expect(info.audio).toEqual([
      {
        index: 0,
        groupId: 'a1',
        name: 'English',
        language: 'en',
        default: true,
        url: 'http://127.0.0.1:1/hls/split-av/audio.m3u8',
      },
    ]);
    expect(info.variants[0]).toMatchObject({ audioGroup: 'a1', width: 320, height: 180 });
  });
});

describe('parseHlsPlaylist: faixas de áudio hostis', () => {
  it('SPEC-0014:UT-02 NAME de 10 mil caracteres é truncado em 80', () => {
    const text = master(
      track(`NAME="${'A'.repeat(10_000)}",DEFAULT=YES,URI="a.m3u8"`),
      STREAMS('a1'),
    );

    const [first] = audioOf(text);

    expect(first?.name).toHaveLength(80);
    expect(first?.name).toBe('A'.repeat(80));
  });

  it('SPEC-0014:UT-02 NAME com caracteres de controle sai sem eles (o texto legível fica)', () => {
    const text = master(
      track('NAME="\u0007English\u0000 \u001bAudio\u007f\u0085",DEFAULT=YES,URI="a.m3u8"'),
      STREAMS('a1'),
    );

    const [first] = audioOf(text);

    expect(first?.name).not.toMatch(CONTROL);
    expect(first?.name.toLowerCase().replace(/[^a-z]/g, '')).toBe('englishaudio');
  });

  it('SPEC-0014:UT-02 vírgulas e apóstrofos dentro das aspas não quebram os atributos', () => {
    const text = master(
      track(`NAME="English, US (Dolby 5.1) o'clock",LANGUAGE="en-US",DEFAULT=YES,URI="a.m3u8"`),
      STREAMS('a1'),
    );

    const [first] = audioOf(text);

    expect(first).toMatchObject({
      name: "English, US (Dolby 5.1) o'clock",
      language: 'en-US',
      default: true,
      url: 'https://cdn.example.test/hls/a.m3u8',
    });
  });

  it('SPEC-0014:UT-02 LANGUAGE gigante fica com no máximo 16 caracteres', () => {
    const text = master(
      track(`NAME="English",LANGUAGE="${'x'.repeat(500)}",DEFAULT=YES,URI="a.m3u8"`),
      STREAMS('a1'),
    );

    const [first] = audioOf(text);

    expect(first?.name).toBe('English');
    expect((first?.language ?? '').length).toBeLessThanOrEqual(16);
  });

  it('SPEC-0014:UT-02 URI javascript:, data:, file:, vazia e faixa sem URI são descartadas; as válidas ficam e são renumeradas', () => {
    const text = master(
      track('NAME="Evil JS",URI="javascript:alert(1)"'),
      track('NAME="Evil data",URI="data:audio/mp4;base64,AAAA"'),
      track('NAME="Evil file",URI="file:///etc/passwd"'),
      track('NAME="Empty",URI=""'),
      track('NAME="Embedded",DEFAULT=YES'),
      track('NAME="Good",URI="good.m3u8"'),
      STREAMS('a1'),
    );

    const info = parseHlsPlaylist(text, BASE);

    expect(info.audio).toEqual([
      expect.objectContaining({
        index: 0,
        name: 'Good',
        url: 'https://cdn.example.test/hls/good.m3u8',
      }),
    ]);
  });

  it('SPEC-0014:UT-02 só faixas inválidas: audio ausente (a master continua válida)', () => {
    const text = master(
      track('NAME="Evil",URI="javascript:alert(1)"'),
      track('NAME="Embedded",DEFAULT=YES'),
      STREAMS('a1'),
    );

    const info = parseHlsPlaylist(text, BASE);

    expect(info.type).toBe('master');
    expect(info.audio).toBeUndefined();
    expect(info.variants.map((v) => v.audioGroup)).toEqual(['a1', 'a1']);
  });

  it('SPEC-0014:UT-02 30 faixas: no máximo 20, as 20 primeiras na ordem do arquivo, index 0..19', () => {
    const tracks = Array.from({ length: 30 }, (_v, i) =>
      track(`NAME="Faixa ${String(i)}",LANGUAGE="l${String(i)}",URI="a${String(i)}.m3u8"`),
    );
    const text = master(...tracks, STREAMS('a1'));

    const audio = audioOf(text);

    expect(audio).toHaveLength(20);
    expect(audio.map((t) => t.index)).toEqual(Array.from({ length: 20 }, (_v, i) => i));
    expect(audio.map((t) => t.name)).toEqual(
      Array.from({ length: 20 }, (_v, i) => `Faixa ${String(i)}`),
    );
  });

  it('SPEC-0014:UT-02 fuzz: nenhuma combinação de lixo em EXT-X-MEDIA lança ou devolve faixa fora do contrato', () => {
    const junk = [
      'NAME="',
      'NAME=,URI=',
      `URI="${'../'.repeat(500)}x.m3u8"`,
      'GROUP-ID=,NAME="x",URI="a.m3u8"',
      'TYPE=AUDIO,TYPE=AUDIO,URI="a.m3u8",URI="b.m3u8"',
      'NAME="\u0000\u0000",URI="http://[::1"',
      'DEFAULT=YES,URI="a.m3u8"',
    ];
    for (const attributes of junk) {
      const text = master(
        `#EXT-X-MEDIA:TYPE=AUDIO,${attributes}`,
        track('NAME="Ok",URI="ok.m3u8"'),
        STREAMS('a1'),
      );
      let audio: HlsAudioTrack[] = [];
      expect(() => {
        audio = audioOf(text);
      }, attributes).not.toThrow();
      expect(
        audio.map((t) => t.name),
        attributes,
      ).toContain('Ok');
      for (const t of audio) {
        expect(t.name.length, attributes).toBeLessThanOrEqual(80);
        expect(t.name, attributes).not.toMatch(CONTROL);
        expect(t.url, attributes).toMatch(/^https?:\/\//);
      }
    }
  });
});
