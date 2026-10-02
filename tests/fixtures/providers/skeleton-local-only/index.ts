/** Provider-fixture de SPEC-0005:CT-01: existe só no flavor local (nunca deve vazar para o public). */
import type { Provider } from '../../../../src/core/contracts';

const provider: Provider = {
  id: 'skeleton-local-only',
  flavors: ['local'],
  matches: () => false,
  detect: () => Promise.resolve([]),
};

export default provider;
