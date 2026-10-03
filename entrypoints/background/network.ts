import type { NetworkResponse } from '../../src/core/network';

interface RequestDetails {
  url: string;
  method: string;
  statusCode: number;
  tabId: number;
  frameId: number;
  /** SPEC-0016: origem do frame iniciador (`webRequest`), quando o navegador informa. */
  initiator?: string;
  responseHeaders?: { name: string; value?: string }[];
}

function header(details: RequestDetails, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return details.responseHeaders?.find((h) => h.name.toLowerCase() === wanted)?.value;
}

function toLength(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined;
}

/** Tamanho total: `Content-Length` (200) ou o total de `Content-Range: bytes a-b/total` (206). */
function totalSize(details: RequestDetails): number | undefined {
  if (details.statusCode === 206) {
    return toLength(
      /^bytes\s+[^/]*\/(\d+)$/i.exec((header(details, 'content-range') ?? '').trim())?.[1],
    );
  }
  return toLength(header(details, 'content-length'));
}

/** Converte os detalhes de `webRequest.onResponseStarted` em `NetworkResponse` (só cabeçalhos, nunca corpo). */
export function toNetworkResponse(details: RequestDetails): NetworkResponse {
  const contentType = header(details, 'content-type');
  const contentLength = totalSize(details);
  return {
    url: details.url,
    method: details.method,
    statusCode: details.statusCode,
    tabId: details.tabId,
    frameId: details.frameId,
    ...(contentType !== undefined && { contentType }),
    ...(contentLength !== undefined && { contentLength }),
  };
}
