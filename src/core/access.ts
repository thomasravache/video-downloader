/** Porta para `browser.permissions`; `origins` são padrões de match ('https://host[:porta]/*'). */
export interface PermissionsPort {
  contains(origins: string[]): Promise<boolean>;
  request(origins: string[]): Promise<boolean>;
}

/**
 * Pede acesso às origens (cada `origin` vira o padrão `origin/*`); exceção da API = `granted: false`.
 * Só deve ser chamada a partir de um gesto do usuário (ADR-0012).
 */
export function requestAccess(
  _port: PermissionsPort,
  _origins: string[],
): Promise<{ granted: boolean }> {
  throw new Error('NotImplemented');
}
