/**
 * SPEC-0006:UT-02 — cliente mínimo da Chrome Web Store API v2 com `fetch` injetado (dublê em helpers.ts).
 *
 * Contrato (scripts/release/webstore.ts). Base https://chromewebstore.googleapis.com; escopo OAuth
 * https://www.googleapis.com/auth/chromewebstore; creds = { clientId, clientSecret, refreshToken,
 * publisherId, extensionId } (CLI: CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN,
 * CWS_PUBLISHER_ID, CWS_EXTENSION_ID).
 *  - token  : POST https://oauth2.googleapis.com/token, form grant_type=refresh_token, client_id,
 *             client_secret, refresh_token → { access_token }. Cada `upload`/`publish` troca o token.
 *  - upload : POST /upload/v2/publishers/{publisherId}/items/{itemId}:upload, corpo = bytes do zip,
 *             `Authorization: Bearer <token>` → { name, uploadState, crxVersion, itemId }.
 *             SUCCEEDED → devolve o resultado; IN_PROGRESS → consulta
 *             GET /v2/publishers/{publisherId}/items/{itemId}:fetchStatus (campo `lastAsyncUploadState`)
 *             a cada `pollIntervalMs` (via deps.sleep) até SUCCEEDED/FAILED ou até `pollTimeoutMs`
 *             (medido por deps.now) → Error de timeout; FAILED/NOT_FOUND/UPLOAD_STATE_UNSPECIFIED
 *             lançam Error com o estado e a mensagem da API.
 *  - publish: POST /v2/publishers/{publisherId}/items/{itemId}:publish, JSON { publishType } →
 *             { state, itemId, name }; sucesso = PENDING_REVIEW, STAGED, PUBLISHED, PUBLISHED_TO_TESTERS;
 *             REJECTED/CANCELLED/ITEM_STATE_UNSPECIFIED lançam Error com o estado.
 *  - `publishTypeFor(version)`: `-rc.N` → STAGED_PUBLISH; estável → DEFAULT_PUBLISH.
 *  - HTTP não-2xx (token ou API) lança Error com o status e a mensagem da API, verbatim (o erro exato
 *    de "versão já enviada" não é documentado: não há código próprio, só a mensagem da API é repassada).
 *  - Nenhum Error contém clientSecret/refreshToken/access token (mesmo que a API os ecoe).
 *  - `releaseToStore(zip, version, creds, deps)` = upload; se bem-sucedido, publish com
 *    `publishTypeFor(version)`; se o upload falhar, publish nunca é chamado.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publish, publishTypeFor, releaseToStore, upload } from '../../scripts/release/webstore.ts';
import { ACCESS_TOKEN, CREDS, fakeClock, fakeCws, tmp } from './helpers';

const ITEM = `/publishers/${CREDS.publisherId}/items/${CREDS.extensionId}`;

function makeZip(): string {
  const p = join(tmp(), 'extension-public-0.1.0.zip');
  writeFileSync(p, Buffer.from('PK\u0003\u0004fake-zip-content'));
  return p;
}

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected promise to reject');
}

function deps(api: { fetch: typeof fetch }) {
  const clock = fakeClock();
  return { fetch: api.fetch, ...clock, pollIntervalMs: 100, pollTimeoutMs: 1000 };
}

function expectNoSecrets(err: Error) {
  for (const secret of [CREDS.clientSecret, CREDS.refreshToken, ACCESS_TOKEN]) {
    expect(err.message).not.toContain(secret);
  }
}

describe('SPEC-0006:UT-02 publishTypeFor', () => {
  it('SPEC-0006:UT-02 rc → STAGED_PUBLISH; estável → DEFAULT_PUBLISH', () => {
    expect(publishTypeFor('0.1.0-rc.1')).toBe('STAGED_PUBLISH');
    expect(publishTypeFor('2.3.4-rc.12')).toBe('STAGED_PUBLISH');
    expect(publishTypeFor('0.1.0')).toBe('DEFAULT_PUBLISH');
    expect(publishTypeFor('10.0.1')).toBe('DEFAULT_PUBLISH');
  });
});

describe('SPEC-0006:UT-02 upload', () => {
  it('SPEC-0006:UT-02 SUCCEEDED: troca o refresh token, envia o zip e devolve o resultado', async () => {
    const zip = makeZip();
    const api = fakeCws({});
    const res = await upload(zip, CREDS, deps(api));
    expect(res.uploadState).toBe('SUCCEEDED');
    expect(res.crxVersion).toBe('0.1.0');

    const [tok] = api.of('token');
    const form = new URLSearchParams(new TextDecoder().decode(tok?.body));
    expect(tok?.method).toBe('POST');
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('client_id')).toBe(CREDS.clientId);
    expect(form.get('client_secret')).toBe(CREDS.clientSecret);
    expect(form.get('refresh_token')).toBe(CREDS.refreshToken);

    expect(api.of('upload')).toHaveLength(1);
    const [up] = api.of('upload');
    expect(up?.method).toBe('POST');
    expect(up?.url.origin).toBe('https://chromewebstore.googleapis.com');
    expect(up?.url.pathname).toBe(`/upload/v2${ITEM}:upload`);
    expect(up?.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(Buffer.from(up?.body ?? []).equals(readFileSync(zip))).toBe(true);
    expect(api.of('status')).toHaveLength(0);
  });

  it('SPEC-0006:UT-02 FAILED falha com o estado e a mensagem da API', async () => {
    const api = fakeCws({
      upload: { json: { uploadState: 'FAILED', message: 'The zip is malformed.' } },
    });
    const err = await rejection(upload(makeZip(), CREDS, deps(api)));
    expect(err.message).toContain('FAILED');
    expect(err.message).toContain('The zip is malformed.');
    expectNoSecrets(err);
  });

  it.each(['NOT_FOUND', 'UPLOAD_STATE_UNSPECIFIED'])('SPEC-0006:UT-02 %s falha', async (state) => {
    const api = fakeCws({ upload: { json: { uploadState: state } } });
    const err = await rejection(upload(makeZip(), CREDS, deps(api)));
    expect(err.message).toContain(state);
  });

  it('SPEC-0006:UT-02 IN_PROGRESS consulta fetchStatus até SUCCEEDED', async () => {
    const api = fakeCws({
      upload: { json: { uploadState: 'IN_PROGRESS', itemId: CREDS.extensionId } },
      status: [
        { json: { lastAsyncUploadState: 'IN_PROGRESS' } },
        { json: { lastAsyncUploadState: 'IN_PROGRESS' } },
        { json: { lastAsyncUploadState: 'SUCCEEDED' } },
      ],
    });
    const res = await upload(makeZip(), CREDS, deps(api));
    expect(res.uploadState).toBe('SUCCEEDED');
    const polls = api.of('status');
    expect(polls).toHaveLength(3);
    for (const call of polls) {
      expect(call.method).toBe('GET');
      expect(call.url.pathname).toBe(`/v2${ITEM}:fetchStatus`);
      expect(call.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    }
  });

  it('SPEC-0006:UT-02 IN_PROGRESS seguido de FAILED no fetchStatus falha', async () => {
    const api = fakeCws({
      upload: { json: { uploadState: 'IN_PROGRESS' } },
      status: [
        { json: { lastAsyncUploadState: 'IN_PROGRESS' } },
        { json: { lastAsyncUploadState: 'FAILED' } },
      ],
    });
    const err = await rejection(upload(makeZip(), CREDS, deps(api)));
    expect(err.message).toContain('FAILED');
  });

  it('SPEC-0006:UT-02 IN_PROGRESS para sempre → erro de timeout (sem esperar de verdade)', async () => {
    const api = fakeCws({
      upload: { json: { uploadState: 'IN_PROGRESS' } },
      status: { json: { lastAsyncUploadState: 'IN_PROGRESS' } },
    });
    const err = await rejection(upload(makeZip(), CREDS, deps(api)));
    expect(err.message).toMatch(/time(d)? ?out/i);
    expect(api.of('status').length).toBeGreaterThan(0);
    expect(api.of('status').length).toBeLessThanOrEqual(20);
  });

  it('SPEC-0006:UT-02 401 da API falha com status e mensagem da API', async () => {
    const api = fakeCws({
      upload: { status: 401, json: { error: { code: 401, message: 'Invalid Credentials' } } },
    });
    const err = await rejection(upload(makeZip(), CREDS, deps(api)));
    expect(err.message).toContain('401');
    expect(err.message).toContain('Invalid Credentials');
    expectNoSecrets(err);
  });

  it.each([400, 409])(
    'SPEC-0006:UT-02 %i "versão já enviada" repassa a mensagem da API verbatim',
    async (status) => {
      const message = 'Version 0.1.0 was already uploaded; the version must be greater.';
      const api = fakeCws({ upload: { status, json: { error: { code: status, message } } } });
      const err = await rejection(upload(makeZip(), CREDS, deps(api)));
      expect(err.message).toContain(String(status));
      expect(err.message).toContain(message);
      expectNoSecrets(err);
    },
  );

  it('SPEC-0006:UT-02 FAILED com mensagem de versão já enviada também a repassa', async () => {
    const message = 'Version 0.1.0 was already uploaded.';
    const api = fakeCws({ upload: { json: { uploadState: 'FAILED', message } } });
    const err = await rejection(upload(makeZip(), CREDS, deps(api)));
    expect(err.message).toContain(message);
  });

  it('SPEC-0006:UT-02 erro do endpoint de token falha sem vazar segredos', async () => {
    const api = fakeCws({
      token: {
        status: 400,
        json: {
          error: 'invalid_grant',
          error_description: `Token ${CREDS.refreshToken} has been expired or revoked (${CREDS.clientSecret}).`,
        },
      },
    });
    const err = await rejection(upload(makeZip(), CREDS, deps(api)));
    expect(err.message).toContain('invalid_grant');
    expectNoSecrets(err);
    expect(api.of('upload')).toHaveLength(0);
  });
});

describe('SPEC-0006:UT-02 publish', () => {
  it.each(['STAGED_PUBLISH', 'DEFAULT_PUBLISH'] as const)(
    'SPEC-0006:UT-02 envia publishType=%s',
    async (type) => {
      const api = fakeCws({});
      const res = await publish(type, CREDS, deps(api));
      expect(res.state).toBe('PENDING_REVIEW');
      expect(api.of('publish')).toHaveLength(1);
      const [call] = api.of('publish');
      expect(call?.method).toBe('POST');
      expect(call?.url.origin).toBe('https://chromewebstore.googleapis.com');
      expect(call?.url.pathname).toBe(`/v2${ITEM}:publish`);
      expect(call?.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(call?.headers.get('content-type')).toContain('application/json');
      expect(JSON.parse(new TextDecoder().decode(call?.body))).toEqual({ publishType: type });
    },
  );

  it.each(['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS'])(
    'SPEC-0006:UT-02 estado %s conta como sucesso',
    async (state) => {
      const api = fakeCws({ publish: { json: { state, itemId: CREDS.extensionId } } });
      const res = await publish('DEFAULT_PUBLISH', CREDS, deps(api));
      expect(res.state).toBe(state);
    },
  );

  it.each(['REJECTED', 'CANCELLED', 'ITEM_STATE_UNSPECIFIED'])(
    'SPEC-0006:UT-02 estado %s lança',
    async (state) => {
      const api = fakeCws({ publish: { json: { state, itemId: CREDS.extensionId } } });
      const err = await rejection(publish('DEFAULT_PUBLISH', CREDS, deps(api)));
      expect(err.message).toContain(state);
      expectNoSecrets(err);
    },
  );

  it('SPEC-0006:UT-02 4xx falha com a mensagem da API', async () => {
    const api = fakeCws({
      publish: {
        status: 403,
        json: { error: { code: 403, message: 'The caller does not have permission' } },
      },
    });
    const err = await rejection(publish('DEFAULT_PUBLISH', CREDS, deps(api)));
    expect(err.message).toContain('403');
    expect(err.message).toContain('The caller does not have permission');
    expectNoSecrets(err);
  });
});

describe('SPEC-0006:UT-02 releaseToStore', () => {
  async function publishBody(version: string) {
    const api = fakeCws({});
    await releaseToStore(makeZip(), version, CREDS, deps(api));
    expect(api.of('upload')).toHaveLength(1);
    const [call] = api.of('publish');
    return JSON.parse(new TextDecoder().decode(call?.body)) as { publishType: string };
  }

  it('SPEC-0006:UT-02 rc usa STAGED_PUBLISH', async () => {
    expect(await publishBody('0.1.0-rc.1')).toEqual({ publishType: 'STAGED_PUBLISH' });
  });

  it('SPEC-0006:UT-02 estável usa DEFAULT_PUBLISH', async () => {
    expect(await publishBody('0.1.0')).toEqual({ publishType: 'DEFAULT_PUBLISH' });
  });

  it('SPEC-0006:UT-02 upload IN_PROGRESS → SUCCEEDED ainda publica', async () => {
    const api = fakeCws({
      upload: { json: { uploadState: 'IN_PROGRESS' } },
      status: { json: { lastAsyncUploadState: 'SUCCEEDED' } },
    });
    const res = await releaseToStore(makeZip(), '0.1.0', CREDS, deps(api));
    expect(res.state).toBe('PENDING_REVIEW');
    expect(api.of('publish')).toHaveLength(1);
  });

  it('SPEC-0006:UT-02 upload com FAILED não chega a publicar', async () => {
    const api = fakeCws({ upload: { json: { uploadState: 'FAILED', message: 'nope' } } });
    const err = await rejection(releaseToStore(makeZip(), '0.1.0', CREDS, deps(api)));
    expect(err.message).toContain('nope');
    expect(api.of('publish')).toHaveLength(0);
  });

  it('SPEC-0006:UT-02 upload 409 não chega a publicar', async () => {
    const api = fakeCws({
      upload: { status: 409, json: { error: { message: 'Version already uploaded' } } },
    });
    const err = await rejection(releaseToStore(makeZip(), '0.1.0', CREDS, deps(api)));
    expect(err.message).toContain('Version already uploaded');
    expect(api.of('publish')).toHaveLength(0);
  });

  it('SPEC-0006:UT-02 publish REJECTED após upload ok lança', async () => {
    const api = fakeCws({ publish: { json: { state: 'REJECTED' } } });
    const err = await rejection(releaseToStore(makeZip(), '0.1.0', CREDS, deps(api)));
    expect(err.message).toContain('REJECTED');
  });
});
