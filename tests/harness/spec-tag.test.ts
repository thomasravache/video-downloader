import { describe, expect, it } from 'vitest';
import { specTag } from '../support/spec-tag';

describe('specTag', () => {
  it('SPEC-0003:UT-01 specTag compõe a tag de rastreabilidade "<spec>:<teste>"', () => {
    expect(specTag('SPEC-0003', 'UT-01')).toBe('SPEC-0003:UT-01');
  });
});
