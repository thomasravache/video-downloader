/**
 * Orquestração dos jobs de download HLS no background (SPEC-0012). Estado em `storage.session` (sobrevive
 * à suspensão do service worker); toda alteração passa por uma fila única, então eventos do offscreen,
 * do `downloads.onChanged` e do popup nunca se atropelam.
 */
import type { Diagnostics } from '../diagnostics';
import type { DownloadPort, JobStoragePort, OffscreenPort, RequestContextLease } from '../ports';
import { JOB_ERRORS } from './errors';
import type { JobError } from './errors';
import { newJob, reduceJob } from './job';
import type { JobEvent, JobState } from './job';
import type { OffscreenAudio, OffscreenEvent, OffscreenStart } from './protocol';
import type { ByteRange } from './segments';

const JOBS_KEY = 'vd:jobs';
const MAX_ACTIVE_JOBS = 2;
const MAX_KEPT_TERMINAL = 20;

interface JobRecord {
  job: JobState;
  /** Nome planejado do arquivo (só vira `job.filename` ao salvar). */
  filename: string;
  providerId: string;
  correlationId: string;
  /** Ordem de criação, para descartar os terminais mais antigos. */
  seq: number;
  /** Blob URL do offscreen enquanto o arquivo está sendo entregue ao navegador. */
  blobUrl?: string;
}

type Records = Record<string, JobRecord>;

export interface JobPlan {
  candidateId: string;
  providerId: string;
  variantIndex: number;
  filename: string;
  correlationId: string;
  urls: string[];
  initUrl?: string;
  fmp4: boolean;
  ranges?: (ByteRange | undefined)[];
  initRange?: ByteRange;
  /** Faixa de áudio a juntar ao vídeo (SPEC-0014); o progresso soma as duas trilhas. */
  audio?: OffscreenAudio;
}

export type CreateJobResult =
  { ok: true; jobId: string } | { ok: false; error: 'JOB_ALREADY_RUNNING' | 'TOO_MANY_JOBS' };

export interface JobManagerDeps {
  store: JobStoragePort;
  offscreen: OffscreenPort;
  downloads: DownloadPort;
  diagnostics: Diagnostics;
  extensionId: string;
  newId?: () => string;
}

export interface JobManager {
  /**
   * `lease` (SPEC-0016): regra de contexto da página que cobre o job; passa a ser do job e é removida quando
   * ele deixa de buscar (montagem) ou termina (feito, falha, cancelado). Se a criação é recusada, fica com o chamador.
   */
  create(plan: JobPlan, lease?: RequestContextLease): Promise<CreateJobResult>;
  get(jobId: string): Promise<JobState | undefined>;
  cancel(jobId: string): Promise<boolean>;
  /** Mensagem `{target:'background', jobId, event}` vinda do offscreen. */
  onOffscreenMessage(message: unknown, sender: { id?: string; url?: string }): Promise<boolean>;
  /** `downloads.onChanged`. */
  onDownloadChanged(delta: {
    id: number;
    state?: { current?: string };
    error?: { current?: string };
  }): Promise<void>;
}

const isActive = (job: JobState): boolean =>
  job.state === 'queued' ||
  job.state === 'running' ||
  job.state === 'assembling' ||
  job.state === 'saving';

const OFFSCREEN_PAGE = '/offscreen.html';

/** Página do offscreen DESTA extensão (`<esquema>-extension://<id>/offscreen.html`). */
function isOffscreenUrl(url: string, extensionId: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol.endsWith('-extension:') &&
      parsed.host === extensionId &&
      parsed.pathname === OFFSCREEN_PAGE
    );
  } catch {
    return false;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJobError = (value: unknown): value is JobError =>
  typeof value === 'string' && (JOB_ERRORS as readonly string[]).includes(value);

function parseEvent(value: unknown): OffscreenEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  switch (value['type']) {
    case 'progress':
      return count(value['segmentsDone']) &&
        count(value['segmentsTotal']) &&
        count(value['bytesDone'])
        ? {
            type: 'progress',
            segmentsDone: value['segmentsDone'],
            segmentsTotal: value['segmentsTotal'],
            bytesDone: value['bytesDone'],
          }
        : undefined;
    case 'assembling':
      return { type: 'assembling' };
    case 'ready':
      return typeof value['blobUrl'] === 'string' &&
        value['blobUrl'].startsWith('blob:') &&
        count(value['bytes'])
        ? { type: 'ready', blobUrl: value['blobUrl'], bytes: value['bytes'] }
        : undefined;
    case 'failed':
      return isJobError(value['error']) ? { type: 'failed', error: value['error'] } : undefined;
    default:
      return undefined;
  }
}

