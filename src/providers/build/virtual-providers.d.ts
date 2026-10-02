declare module 'virtual:providers' {
  import type { Provider } from '../../core/contracts';

  /** Só os providers do FLAVOR do build; os específicos antes de `generic` (ADR-0011). */
  export const providers: Provider[];
}
