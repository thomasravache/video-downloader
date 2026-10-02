/**
 * Contrato usado (SPEC-0009:UT-04):
 *   src/core/access.ts -> PermissionsPort { contains(origins: string[]): Promise<boolean>;
 *                                           request(origins: string[]): Promise<boolean> }
 *                         requestAccess(port, origins: string[]): Promise<{ granted: boolean }>
 *   `origins` são ORIGENS ('https://host[:porta]'); a porta recebe os padrões 'origem/*'.
 */
import { describe, expect, it, vi } from 'vitest';
import { requestAccess } from '../../src/core/access';
import type { PermissionsPort } from '../../src/core/access';

const ORIGINS = ['https://player.example.test', 'http://localhost:8080'];
const PATTERNS = ['https://player.example.test/*', 'http://localhost:8080/*'];

function fakePort(request: PermissionsPort['request']) {
  const requestSpy = vi.fn(request);
  const containsSpy = vi.fn<PermissionsPort['contains']>().mockResolvedValue(false);
  const port: PermissionsPort = { contains: containsSpy, request: requestSpy };
  return { port, requestSpy, containsSpy };
}

describe('requestAccess', () => {
  it('SPEC-0009:UT-04 concedido pelo usuário devolve granted:true e pede os padrões origem/*', async () => {
    const { port, requestSpy } = fakePort(() => Promise.resolve(true));

    expect(await requestAccess(port, ORIGINS)).toEqual({ granted: true });
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith(PATTERNS);
  });

  it('SPEC-0009:UT-04 negado pelo usuário devolve granted:false', async () => {
    const { port, requestSpy } = fakePort(() => Promise.resolve(false));

    expect(await requestAccess(port, ORIGINS)).toEqual({ granted: false });
    expect(requestSpy).toHaveBeenCalledWith(PATTERNS);
  });

  it('SPEC-0009:UT-04 exceção da API devolve granted:false sem propagar o erro', async () => {
    const { port, requestSpy } = fakePort(() =>
      Promise.reject(new Error('gesto do usuário ausente')),
    );

    await expect(requestAccess(port, ORIGINS)).resolves.toEqual({ granted: false });
    expect(requestSpy).toHaveBeenCalledWith(PATTERNS);
  });

  it('SPEC-0009:UT-04 exceção síncrona da API também devolve granted:false', async () => {
    const { port } = fakePort(() => {
      throw new Error('API indisponível');
    });

    await expect(requestAccess(port, ORIGINS)).resolves.toEqual({ granted: false });
  });
});
