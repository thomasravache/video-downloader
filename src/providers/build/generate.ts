import type { Flavor, ProviderManifest } from '../../core/contracts';

export interface ProviderEntry extends ProviderManifest {
  /** Caminho do módulo do provider (default export = Provider) usado no `import`. */
  modulePath: string;
}

const GENERIC_ID = 'generic';

/**
 * Gera o código de `virtual:providers`; `generic` por último.
 * `public`: só os providers que declaram `public`. `local` é o superconjunto (providers extras
 * além dos públicos), então inclui todos — o que nunca pode vazar é `local` para o build `public`.
 */
export function generateRegistrySource(entries: ProviderEntry[], flavor: Flavor): string {
  const included = entries.filter((entry) => flavor === 'local' || entry.flavors.includes(flavor));
  const ordered = [
    ...included.filter((entry) => entry.id !== GENERIC_ID),
    ...included.filter((entry) => entry.id === GENERIC_ID),
  ];
  const imports = ordered.map(
    (entry, index) => `import provider${String(index)} from ${JSON.stringify(entry.modulePath)};`,
  );
  const names = ordered.map((_entry, index) => `provider${String(index)}`);
  return [...imports, `export const providers = [${names.join(', ')}];`, ''].join('\n');
}
