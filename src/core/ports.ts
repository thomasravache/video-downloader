import type { PermissionsPort } from './access';
import type { ScriptingPort } from './contracts';

export type { PermissionsPort, ScriptingPort };

/** Porta para `browser.downloads`; rejeita quando o download não pode começar. */
export interface DownloadPort {
  download(options: { url: string; filename: string }): Promise<number>;
}

/** Porta para `browser.tabs`: só a URL da aba (indefinida sem a permissão `activeTab`). */
export interface TabsPort {
  getUrl(tabId: number): Promise<string | undefined>;
}

/** Porta para buscar o texto de uma playlist HLS (SPEC-0011); rejeita em qualquer falha. */
export interface PlaylistFetcherPort {
  fetchPlaylist(url: string): Promise<string>;
}
