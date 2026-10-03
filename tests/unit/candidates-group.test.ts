/**
 * Contrato usado (SPEC-0015 §6): `groupCandidates(list): CandidateGroup[]` em src/core/candidates.ts, com
 * `CandidateGroup = { primary: VideoCandidate; related: VideoCandidate[] }`.
 *
 *  - para cada master HLS resolvida M (`kind: 'hls'` com `hls.type === 'master'`, na ordem da lista),
 *    `related(M)` = candidatos (a) `kind: 'hls'` com origem+caminho (sem query/fragmento) de uma variante
 *    (`hls.variants[].url`) ou faixa de áudio (`hls.audio[].url`) de M, ou (b) `kind: 'file'` com
 *    origem+caminho em `M.hls.mediaResources`;
 *  - um candidato entra em no máximo UM grupo (o da primeira master da lista que o reivindicar); a master
 *    nunca é `related` dela mesma;
 *  - os demais candidatos viram grupos de um elemento (`related: []`); nada some (exceto o ruído `blob:` da
 *    SPEC-0013, aplicado ANTES do agrupamento, como `hideRedundantCandidates`);
 *  - a ordem dos grupos é a do PRIMEIRO elemento de cada grupo na lista original; `related` preserva a
 *    ordem original; a entrada não é mutada.
 */
import { describe, expect, it } from 'vitest';
import { groupCandidates, hideRedundantCandidates } from '../../src/core/candidates';
import type { VideoCandidate } from '../../src/core/contracts';
import type { HlsAudioTrack, HlsInfo, HlsVariant } from '../../src/core/hls';

const CDN = 'https://cdn.example.test/curso/aula1';

function make(id: string, over: Partial<VideoCandidate> = {}): VideoCandidate {
  return {
    id,
    providerId: 'generic',
    tabId: 1,
    pageUrl: 'https://site.example.test/aula',
    mediaUrl: `${CDN}/${id}`,
    protection: 'none',
    support: 'downloadable',
    frameId: 0,
    frameUrl: 'https://site.example.test/aula',
    kind: 'file',
    source: 'network',
    ...over,
  };
}

const file = (name: string, query = ''): VideoCandidate =>
  make(name, { mediaUrl: `${CDN}/${name}${query}`, mimeType: 'video/mp4' });
const playlist = (name: string, query = ''): VideoCandidate =>
  make(name, { mediaUrl: `${CDN}/${name}${query}`, kind: 'hls' });

const variant = (index: number, name: string): HlsVariant => ({
  index,
  url: `${CDN}/${name}`,
  bandwidth: 1000 - index,
  label: `${String(index)}p`,
  audioGroup: 'a1',
});
const track = (index: number, name: string): HlsAudioTrack => ({
  index,
  groupId: 'a1',
  name: 'English',
  default: index === 0,
  url: `${CDN}/${name}`,
});

function masterOf(
  id: string,
  {
    variants,
    audio,
    mediaResources,
  }: { variants: string[]; audio: string[]; mediaResources?: string[] },
  over: Partial<VideoCandidate> = {},
): VideoCandidate {
  const hls: HlsInfo = {
    type: 'master',
    variants: variants.map((name, i) => variant(i, name)),
    audio: audio.map((name, i) => track(i, name)),
    ...(mediaResources !== undefined && { mediaResources }),
    encrypted: false,
    live: false,
    fmp4: true,
  };
  return { ...playlist(id), hls, ...over };
}

const ids = (list: VideoCandidate[]): string[] => list.map((c) => c.id);
const shape = (groups: ReturnType<typeof groupCandidates>): [string, string[]][] =>
  groups.map((g) => [g.primary.id, ids(g.related)]);
const total = (groups: ReturnType<typeof groupCandidates>): number =>
  groups.reduce((sum, g) => sum + 1 + g.related.length, 0);

const FILES = ['aula_1080p.mp4', 'aula_480p.mp4', 'aula_en_192k.mp4'];
const master = (over: Partial<VideoCandidate> = {}): VideoCandidate =>
  masterOf(
    'master.m3u8',
    {
      variants: ['aula_1080p.m3u8', 'aula_480p.m3u8'],
      audio: ['aula_en_192k.m3u8'],
      mediaResources: FILES.map((f) => `${CDN}/${f}`),
    },
    over,
  );

