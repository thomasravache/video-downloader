import type { LogEntry } from './contracts';

/** ADR-0009: ring buffer de 500 entradas, só em memória, sem envio remoto. */
export const LOG_CAPACITY = 500;

type Level = LogEntry['level'];

export interface DiagnosticsOptions {
  capacity?: number;
  now?: () => Date;
  newId?: () => string;
}

export interface Counters {
  detections: number;
  downloadsStarted: number;
  downloadsFailed: number;
}

export type NetworkOutcome = 'file' | 'hls' | 'dash' | 'discarded';

export type HlsOutcome = 'resolved' | 'encrypted' | 'live' | 'failed';

/** Resultado de um job de download HLS (SPEC-0012): `done`, `canceled` ou o código do erro. */
export type JobOutcome = string;

export interface Diagnostics {
  newCorrelationId(): string;
  log(
    level: Level,
    event: string,
    correlationId: string,
    fields?: Record<string, unknown>,
  ): LogEntry;
  count(providerId: string, counter: keyof Counters): void;
  /** Contador local de respostas de rede por resultado (`file`/`hls`/`dash` ou `discarded`) — SPEC-0010. */
  countNetwork(outcome: NetworkOutcome): void;
  /** Contador local de playlists HLS por resultado (SPEC-0011). */
  countHls(outcome: HlsOutcome): void;
  /** Contador local de jobs de download por resultado (SPEC-0012). */
  countJob(outcome: JobOutcome): void;
  /** Entradas do ring buffer + uma entrada final `counters` com os contadores por provider. */
  snapshot(): LogEntry[];
}

/** Remove query string, fragmento e credenciais de toda URL encontrada no texto. */
export function redactUrls(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (url) =>
    url.replace(/[?#].*$/, '').replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1'),
  );
}

function clean(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return redactUrls(value);
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Error) {
    return redactUrls(value.message);
  }
  if (depth < 4 && Array.isArray(value)) {
    return (value as unknown[]).map((item) => clean(item, depth + 1));
  }
  if (depth < 4 && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clean(item, depth + 1)]),
    );
  }
  return undefined;
}

export function createDiagnostics(options: DiagnosticsOptions = {}): Diagnostics {
  const capacity = options.capacity ?? LOG_CAPACITY;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const entries: LogEntry[] = [];
  const counters = new Map<string, Counters>();
  const network = new Map<NetworkOutcome, number>();
  const hls = new Map<HlsOutcome, number>();
  const jobs = new Map<string, number>();

  return {
    newCorrelationId: newId,
    log(level, event, correlationId, fields = {}) {
      const entry: LogEntry = {
        ...(clean(fields) as Record<string, unknown>),
        ts: now().toISOString(),
        level,
        event,
        correlationId,
      };
      entries.push(entry);
      if (entries.length > capacity) {
        entries.shift();
      }
      return entry;
    },
    count(providerId, counter) {
      const current = counters.get(providerId) ?? {
        detections: 0,
        downloadsStarted: 0,
        downloadsFailed: 0,
      };
      current[counter] += 1;
      counters.set(providerId, current);
    },
    countNetwork(outcome) {
      network.set(outcome, (network.get(outcome) ?? 0) + 1);
    },
    countHls(outcome) {
      hls.set(outcome, (hls.get(outcome) ?? 0) + 1);
    },
    countJob(outcome) {
      jobs.set(outcome, (jobs.get(outcome) ?? 0) + 1);
    },
    snapshot() {
      return [
        ...entries,
        {
          ts: now().toISOString(),
          level: 'info',
          event: 'counters',
          correlationId: newId(),
          providers: Object.fromEntries(counters),
          ...(network.size > 0 && { network: Object.fromEntries(network) }),
          ...(hls.size > 0 && { hls: Object.fromEntries(hls) }),
          ...(jobs.size > 0 && { jobs: Object.fromEntries(jobs) }),
        },
      ];
    },
  };
}
