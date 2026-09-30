export type Flavor = 'public' | 'local';

export interface BuildManifest {
  manifest_version: 3;
  default_locale: 'pt_BR';
  name: string;
  [key: string]: unknown;
}

export function resolveFlavor(_mode: string): Flavor {
  throw new Error('NotImplemented');
}

export function buildManifest(_flavor: Flavor): BuildManifest {
  throw new Error('NotImplemented');
}
