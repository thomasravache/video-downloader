import { describe, expect, it, vi } from 'vitest';
import { createActionIndicator } from '../../entrypoints/background/action-indicator';
import type { ActionIndicator, ActionPort } from '../../entrypoints/background/action-indicator';

describe('contrato ActionIndicator (CT-01)', () => {
  it('SPEC-0022:CT-01 contrato ActionIndicator aceita objetos com interface ActionPort e tolera implementações sem lançar erros de tipo/assinatura', async () => {
    const mockActionPort: ActionPort = {
      setIcon: vi.fn().mockImplementation((_details) => Promise.resolve()),
      setBadgeText: vi.fn().mockImplementation((_details) => undefined),
      setBadgeBackgroundColor: vi.fn().mockImplementation((_details) => Promise.resolve()),
      setBadgeTextColor: vi.fn().mockImplementation((_details) => Promise.resolve()),
    };

    const indicator: ActionIndicator = createActionIndicator(mockActionPort);
    expect(indicator).toBeDefined();
    expect(typeof indicator.updateForTab).toBe('function');
    expect(typeof indicator.clearForTab).toBe('function');

    await indicator.updateForTab(1, 2);
    await indicator.clearForTab(1);
  });
});