export function createJobManager(deps: JobManagerDeps): JobManager {
  const { store, offscreen, downloads, diagnostics } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  let queue: Promise<unknown> = Promise.resolve();
  /** jobId -> regra de contexto da página enquanto o job busca mídia (só em memória; órfãs saem na partida). */
  const leases = new Map<string, RequestContextLease>();

  /** Remove a regra do job (idempotente); falha ao remover não derruba o job. */
  function releaseLease(jobId: string): void {
    const lease = leases.get(jobId);
    leases.delete(jobId);
    void lease?.release().catch(() => undefined);
  }

  async function load(): Promise<Records> {
    const stored = await store.get(JOBS_KEY);
    return isRecord(stored) ? (stored as unknown as Records) : {};
  }

  /** Serializa: carrega, executa `fn`, grava. Falha de `fn` não trava a fila. */
  function mutate<T>(fn: (records: Records) => Promise<T> | T): Promise<T> {
    const run = queue.then(async () => {
      const records = await load();
      try {
        return await fn(records);
      } finally {
        await store.set(JOBS_KEY, records);
      }
    });
    queue = run.catch(() => undefined);
    return run;
  }

  const hasActive = (records: Records): boolean =>
    Object.values(records).some((record) => isActive(record.job));

  function apply(record: JobRecord, event: JobEvent): void {
    record.job = reduceJob(record.job, event);
  }

  function log(
    level: 'info' | 'warn' | 'error',
    event: string,
    record: JobRecord,
    extra: Record<string, unknown> = {},
  ): void {
    diagnostics.log(level, event, record.correlationId, {
      jobId: record.job.jobId,
      candidateId: record.job.candidateId,
      providerId: record.providerId,
      state: record.job.state,
      ...extra,
    });
  }

  async function revoke(record: JobRecord): Promise<void> {
    const { blobUrl } = record;
    if (blobUrl === undefined) {
      return;
    }
    delete record.blobUrl;
    await offscreen
      .send({ target: 'offscreen', type: 'revoke', jobId: record.job.jobId, blobUrl })
      .catch(() => undefined);
  }

  /** Fecha o offscreen quando nenhum job precisa dele. */
  async function closeIfIdle(records: Records): Promise<void> {
    if (!hasActive(records)) {
      await offscreen.close().catch(() => undefined);
    }
  }

  function finish(record: JobRecord): void {
    releaseLease(record.job.jobId);
    const { state, error } = record.job;
    if (state === 'done') {
      diagnostics.countJob('done');
      log('info', 'job.done', record);
    } else if (state === 'canceled') {
      diagnostics.countJob('canceled');
      log('info', 'job.canceled', record);
    } else if (state === 'error') {
      diagnostics.countJob(error ?? 'error');
      log('warn', 'job.failed', record, { error });
    }
  }

  /** Falha o job ativo cujo documento offscreen sumiu (nada a revogar: a blob URL morreu com ele). */
  async function reclaimOrphans(records: Records): Promise<void> {
    const active = Object.values(records).filter((record) => isActive(record.job));
    if (active.length === 0 || (await isOffscreenOpen())) {
      return;
    }
    for (const record of active) {
      delete record.blobUrl;
      apply(record, { type: 'fail', error: 'ASSEMBLY_FAILED' });
      finish(record);
    }
  }

  /** Falha ao consultar é tratada como "aberto": não derruba job por engano. */
  async function isOffscreenOpen(): Promise<boolean> {
    try {
      return await offscreen.isOpen();
    } catch {
      return true;
    }
  }

  function prune(records: Records): void {
    const terminal = Object.entries(records)
      .filter(([, record]) => !isActive(record.job))
      .sort(([, a], [, b]) => b.seq - a.seq);
    for (const [id] of terminal.slice(MAX_KEPT_TERMINAL)) {
      Reflect.deleteProperty(records, id);
    }
  }

  return {
    create(plan, lease) {
      return mutate(async (records): Promise<CreateJobResult> => {
        await reclaimOrphans(records);
        const active = Object.values(records).filter((record) => isActive(record.job));
        if (active.some((record) => record.job.candidateId === plan.candidateId)) {
          return { ok: false, error: 'JOB_ALREADY_RUNNING' };
        }
        if (active.length >= MAX_ACTIVE_JOBS) {
          return { ok: false, error: 'TOO_MANY_JOBS' };
        }
        const jobId = newId();
        const seq =
          Object.values(records).reduce((max, record) => Math.max(max, record.seq), 0) + 1;
        const record: JobRecord = {
          job: reduceJob(
            newJob({
              jobId,
              candidateId: plan.candidateId,
              variantIndex: plan.variantIndex,
            }),
            { type: 'start', segmentsTotal: plan.urls.length + (plan.audio?.urls.length ?? 0) },
          ),
          filename: plan.filename,
          providerId: plan.providerId,
          correlationId: plan.correlationId,
          seq,
        };
        records[jobId] = record;
        if (lease !== undefined) {
          leases.set(jobId, lease);
        }
        prune(records);
        log('info', 'job.created', record, {
          segments: plan.urls.length + (plan.audio?.urls.length ?? 0),
          fmp4: plan.fmp4,
          audio: plan.audio !== undefined,
        });
        const start: OffscreenStart = {
          target: 'offscreen',
          type: 'start',
          jobId,
          urls: plan.urls,
          ...(plan.initUrl !== undefined && { initUrl: plan.initUrl }),
          fmp4: plan.fmp4,
          ...(plan.ranges !== undefined && { ranges: plan.ranges }),
          ...(plan.initUrl !== undefined &&
            plan.initRange !== undefined && { initRange: plan.initRange }),
          ...(plan.audio !== undefined && { audio: plan.audio }),
        };
        try {
          await offscreen.ensure();
          await offscreen.send(start);
        } catch {
          apply(record, { type: 'fail', error: 'ASSEMBLY_FAILED' });
          finish(record);
          await closeIfIdle(records);
        }
        return { ok: true, jobId };
      });
    },

    async get(jobId) {
      await queue;
      const job = (await load())[jobId]?.job;
      if (job === undefined || !isActive(job) || (await isOffscreenOpen())) {
        return job;
      }
      return mutate(async (records) => {
        await reclaimOrphans(records);
        return records[jobId]?.job;
      });
    },

    cancel(jobId) {
      return mutate(async (records) => {
        const record = records[jobId];
        if (!record) {
          return false;
        }
        if (!isActive(record.job)) {
          return true;
        }
        const { downloadId } = record.job;
        apply(record, { type: 'cancel' });
        finish(record);
        await offscreen.send({ target: 'offscreen', type: 'cancel', jobId }).catch(() => undefined);
        if (downloadId !== undefined) {
          try {
            await downloads.cancel?.(downloadId);
          } catch {
            // O download pode já ter terminado; cancelar é melhor esforço.
          }
        }
        await revoke(record);
        await closeIfIdle(records);
        return true;
      });
    },

    async onOffscreenMessage(message, sender) {
      if (
        sender.id !== deps.extensionId ||
        typeof sender.url !== 'string' ||
        !isOffscreenUrl(sender.url, deps.extensionId) ||
        !isRecord(message)
      ) {
        return false;
      }
      const jobId = message['jobId'];
      const event = parseEvent(message['event']);
      if (typeof jobId !== 'string' || event === undefined) {
        return false;
      }
      return mutate(async (records) => {
        const record = records[jobId];
        if (!record) {
          // Job desconhecido: o offscreen não deve continuar trabalhando para ele.
          await offscreen
            .send(
              event.type === 'ready'
                ? { target: 'offscreen', type: 'revoke', jobId, blobUrl: event.blobUrl }
                : { target: 'offscreen', type: 'cancel', jobId },
            )
            .catch(() => undefined);
          return false;
        }
        switch (event.type) {
          case 'progress': {
            apply(record, {
              type: 'progress',
              segmentsDone: event.segmentsDone,
              bytesDone: event.bytesDone,
            });
            if (record.job.state === 'error') {
              finish(record);
              await offscreen
                .send({ target: 'offscreen', type: 'cancel', jobId })
                .catch(() => undefined);
              await closeIfIdle(records);
            }
            return true;
          }
          case 'assembling':
            apply(record, { type: 'assemble' });
            // Toda a mídia já foi buscada: a regra de contexto não é mais necessária.
            releaseLease(jobId);
            return true;
          case 'failed':
            apply(record, { type: 'fail', error: event.error });
            if (!isActive(record.job)) {
              finish(record);
              await closeIfIdle(records);
            }
            return true;
          case 'ready': {
            releaseLease(jobId);
            apply(record, { type: 'assemble' });
            if (record.job.state !== 'assembling') {
              // Cancelado, falhou ou já terminou: nada a baixar, e a blob URL não pode vazar.
              record.blobUrl = event.blobUrl;
              await revoke(record);
              await closeIfIdle(records);
              return true;
            }
            record.blobUrl = event.blobUrl;
            try {
              const downloadId = await downloads.download({
                url: event.blobUrl,
                filename: record.filename,
              });
              apply(record, { type: 'save', filename: record.filename, downloadId });
              log('info', 'job.saving', record, { downloadId });
            } catch {
              apply(record, { type: 'fail', error: 'DOWNLOAD_FAILED' });
              finish(record);
              await revoke(record);
              await closeIfIdle(records);
            }
            return true;
          }
        }
      });
    },

    onDownloadChanged(delta) {
      const current = delta.state?.current;
      if (current !== 'complete' && current !== 'interrupted') {
        return Promise.resolve();
      }
      return mutate(async (records) => {
        const record = Object.values(records).find(
          (r) => r.job.state === 'saving' && r.job.downloadId === delta.id,
        );
        if (!record) {
          return;
        }
        // Cancelado pelo próprio usuário no navegador não é falha.
        apply(
          record,
          current === 'complete'
            ? { type: 'complete' }
            : delta.error?.current === 'USER_CANCELED'
              ? { type: 'cancel' }
              : { type: 'fail', error: 'DOWNLOAD_FAILED' },
        );
        finish(record);
        await revoke(record);
        await closeIfIdle(records);
      });
    },
  };
}
