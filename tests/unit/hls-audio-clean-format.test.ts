/**
 * Contrato usado (SPEC-0014:UT-02; revisão M4): NAME/LANGUAGE da faixa de áudio saem sem caracteres de controle E
 * sem caracteres de formatação Unicode (`\p{Cf}`: sobreposição bidi U+202E/U+2066.., largura zero U+200B..), e com
 * espaços normalizados (sequências de espaços Unicode viram um único espaço; sem espaços nas pontas).
 */
import { describe, expect, it } from 'vitest';
import { parseHlsPlaylist } from '../../src/core/hls';

const BASE = 'https://cdn.example.test/hls/master.m3u8';
const master = (attributes: string): string =>
  `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",${attributes}\n#EXT-X-STREAM-INF:BANDWIDTH=3200000,AUDIO="a1"\nv.m3u8\n`;
const FORMAT = /\p{Cf}/u;

describe('parseHlsPlaylist: NAME/LANGUAGE sem caracteres de formatação (revisão M4)', () => {
  it('SPEC-0014:UT-02 NAME sem bidi (U+202E, U+2066, U+2069) nem largura zero (U+200B, U+FEFF)', () => {
    const [first] =
      parseHlsPlaylist(master('NAME="Eng‮lish⁦ Au​dio⁩﻿",DEFAULT=YES,URI="a.m3u8"'), BASE).audio ??
      [];

    expect(first?.name).not.toMatch(FORMAT);
    expect(first?.name).toBe('English Audio');
  });

  it('SPEC-0014:UT-02 LANGUAGE sem caracteres de formatação', () => {
    const [first] =
      parseHlsPlaylist(master('NAME="A",LANGUAGE="p​t-‮BR",URI="a.m3u8"'), BASE).audio ?? [];

    expect(first?.language).toBe('pt-BR');
  });

  it('SPEC-0014:UT-02 NAME normaliza espaços (NBSP, espaços largos, repetidos, pontas)', () => {
    const [first] =
      parseHlsPlaylist(master('NAME="  English    Audio   2 ",URI="a.m3u8"'), BASE).audio ?? [];

    expect(first?.name).toBe('English Audio 2');
  });

  it('SPEC-0014:UT-02 NAME só de caracteres invisíveis cai no nome padrão', () => {
    const [first] = parseHlsPlaylist(master('NAME="​‮ ⁦",URI="a.m3u8"'), BASE).audio ?? [];

    expect(first?.name).toBe('Audio');
  });
});
