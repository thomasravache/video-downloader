/**
 * Contrato usado (SPEC-0024:UT-07), src/core/network.ts:
 *   replacesDocument(details: { statusCode; responseHeaders?: { name; value? }[] }): boolean
 *     true quando a resposta de main_frame troca o documento: 2xx exceto 204/205 e sem
 *     `Content-Disposition: attachment` (nome do cabeçalho sem diferenciar maiúsculas).
 */
import { describe, expect, it } from 'vitest';
import { replacesDocument } from '../../src/core/network';

const html = { name: 'Content-Type', value: 'text/html; charset=utf-8' };

describe('replacesDocument (D7)', () => {
  it('SPEC-0024:UT-07 200 text/html, 204, 205, 200 attachment e 200 inline', () => {
    const results = [
      replacesDocument({ statusCode: 200, responseHeaders: [html] }),
      replacesDocument({ statusCode: 204, responseHeaders: [] }),
      replacesDocument({ statusCode: 205, responseHeaders: [] }),
      replacesDocument({
        statusCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/zip' },
          { name: 'Content-Disposition', value: 'attachment; filename=x.zip' },
        ],
      }),
      replacesDocument({
        statusCode: 200,
        responseHeaders: [html, { name: 'Content-Disposition', value: 'inline' }],
      }),
    ];

    expect(results).toEqual([true, false, false, false, true]);
  });

  it('SPEC-0024:UT-07 Content-Disposition em minúsculas também é reconhecido; sem cabeçalhos, 200 troca o documento', () => {
    expect(
      replacesDocument({
        statusCode: 200,
        responseHeaders: [{ name: 'content-disposition', value: 'Attachment; filename="a.pdf"' }],
      }),
    ).toBe(false);
    expect(replacesDocument({ statusCode: 200 })).toBe(true);
  });
});
