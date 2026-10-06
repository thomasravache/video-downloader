/**
 * SPEC-0017:UT-01 — Allowlist estrita de tags de chave HLS e classificação de segurança.
 */
import { describe, expect, it } from 'vitest';
import { classify } from '../../src/aes128/classify';
import { parseHlsPlaylist } from '../../src/core/hls';

const BASE_URL = 'https://cdn.example.test/hls/master.m3u8';

function playlistWithKey(keyTag: string, extra = ''): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:2',
    keyTag,
    '#EXTINF:2.0,',
    'segment0.ts',
    '#EXT-X-ENDLIST',
    extra,
  ].join('\n');
}

describe('SPEC-0017:UT-01 allowlist e classificação de chaves HLS', () => {
  it('SPEC-0017:UT-01 classify devolve aes128 para formatos permitidos na allowlist', () => {
    const validTags = [
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.test/key.bin"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0123456789abcdef0123456789abcdef',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",KEYFORMAT="identity"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",KEYFORMAT="identity",KEYFORMATVERSIONS="1"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0123456789abcdef0123456789abcdef,KEYFORMAT="identity",KEYFORMATVERSIONS="1"',
    ];

    for (const tag of validTags) {
      const text = playlistWithKey(tag);
      const verdict = classify(text, BASE_URL);
      expect(verdict.kind, `falhou para tag: ${tag}`).toBe('aes128');
    }
  });

  it('SPEC-0017:UT-01 classify devolve none para playlist sem chaves ou só com METHOD=NONE', () => {
    const plain = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:2',
      '#EXTINF:2.0,',
      'segment0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    expect(classify(plain, BASE_URL)).toEqual({ kind: 'none' });

    const noneTag = playlistWithKey('#EXT-X-KEY:METHOD=NONE');
    expect(classify(noneTag, BASE_URL)).toEqual({ kind: 'none' });
  });

  it('SPEC-0017:UT-01 classify devolve protected para tags hostis, atributos desconhecidos ou malformados', () => {
    const hostileTags = [
      '#EXT-X-KEY:method=aes-128,URI="key.bin"',
      '#EXT-X-KEY:METHOD="AES-128",URI="key.bin"',
      '#EXT-X-KEY:METHOD= AES-128 ,URI="key.bin"',
      '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"',
      '#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="key.bin"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",KEYFORMAT="com.apple.streamingkeydelivery"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",EXTRA="foo"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",METHOD=AES-128',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0123456789abcdef0123456789abcde', // 31 hex
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0123456789abcdef0123456789abcdef0', // 33 hex
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0123456789abcdef0123456789abcdef', // sem 0x
      '#EXT-X-KEY:METHOD=AES-128,URI="javascript:alert(1)"',
      '#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AA=="',
      '#EXT-X-KEY:METHOD=AES-128,URI="file:///etc/passwd"',
      '#EXT-X-KEY:URI="METHOD=NONE"',
      '#EXT-X-FAXS-CM',
    ];

    for (const tag of hostileTags) {
      const text = playlistWithKey(tag);
      const verdict = classify(text, BASE_URL);
      expect(verdict.kind, `esperava protected para tag: ${tag}`).toBe('protected');
    }
  });

  it('SPEC-0017:UT-01 classify devolve protected quando há mais de 8 chaves distintas', () => {
    const keys = Array.from(
      { length: 9 },
      (_, i) => `#EXT-X-KEY:METHOD=AES-128,URI="key${String(i)}.bin"`,
    );
    const segments = keys.map((k, i) => `${k}\n#EXTINF:2.0,\nseg${String(i)}.ts`).join('\n');
    const text = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n${segments}\n#EXT-X-ENDLIST`;

    const verdict = classify(text, BASE_URL);
    expect(verdict.kind).toBe('protected');
  });

  it('SPEC-0017:UT-01 sem a porta keyPolicy, parseHlsPlaylist mantém hasEncryptedKey marcando tudo como encrypted', () => {
    const validAes = playlistWithKey('#EXT-X-KEY:METHOD=AES-128,URI="key.bin"');
    const info = parseHlsPlaylist(validAes, BASE_URL);
    expect(info.encrypted).toBe(true);
    expect(info.aes128).toBeUndefined();

    const none = playlistWithKey('#EXT-X-KEY:METHOD=NONE');
    const infoNone = parseHlsPlaylist(none, BASE_URL);
    expect(infoNone.encrypted).toBe(false);
    expect(infoNone.aes128).toBeUndefined();
  });
});
