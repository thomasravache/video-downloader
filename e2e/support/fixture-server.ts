import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');
const HOST = '127.0.0.1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

/**
 * Servidor estático de e2e/fixtures/, escutando APENAS no loopback (127.0.0.1 e, se houver, ::1 na
 * mesma porta efêmera, pois `localhost` pode resolver para ::1 primeiro).
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const handler: RequestListener = (req, res) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', `http://${HOST}`).pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    const relative = normalize(pathname === '/' ? '/index.html' : pathname);
    const file = join(FIXTURES_DIR, relative);
    if (!file.startsWith(FIXTURES_DIR) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'content-length': statSync(file).size,
    });
    createReadStream(file).pipe(res);
  };
  const server: Server = createServer(handler);

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, HOST, done);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fixture server sem porta');
  }
  // Melhor esforço: sem IPv6 no ambiente, o navegador cai para 127.0.0.1.
  const server6: Server = createServer(handler);
  const listening6 = await new Promise<boolean>((done) => {
    server6.once('error', () => {
      done(false);
    });
    server6.listen(address.port, '::1', () => {
      done(true);
    });
  });
  const closeServer = (target: Server) =>
    new Promise<void>((done) => {
      target.close(() => {
        done();
      });
    });
  return {
    url: `http://${HOST}:${String(address.port)}/`,
    close: async () => {
      await Promise.all([closeServer(server), ...(listening6 ? [closeServer(server6)] : [])]);
    },
  };
}
