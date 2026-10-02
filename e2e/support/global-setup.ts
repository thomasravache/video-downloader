import { ensureBuilt } from './build';
import { FLAVORS } from './flavor';

/** Garante (uma vez por execução, antes dos workers) que as saídas dos dois flavors estão atuais. */
export default function globalSetup(): void {
  for (const flavor of FLAVORS) {
    ensureBuilt(flavor);
  }
}