describe('groupCandidates: agrupar', () => {
  it('SPEC-0015:UT-01 master resolvida + 2 variantes, 1 áudio e 3 .mp4 citados: UM grupo, a master é a primary e os seis ficam em related na ordem original', () => {
    // A master aparece no meio, como na rede real: os redundantes antes e depois dela.
    const list = [
      file('aula_1080p.mp4'),
      playlist('aula_1080p.m3u8'),
      master(),
      file('aula_480p.mp4'),
      playlist('aula_480p.m3u8'),
      file('aula_en_192k.mp4'),
      playlist('aula_en_192k.m3u8'),
    ];

    const groups = groupCandidates(list);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary.id).toBe('master.m3u8');
    expect(ids(groups[0]?.related ?? [])).toEqual([
      'aula_1080p.mp4',
      'aula_1080p.m3u8',
      'aula_480p.mp4',
      'aula_480p.m3u8',
      'aula_en_192k.mp4',
      'aula_en_192k.m3u8',
    ]);
  });

  it('SPEC-0015:UT-01 a casa é origem+caminho: query e fragmento diferentes (tokens) não impedem o vínculo', () => {
    const list = [
      master(),
      file('aula_1080p.mp4', '?token=abc&expires=1'),
      playlist('aula_480p.m3u8', '?sig=zzz'),
    ];

    expect(shape(groupCandidates(list))).toEqual([
      ['master.m3u8', ['aula_1080p.mp4', 'aula_480p.m3u8']],
    ]);
  });

  it('SPEC-0015:UT-01 a posição do grupo é a do PRIMEIRO elemento dele; candidatos sem relação ficam onde estavam', () => {
    const list = [
      file('outro-a.mp4'),
      file('aula_1080p.mp4'),
      file('outro-b.mp4'),
      master(),
      playlist('aula_480p.m3u8'),
      file('outro-c.mp4'),
    ];

    expect(shape(groupCandidates(list))).toEqual([
      ['outro-a.mp4', []],
      ['master.m3u8', ['aula_1080p.mp4', 'aula_480p.m3u8']],
      ['outro-b.mp4', []],
      ['outro-c.mp4', []],
    ]);
  });

  it('SPEC-0015:UT-01 só vale a regra do tipo: um `file` no caminho de uma variante e um `hls` no caminho de um mediaResource NÃO entram no grupo', () => {
    const fileAtVariantPath = make('x', { mediaUrl: `${CDN}/aula_1080p.m3u8`, kind: 'file' });
    const hlsAtResourcePath = make('y', { mediaUrl: `${CDN}/aula_1080p.mp4`, kind: 'hls' });

    const groups = groupCandidates([master(), fileAtVariantPath, hlsAtResourcePath]);

    expect(shape(groups)).toEqual([
      ['master.m3u8', []],
      ['x', []],
      ['y', []],
    ]);
  });

  it('SPEC-0015:UT-01 master resolvida SEM mediaResources: só as playlists (variantes e áudio) são relacionadas; os .mp4 continuam soltos', () => {
    const bare = masterOf('master.m3u8', {
      variants: ['aula_1080p.m3u8'],
      audio: ['aula_en_192k.m3u8'],
    });

    const groups = groupCandidates([bare, playlist('aula_1080p.m3u8'), file('aula_1080p.mp4')]);

    expect(shape(groups)).toEqual([
      ['master.m3u8', ['aula_1080p.m3u8']],
      ['aula_1080p.mp4', []],
    ]);
  });
});

