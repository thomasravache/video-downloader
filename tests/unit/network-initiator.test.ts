/**
 * Contrato usado (SPEC-0016:UT-01):
 *  - entrypoints/background/network -> toNetworkResponse(details) repassa `details.initiator` CRU em
 *    `NetworkResponse.initiator` (ausente quando o navegador não informa);
 *  - src/core/service -> `onNetworkResponse(response)` grava o candidato com `initiatorOrigin` =
 *    `new URL(initiator).origin` quando o esquema é http(s) e não é a origem da própria extensão; senão o
 *    campo fica ausente (nunca "null", nunca caminho/query).
 */
import { describe, expect, it } from 'vitest';
import { toNetworkResponse } from '../../entrypoints/background/network';
import { candidateId } from '../../src/core/candidates';
import { createDiagnostics } from '../../src/core/diagnostics';
import { NetworkStore } from '../../src/core/network';
import { createService } from '../../src/core/service';

const SELF = 'abc';
const MEDIA = 'https://cdn.exemplo.test/hls/master.m3u8';

function setup() {
  const data = new Map<string, unknown>();
  const network = new NetworkStore({
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...data.keys()]),
  });
  const service = createService({
    extensionId: SELF,
    providers: [],
    scripting: { collectVideos: () => Promise.resolve([]) },
    downloads: { download: () => Promise.resolve(1) },
    tabs: { getUrl: () => Promise.resolve(undefined) },
    permissions: { contains: () => Promise.resolve(false), request: () => Promise.resolve(false) },
    diagnostics: createDiagnostics(),
    network,
  });
  return { service, network };
}

async function observe(initiator: string | undefined, url = MEDIA) {
  const { service, network } = setup();
  await service.onNetworkResponse({
    url,
    method: 'GET',
    statusCode: 200,
    tabId: 1,
    frameId: 3,
    contentType: 'application/vnd.apple.mpegurl',
    ...(initiator !== undefined && { initiator }),
  });
  const [candidate] = await network.forTab(1);
  expect(candidate?.id).toBe(candidateId(1, url));
  return candidate;
}

describe('iniciador da requisição de rede', () => {
  it('SPEC-0016:UT-01 initiator https://player.exemplo.test vira initiatorOrigin https://player.exemplo.test', async () => {
    expect((await observe('https://player.exemplo.test'))?.initiatorOrigin).toBe(
      'https://player.exemplo.test',
    );
  });

  it('SPEC-0016:UT-01 initiator com caminho e query: só esquema+host+porta (http://x.test:8080)', async () => {
    expect((await observe('http://x.test:8080/caminho?q=1'))?.initiatorOrigin).toBe(
      'http://x.test:8080',
    );
  });

  it('SPEC-0016:UT-01 initiator da extensão (chrome-extension://) fica ausente', async () => {
    for (const initiator of [
      'chrome-extension://abc',
      `chrome-extension://${SELF}/offscreen.html`,
    ]) {
      const candidate = await observe(initiator);
      expect(candidate, initiator).toBeDefined();
      expect(candidate && 'initiatorOrigin' in candidate, initiator).toBe(false);
    }
  });

  it('SPEC-0016:UT-01 initiator "null", ausente, vazio ou de esquema não-http(s) fica ausente', async () => {
    for (const initiator of [
      'null',
      undefined,
      '',
      'file:///tmp/a.html',
      'data:text/html,x',
      'lixo',
    ]) {
      const candidate = await observe(initiator);
      expect(candidate, String(initiator)).toBeDefined();
      expect(candidate && 'initiatorOrigin' in candidate, String(initiator)).toBe(false);
    }
  });

  it('SPEC-0016:UT-01 toNetworkResponse repassa details.initiator cru e não inventa o campo quando falta', () => {
    const base = { url: MEDIA, method: 'GET', statusCode: 200, tabId: 1, frameId: 3 };

    expect(
      toNetworkResponse({ ...base, initiator: 'http://x.test:8080/caminho?q=1' }).initiator,
    ).toBe('http://x.test:8080/caminho?q=1');
    expect('initiator' in toNetworkResponse(base)).toBe(false);
  });
});
