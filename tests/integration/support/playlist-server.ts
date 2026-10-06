/**
 * Servidor HTTP local real para os testes de playlist HLS (SPEC-0011:IT-01..IT-03). Não é teste.
 * Registra toda requisição recebida (caminho + query) para que os testes provem o que foi (ou não)
 * requisitado. Escuta só em 127.0.0.1, porta efêmera.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export const HLS_TYPE = 'application/vnd.apple.mpegurl';

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Requisição recebida: caminho + query e o cabeçalho `Range` (SPEC-0013), se houve. */
export interface RequestRecord {
  url: string;
  range: string | undefined;
  /** SPEC-0016: cabeçalhos de contexto recebidos (cru, como o servidor os viu). */
  origin: string | undefined;
  referer: string | undefined;
  /** Veio algum `Cookie`? (nunca o valor). */
  hasCookie: boolean;
  /** Status da resposta, preenchido quando ela termina. */
  status: number | undefined;
}

export interface PlaylistServer {
  /** 'http://127.0.0.1:<porta>' */
  origin: string;
  /** Caminho + query de cada requisição recebida, em ordem. */
  requests: string[];
  /** Mesmas requisições, com o cabeçalho `Range` de cada uma (SPEC-0013). */
  log: RequestRecord[];
  close(): Promise<void>;
}

/** Responde 200 com o corpo e o content-type dados. */
export function body(text: string, contentType = HLS_TYPE): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': contentType, 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };
}

/**
 * Como `rangeHandler` responde a um pedido com `Range` (SPEC-0013):
 *  - 'ok': 206 com o trecho e `Content-Range: bytes a-b/<total>`;
 *  - 'total-star': 206 correto, mas com `Content-Range: bytes a-b/*`;
 *  - 'ignore': ignora o `Range` e responde 200 com o arquivo inteiro;
 *  - 'wrong-content-range': 206 com o trecho certo, mas `Content-Range` de OUTRO intervalo (começa 1 byte depois);
 *  - 'no-content-range': 206 sem `Content-Range`.
 */
export type RangeMode = 'ok' | 'total-star' | 'ignore' | 'wrong-content-range' | 'no-content-range';

/** Arquivo servido com suporte a `Range` (um só intervalo `bytes=a-b`); sem `Range` responde 200 inteiro. */
export function rangeHandler(
  bytes: Uint8Array,
  { mode = 'ok', contentType = 'video/mp4' }: { mode?: RangeMode; contentType?: string } = {},
): Handler {
  return (req, res) => {
    const header = req.headers['range'];
    const match = typeof header === 'string' ? /^bytes=(\d+)-(\d+)$/.exec(header) : null;
    if (!match || mode === 'ignore') {
      res.writeHead(200, { 'content-type': contentType, 'content-length': bytes.byteLength });
      res.end(Buffer.from(bytes));
      return;
    }
    const from = Number(match[1]);
    const to = Math.min(Number(match[2]), bytes.byteLength - 1);
    const slice = Buffer.from(bytes.subarray(from, to + 1));
    const headers: Record<string, string | number> = {
      'content-type': contentType,
      'content-length': slice.byteLength,
    };
    if (mode === 'ok') {
      headers['content-range'] = `bytes ${String(from)}-${String(to)}/${String(bytes.byteLength)}`;
    } else if (mode === 'total-star') {
      headers['content-range'] = `bytes ${String(from)}-${String(to)}/*`;
    } else if (mode === 'wrong-content-range') {
      headers['content-range'] =
        `bytes ${String(from + 1)}-${String(to + 1)}/${String(bytes.byteLength)}`;
    }
    res.writeHead(206, headers);
    res.end(slice);
  };
}

/**
 * SPEC-0016: o servidor da CDN que só responde com o contexto do player. Responde 403 (sem corpo) a menos
 * que `Origin` seja exatamente `origin` e `Referer` seja `origin + '/'`; senão delega a `inner`.
 */
export function requireContext(origin: string, inner: Handler): Handler {
  return (req, res) => {
    if (req.headers['origin'] === origin && req.headers['referer'] === `${origin}/`) {
      inner(req, res);
      return;
    }
    res.writeHead(403, { 'content-type': 'text/plain', 'content-length': 9 });
    res.end('forbidden');
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
  const log: RequestRecord[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/';
    requests.push(url);
    const range = req.headers['range'];
    const header = (name: string): string | undefined => {
      const value = req.headers[name];
      return typeof value === 'string' ? value : undefined;
    };
    const record: RequestRecord = {
      url,
      range: typeof range === 'string' ? range : undefined,
      origin: header('origin'),
      referer: header('referer'),
      hasCookie: header('cookie') !== undefined,
      status: undefined,
    };
    log.push(record);
    res.on('finish', () => {
      record.status = res.statusCode;
    });
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
    log,
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