describe('groupCandidates: não agrupar', () => {
  it('SPEC-0015:UT-02 sem nenhuma master resolvida: todos viram grupos de um elemento, na mesma ordem, e a contagem é preservada', () => {
    const unresolved = playlist('master.m3u8');
    const media = {
      ...playlist('aula_1080p.m3u8'),
      hls: {
        type: 'media',
        variants: [],
        encrypted: false,
        live: false,
        fmp4: true,
      } satisfies HlsInfo,
    };
    const list = [unresolved, media, file('aula_1080p.mp4'), file('b.mp4')];

    const groups = groupCandidates(list);

    expect(shape(groups)).toEqual(list.map((c) => [c.id, []]));
    expect(total(groups)).toBe(list.length);
  });

  it('SPEC-0015:UT-02 candidatos de OUTRA origem ou de outro caminho não são relacionados, mesmo com o mesmo nome de arquivo', () => {
    const otherOrigin = make('o', {
      mediaUrl: 'https://outro.example.test/curso/aula1/aula_1080p.mp4',
    });
    const otherPath = make('p', {
      mediaUrl: 'https://cdn.example.test/curso/aula2/aula_1080p.mp4',
    });
    const otherPlaylist = make('q', {
      mediaUrl: 'https://cdn.example.test/curso/aula2/aula_480p.m3u8',
      kind: 'hls',
    });
    const list = [master(), otherOrigin, otherPath, otherPlaylist];

    const groups = groupCandidates(list);

    expect(shape(groups)).toEqual(list.map((c) => [c.id, []]));
    expect(total(groups)).toBe(4);
  });

  it('SPEC-0015:UT-02 lista vazia devolve lista vazia', () => {
    expect(groupCandidates([])).toEqual([]);
  });

  it('SPEC-0015:UT-02 a regra do blob da SPEC-0013 vale ANTES do agrupamento: o ruído some, o resto agrupa', () => {
    const blob = make('blob', {
      mediaUrl: 'blob:https://site.example.test/uuid',
      support: 'unsupported-stream',
      source: 'dom',
    });
    const list = [blob, master(), file('aula_1080p.mp4')];

    const groups = groupCandidates(list);

    expect(shape(groups)).toEqual([['master.m3u8', ['aula_1080p.mp4']]]);
    expect(groups.flatMap((g) => [g.primary, ...g.related])).toEqual(hideRedundantCandidates(list));
  });

  it('SPEC-0015:UT-02 blob sozinho (sem outra fonte) continua listado', () => {
    const blob = make('blob', {
      mediaUrl: 'blob:https://site.example.test/uuid',
      support: 'unsupported-stream',
      source: 'dom',
    });

    expect(shape(groupCandidates([blob]))).toEqual([['blob', []]]);
  });

  it('SPEC-0015:UT-02 não muta a entrada (lista e candidatos congelados) e não repete candidatos', () => {
    const list = [file('aula_1080p.mp4'), master(), playlist('aula_480p.m3u8'), file('z.mp4')];
    const frozen = structuredClone(list);
    for (const c of list) {
      Object.freeze(c);
    }
    Object.freeze(list);

    const groups = groupCandidates(list);

    expect(list).toEqual(frozen);
    const flat = groups.flatMap((g) => [g.primary, ...g.related]).map((c) => c.id);
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat.sort()).toEqual(list.map((c) => c.id).sort());
  });
});

describe('groupCandidates: duas masters', () => {
  const second = (over: Partial<VideoCandidate> = {}): VideoCandidate =>
    masterOf(
      'master-2.m3u8',
      {
        variants: ['aula_480p.m3u8', 'outra_720p.m3u8'],
        audio: ['aula_en_192k.m3u8'],
        mediaResources: [`${CDN}/aula_480p.mp4`, `${CDN}/outra_720p.mp4`],
      },
      over,
    );

  it('SPEC-0015:UT-03 arquivo e playlists citados pelas duas masters ficam só no grupo da PRIMEIRA (a da lista)', () => {
    const shared = [
      file('aula_480p.mp4'),
      playlist('aula_480p.m3u8'),
      playlist('aula_en_192k.m3u8'),
    ];
    const list = [
      master(),
      second(),
      ...shared,
      file('outra_720p.mp4'),
      playlist('outra_720p.m3u8'),
    ];

    const groups = groupCandidates(list);

    expect(shape(groups)).toEqual([
      ['master.m3u8', ['aula_480p.mp4', 'aula_480p.m3u8', 'aula_en_192k.m3u8']],
      ['master-2.m3u8', ['outra_720p.mp4', 'outra_720p.m3u8']],
    ]);
    expect(total(groups)).toBe(list.length);
  });

  it('SPEC-0015:UT-03 a primeira é a primeira master NA LISTA, não a primeira a ser resolvida: invertida a ordem, o arquivo vai para a outra', () => {
    const list = [second(), master(), file('aula_480p.mp4')];

    expect(shape(groupCandidates(list))).toEqual([
      ['master-2.m3u8', ['aula_480p.mp4']],
      ['master.m3u8', []],
    ]);
  });
});
