import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');
const HOST = '127.0.0.1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mpd': 'application/dash+xml',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

/** `bytes=a-b` | `bytes=a-` -> intervalo inclusivo dentro do arquivo; ausente/ilegível -> undefined. */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | undefined {
  const match = header === undefined ? null : /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start >= size || end < start ? 'unsatisfiable' : { start, end };
}

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
    const size = statSync(file).size;
    const contentType = MIME[extname(file)] ?? 'application/octet-stream';
    // SPEC-0013: `Range: bytes=a-b` (ou `a-`) responde 206 + Content-Range; faixa fora do arquivo, 416.
    // Sem o cabeçalho `Range` o comportamento é o de sempre (200, arquivo inteiro).
    const range = parseRange(req.headers.range, size);
    if (range === 'unsatisfiable') {
      res.writeHead(416, { 'content-range': `bytes */${String(size)}` }).end();
      return;
    }
    if (range) {
      res.writeHead(206, {
        'content-type': contentType,
        'content-length': range.end - range.start + 1,
        'content-range': `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
        'accept-ranges': 'bytes',
      });
      createReadStream(file, { start: range.start, end: range.end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': contentType, 'content-length': size });
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
