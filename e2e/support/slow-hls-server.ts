/**
 * Servidor HLS local com atraso por segmento para o cancelamento (SPEC-0012:E2E-02). Só harness.
 *
 * Serve e2e/fixtures/hls/clip em `<url>clip/...` (loopback, porta efêmera, CORS aberto: a página de fixture
 * busca o master de outra origem). Segmentos de índice < `holdFrom` respondem na hora; os demais ficam
 * PENDURADOS (cabeçalhos enviados, corpo nunca) até o cliente fechar a conexão — assim o job fica
 * "em andamento" de forma determinística, sem depender de tempo, e o cancelamento é observável pelo
 * fechamento das conexões.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { join, normalize, resolve } from 'node:path';

const CLIP_DIR = resolve(import.meta.dirname, '../fixtures/hls/clip');
const HOST = '127.0.0.1';

const TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  mpegts: 'video/mp2t',
  m4s: 'video/mp4',
  mp4: 'video/mp4',
};

export interface SlowHlsServer {
  /** 'http://127.0.0.1:<porta>/' */
  url: string;
  /** Caminho + query de toda requisição recebida, em ordem. */
  requests: string[];
  /** Requisições de segmento recebidas até agora. */
  segmentRequests(): number;
  /** Segmentos pendurados (conexão ainda aberta). */
  held(): number;
  close(): Promise<void>;
}

export async function startSlowHlsServer(
  options: { holdFrom?: number } = {},
): Promise<SlowHlsServer> {
  const holdFrom = options.holdFrom ?? 1;
  const requests: string[] = [];
  let segments = 0;
  let held = 0;
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? '/');
    const pathname = decodeURIComponent(new URL(req.url ?? '/', `http://${HOST}`).pathname);
    const relative = normalize(pathname.replace(/^\/clip\//, ''));
    const file = join(CLIP_DIR, relative);
    if (
      !pathname.startsWith('/clip/') ||
      !file.startsWith(CLIP_DIR) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    ) {
      res.writeHead(404, { 'access-control-allow-origin': '*' }).end('not found');
      return;
    }
    const extension = file.slice(file.lastIndexOf('.') + 1);
    const headers = {
      'access-control-allow-origin': '*',
      'content-type': TYPES[extension] ?? 'application/octet-stream',
      'content-length': statSync(file).size,
    };
    const isSegment = extension === 'mpegts' || extension === 'm4s';
    if (isSegment) {
      segments += 1;
      const index = Number(/-(\d+)\.[a-z0-9]+$/.exec(file)?.[1] ?? 0);
      if (index >= holdFrom) {
        held += 1;
        res.writeHead(200, headers);
        res.flushHeaders();
        res.on('close', () => {
          held -= 1;
        });
        return;
      }
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, HOST, done);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('servidor lento sem porta');
  }
  return {
    url: `http://${HOST}:${String(address.port)}/`,
    requests,
    segmentRequests: () => segments,
    held: () => held,
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => {
          done();
        });
      }),
  };
}
