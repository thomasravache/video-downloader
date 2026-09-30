import type { Flavor, ProviderManifest } from '../../core/contracts';

export interface ProviderEntry extends ProviderManifest {
  /** Caminho do módulo do provider (default export = Provider) usado no `import`. */
  modulePath: string;
}

/** Gera o código de `virtual:providers` só com os providers do flavor; `generic` por último. */
export function generateRegistrySource(_entries: ProviderEntry[], _flavor: Flavor): string {
  throw new Error('NotImplemented');
}
