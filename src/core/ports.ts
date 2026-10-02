import type { PermissionsPort } from './access';
import type { ScriptingPort } from './contracts';
import type { OffscreenCommand } from './hls-download/protocol';

export type { PermissionsPort, ScriptingPort };

/** Porta para `browser.downloads`; rejeita quando o download não pode começar. */
export interface DownloadPort {
  download(options: { url: string; filename: string }): Promise<number>;
  /** Cancela um download em andamento (SPEC-0012); falhas são ignoradas. */
  cancel?(downloadId: number): Promise<void>;
}

/** Porta para `browser.tabs`: só a URL da aba (indefinida sem a permissão `activeTab`). */
export interface TabsPort {
  getUrl(tabId: number): Promise<string | undefined>;
}

/** Porta para buscar o texto de uma playlist HLS (SPEC-0011); rejeita em qualquer falha. */
export interface PlaylistFetcherPort {
  fetchPlaylist(url: string): Promise<string>;
}

/** Armazenamento de sessão (SPEC-0012): estado dos jobs sobrevive à suspensão do service worker. */
export interface JobStoragePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** Documento offscreen (SPEC-0012): criado sob demanda, no máximo um por perfil. */
export interface OffscreenPort {
  /** Garante que o documento existe (cria se preciso). */
  ensure(): Promise<void>;
  /** Mensagem {target:'offscreen'} ao documento; resolve quando ele responde. */
  send(command: OffscreenCommand): Promise<void>;
  /** Fecha o documento; idempotente. */
  close(): Promise<void>;
}
