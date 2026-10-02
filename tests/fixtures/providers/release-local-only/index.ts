/** Provider-fixture SPEC-0006 (somente flavor local). Default export, como o registry de SPEC-0005 exige. */
import type { Provider } from '../../../../src/core/contracts';

const provider: Provider = {
  id: 'release-local-only',
  flavors: ['local'],
  matches: (url: URL): boolean => url.hostname === 'local-only.test',
  detect: () => Promise.resolve([]),
};

export default provider;
