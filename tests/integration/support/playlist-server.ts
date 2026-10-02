/**
 * Servidor HTTP local real para os testes de playlist HLS (SPEC-0011:IT-01..IT-03). Não é teste.
 * Registra toda requisição recebida (caminho + query) para que os testes provem o que foi (ou não)
 * requisitado. Escuta só em 127.0.0.1, porta efêmera.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export const HLS_TYPE = 'application/vnd.apple.mpegurl';

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface PlaylistServer {
  /** 'http://127.0.0.1:<porta>' */
  origin: string;
  /** Caminho + query de cada requisição recebida, em ordem. */
  requests: string[];
  close(): Promise<void>;
}

/** Responde 200 com o corpo e o content-type dados. */
export function body(text: string, contentType = HLS_TYPE): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': contentType, 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };
}

export function redirect(location: string, status = 302): Handler {
  return (_req, res) => {
    res.writeHead(status, { location, 'content-length': 0 });
    res.end();
  };
}

/** Rotas por caminho (sem query); caminho desconhecido responde 404. */
export async function startPlaylistServer(
  routes: Record<string, Handler>,
): Promise<PlaylistServer> {
  const requests: string[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/';
    requests.push(url);
    const handler = routes[new URL(url, 'http://127.0.0.1').pathname];
    if (handler) {
      handler(req, res);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('servidor de playlists sem porta');
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
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
