/**
 * Servidor HLS local que só atende com o contexto do player (SPEC-0016:E2E-01/E2E-02). Só harness.
 *
 * Simula uma CDN: serve e2e/fixtures/hls/clip em `<url>clip/...` e RESPONDE 403 a menos que o `Origin` seja
 * exatamente `allowedOrigin` (a origem do iframe do player) e o `Referer` seja `allowedOrigin + '/'`. Escuta
 * em 127.0.0.1 e ::1 (mesma porta) e é acessado por `localhost`; devolve `access-control-allow-origin` com a
 * origem permitida (a página do player busca dele de outra origem). Registra TODA requisição com os
 * cabeçalhos de contexto recebidos (nunca o valor de Cookie).
 *
 * Modos:
 *  - 'enforce': atende toda requisição com o contexto certo (a da página e a da extensão com a regra);
 *  - 'expire-after-first': token de uso único: a 1ª requisição de cada caminho (a da página) com o contexto
 *    certo é atendida; TODAS as seguintes, mesmo com o contexto certo, recebem 403 (token expirado).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { join, normalize, resolve } from 'node:path';

const CLIP_DIR = resolve(import.meta.dirname, '../fixtures/hls/clip');

const TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  mpegts: 'video/mp2t',
  m4s: 'video/mp4',
  mp4: 'video/mp4',
};

export interface ContextRequest {
  /** Caminho sem a query. */
  path: string;
  origin: string | undefined;
  referer: string | undefined;
  hasCookie: boolean;
  status: number;
}

export interface ContextHlsServer {
  /** 'http://localhost:<porta>/' */
  url: string;
  requests: ContextRequest[];
  close(): Promise<void>;
}

export interface ContextHlsOptions {
  /** A origem do iframe do player, p.ex. 'http://localhost:5173'. */
  allowedOrigin: string;
  mode: 'enforce' | 'expire-after-first';
}

export async function startContextHlsServer(options: ContextHlsOptions): Promise<ContextHlsServer> {
  const { allowedOrigin, mode } = options;
  const requests: ContextRequest[] = [];
  const served = new Set<string>();
  const sockets = new Set<import('node:net').Socket>();

  const handler: Parameters<typeof createServer>[1] = (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const header = (name: string): string | undefined => {
      const value = req.headers[name];
      return typeof value === 'string' ? value : undefined;
    };
    const respond = (status: number, headers: Record<string, string | number> = {}): void => {
      requests.push({
        path: pathname,
        origin: header('origin'),
        referer: header('referer'),
        hasCookie: header('cookie') !== undefined,
        status,
      });
      res.writeHead(status, { 'access-control-allow-origin': allowedOrigin, ...headers });
    };

    const contextOk =
      header('origin') === allowedOrigin && header('referer') === `${allowedOrigin}/`;
    const expired = mode === 'expire-after-first' && served.has(pathname);
    const file = join(CLIP_DIR, normalize(pathname.replace(/^\/clip\//, '')));
    if (!contextOk || expired) {
      respond(403, { 'content-type': 'text/plain', 'content-length': 9 });
      res.end('forbidden');
      return;
    }
    if (
      !pathname.startsWith('/clip/') ||
      !file.startsWith(CLIP_DIR) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    ) {
      respond(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    served.add(pathname);
    respond(200, {
      'content-type': TYPES[file.slice(file.lastIndexOf('.') + 1)] ?? 'application/octet-stream',
      'content-length': statSync(file).size,
    });
    createReadStream(file).pipe(res);
  };

  const server: Server = createServer(handler);
  const track = (target: Server): void => {
    target.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
  };
  track(server);
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('servidor de contexto sem porta');
  }
  // `localhost` pode resolver para ::1 primeiro; melhor esforço, como em fixture-server.ts.
  const server6: Server = createServer(handler);
  track(server6);
  const listening6 = await new Promise<boolean>((done) => {
    server6.once('error', () => {
      done(false);
    });
    server6.listen(address.port, '::1', () => {
      done(true);
    });
  });
  const closeServer = (target: Server): Promise<void> =>
    new Promise<void>((done) => {
      target.close(() => {
        done();
      });
    });
  return {
    url: `http://localhost:${String(address.port)}/`,
    requests,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await Promise.all([closeServer(server), ...(listening6 ? [closeServer(server6)] : [])]);
    },
  };
}
