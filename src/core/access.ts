/** Porta para `browser.permissions`; `origins` são padrões de match ('https://host[:porta]/*'). */
export interface PermissionsPort {
  contains(origins: string[]): Promise<boolean>;
  request(origins: string[]): Promise<boolean>;
}

/**
 * Pede acesso às origens (cada `origin` vira o padrão `origin/*`); exceção da API = `granted: false`.
 * Só deve ser chamada a partir de um gesto do usuário (ADR-0012).
 */
export async function requestAccess(
  port: PermissionsPort,
  origins: string[],
): Promise<{ granted: boolean }> {
  try {
    return { granted: await port.request(origins.map((origin) => `${origin}/*`)) };
  } catch {
    return { granted: false };
  }
}
