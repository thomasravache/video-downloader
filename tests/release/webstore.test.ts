/**
 * SPEC-0006:UT-02 — cliente mínimo da Chrome Web Store API com `fetch` injetado (dublê em helpers.ts).
 *
 * Contrato (scripts/release/webstore.ts), endpoints da API v1.1 da loja:
 *  - token : POST https://oauth2.googleapis.com/token, form com grant_type=refresh_token,
 *            client_id, client_secret, refresh_token → { access_token }
 *  - upload: PUT  .../upload/chromewebstore/v1.1/items/<extensionId> (Authorization: Bearer, corpo = bytes do zip)
 *            → { uploadState: 'SUCCESS'|'FAILURE', itemError?: [{ error_code, error_detail }] }
 *  - publish: POST .../chromewebstore/v1.1/items/<extensionId>/publish?publishTarget=<target>
 *            → { status: string[], statusDetail?: string[] }; sucesso = 'OK' ou 'ITEM_PENDING_REVIEW';
 *            qualquer outro status lança Error com os statusDetail.
 *  - upload com FAILURE lança Error cuja mensagem inclui error_code e error_detail da API; se a falha é de
 *    versão já enviada (error_code `PKG_INVALID_VERSION_NUMBER`), o Error tem `code === 'VERSION_ALREADY_UPLOADED'`
 *    e mensagem clara contendo "already" e a versão/detalhe da API.
 *  - HTTP não-2xx (token ou API) lança Error com o status e a mensagem do corpo da API.
 *  - Nenhum Error contém clientSecret/refreshToken (mesmo que a API os ecoe).
 *  - `releaseToStore(zip, version, creds, deps)` = upload; se SUCCESS, publish com `publishTargetFor(version)`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  publish,
  publishTargetFor,
  releaseToStore,
  upload,
} from '../../scripts/release/webstore.ts';
import { ACCESS_TOKEN, CREDS, fakeCws, tmp } from './helpers';

function makeZip(): string {
  const p = join(tmp(), 'extension-public-0.1.0.zip');
  writeFileSync(p, Buffer.from('PK\u0003\u0004fake-zip-content'));
  return p;
}

async function rejection(p: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await p;
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error('expected promise to reject');
}

describe('SPEC-0006:UT-02 publishTargetFor', () => {
  it('SPEC-0006:UT-02 rc → trustedTesters; estável → default', () => {
    expect(publishTargetFor('0.1.0-rc.1')).toBe('trustedTesters');
    expect(publishTargetFor('2.3.4-rc.12')).toBe('trustedTesters');
    expect(publishTargetFor('0.1.0')).toBe('default');
    expect(publishTargetFor('10.0.1')).toBe('default');
  });
});

describe('SPEC-0006:UT-02 upload', () => {
  it('SPEC-0006:UT-02 sucesso: troca o refresh token, envia o zip e devolve SUCCESS', async () => {
    const zip = makeZip();
    const api = fakeCws({});
    const res = await upload(zip, CREDS, { fetch: api.fetch });
    expect(res.uploadState).toBe('SUCCESS');

    const [tok] = api.of('token');
    const form = new URLSearchParams(new TextDecoder().decode(tok?.body));
    expect(tok?.method).toBe('POST');
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('client_id')).toBe(CREDS.clientId);
    expect(form.get('client_secret')).toBe(CREDS.clientSecret);
    expect(form.get('refresh_token')).toBe(CREDS.refreshToken);

    const [up] = api.of('upload');
    expect(up?.method).toBe('PUT');
    expect(up?.url.pathname).toContain(`/items/${CREDS.extensionId}`);
    expect(up?.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(Buffer.from(up?.body ?? []).equals(readFileSync(zip))).toBe(true);
  });

  it('SPEC-0006:UT-02 FAILURE com itemError falha com código e mensagem da API', async () => {
    const api = fakeCws({
      upload: {
        json: {
          uploadState: 'FAILURE',
          itemError: [{ error_code: 'PKG_INVALID_ZIP', error_detail: 'The zip is malformed.' }],
        },
      },
    });
    const err = await rejection(upload(makeZip(), CREDS, { fetch: api.fetch }));
    expect(err.message).toContain('PKG_INVALID_ZIP');
    expect(err.message).toContain('The zip is malformed.');
  });

  it('SPEC-0006:UT-02 versão já enviada → mensagem clara, não silenciosa', async () => {
    const api = fakeCws({
      upload: {
        json: {
          uploadState: 'FAILURE',
          itemError: [
            {
              error_code: 'PKG_INVALID_VERSION_NUMBER',
              error_detail: 'Version 0.1.0 was already uploaded; the version must be greater.',
            },
          ],
        },
      },
    });
    const err = await rejection(upload(makeZip(), CREDS, { fetch: api.fetch }));
    expect(err.code).toBe('VERSION_ALREADY_UPLOADED');
    expect(err.message).toMatch(/already/i);
    expect(err.message).toContain('0.1.0');
  });

  it('SPEC-0006:UT-02 401 da API falha com status e mensagem da API', async () => {
    const api = fakeCws({
      upload: { status: 401, json: { error: { code: 401, message: 'Invalid Credentials' } } },
    });
    const err = await rejection(upload(makeZip(), CREDS, { fetch: api.fetch }));
    expect(err.message).toContain('401');
    expect(err.message).toContain('Invalid Credentials');
  });

  it('SPEC-0006:UT-02 erro do endpoint de token (refresh token revogado) falha sem vazar segredos', async () => {
    const api = fakeCws({
      token: {
        status: 400,
        json: {
          error: 'invalid_grant',
          error_description: `Token ${CREDS.refreshToken} has been expired or revoked (${CREDS.clientSecret}).`,
        },
      },
    });
    const err = await rejection(upload(makeZip(), CREDS, { fetch: api.fetch }));
    expect(err.message).toContain('invalid_grant');
    expect(err.message).not.toContain(CREDS.refreshToken);
    expect(err.message).not.toContain(CREDS.clientSecret);
    expect(api.of('upload')).toHaveLength(0);
  });
});

describe('SPEC-0006:UT-02 publish', () => {
  it.each(['trustedTesters', 'default'] as const)(
    'SPEC-0006:UT-02 envia publishTarget=%s',
    async (target) => {
      const api = fakeCws({});
      const res = await publish(target, CREDS, { fetch: api.fetch });
      expect(res.status).toEqual(['OK']);
      const [call] = api.of('publish');
      expect(call?.method).toBe('POST');
      expect(call?.url.pathname).toBe(`/chromewebstore/v1.1/items/${CREDS.extensionId}/publish`);
      expect(call?.url.searchParams.get('publishTarget')).toBe(target);
      expect(call?.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
    },
  );

  it('SPEC-0006:UT-02 ITEM_PENDING_REVIEW conta como sucesso', async () => {
    const api = fakeCws({ publish: { json: { status: ['ITEM_PENDING_REVIEW'] } } });
    const res = await publish('default', CREDS, { fetch: api.fetch });
    expect(res.status).toEqual(['ITEM_PENDING_REVIEW']);
  });

  it('SPEC-0006:UT-02 status de erro falha com o detalhe da API', async () => {
    const api = fakeCws({
      publish: { json: { status: ['NOT_AUTHORIZED'], statusDetail: ['Developer not allowed.'] } },
    });
    const err = await rejection(publish('default', CREDS, { fetch: api.fetch }));
    expect(err.message).toContain('NOT_AUTHORIZED');
    expect(err.message).toContain('Developer not allowed.');
  });

  it('SPEC-0006:UT-02 4xx falha com a mensagem da API', async () => {
    const api = fakeCws({
      publish: {
        status: 403,
        json: { error: { code: 403, message: 'The caller does not have permission' } },
      },
    });
    const err = await rejection(publish('default', CREDS, { fetch: api.fetch }));
    expect(err.message).toContain('403');
    expect(err.message).toContain('The caller does not have permission');
  });
});

describe('SPEC-0006:UT-02 releaseToStore', () => {
  it('SPEC-0006:UT-02 rc usa trustedTesters', async () => {
    const api = fakeCws({});
    await releaseToStore(makeZip(), '0.1.0-rc.1', CREDS, { fetch: api.fetch });
    expect(api.of('publish')[0]?.url.searchParams.get('publishTarget')).toBe('trustedTesters');
  });

  it('SPEC-0006:UT-02 estável usa default', async () => {
    const api = fakeCws({});
    await releaseToStore(makeZip(), '0.1.0', CREDS, { fetch: api.fetch });
    expect(api.of('publish')[0]?.url.searchParams.get('publishTarget')).toBe('default');
  });

  it('SPEC-0006:UT-02 upload com FAILURE não chega a publicar', async () => {
    const api = fakeCws({
      upload: {
        json: { uploadState: 'FAILURE', itemError: [{ error_code: 'X', error_detail: 'nope' }] },
      },
    });
    const err = await rejection(releaseToStore(makeZip(), '0.1.0', CREDS, { fetch: api.fetch }));
    expect(err.message).toContain('nope');
    expect(api.of('publish')).toHaveLength(0);
  });
});
