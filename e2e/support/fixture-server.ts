import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
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

/** Servidor estático de e2e/fixtures/, escutando APENAS em 127.0.0.1 (porta efêmera). */
export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
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
  });

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, HOST, done);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fixture server sem porta');
  }
  return {
    url: `http://${HOST}:${String(address.port)}/`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => {
          done();
        });
      }),
  };
}
