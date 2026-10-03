import type { ResolveHlsResponse } from '../../src/core/contracts';
import type { ViewText } from './view';

/** Texto do erro de `resolveHls` no cartão HLS (SPEC-0016: 401/403 viram `hlsErrorExpired`). */
export function hlsErrorText(
  _response: ResolveHlsResponse | undefined,
  _text: Pick<ViewText, 'hlsErrorFetch' | 'hlsErrorParse' | 'hlsErrorGeneric' | 'hlsErrorExpired'>,
): string {
  throw new Error('NotImplemented: hlsErrorText (SPEC-0016)');
}
