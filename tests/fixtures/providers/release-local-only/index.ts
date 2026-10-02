// Provider-fixture SPEC-0006 (somente flavor local). Sem imports: independe do contrato de SPEC-0005.
export const provider = {
  id: 'release-local-only',
  flavors: ['local'],
  matches: (url: URL): boolean => url.hostname === 'local-only.test',
};
