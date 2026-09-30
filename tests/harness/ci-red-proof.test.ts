import { expect, it } from 'vitest';

// Prova descartável de SPEC-0004:IT-01: este teste falha de propósito para provar que a CI fica vermelha.
it('SPEC-0004:IT-01 prova descartável: teste quebrado deve deixar ci / test vermelho', () => {
  expect(1 + 1).toBe(3);
});
