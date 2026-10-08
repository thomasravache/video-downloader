import { describe, expect, it, vi } from 'vitest';
import { createActionIndicator } from '../../entrypoints/background/action-indicator';
import type { ActionPort } from '../../entrypoints/background/action-indicator';

describe('action-indicator', () => {
  it('SPEC-0022:UT-01 createActionIndicator define ícone ativo, badge numérico e cor de fundo #6366F1 quando videoCount > 0', async () => {
    const setIcon = vi.fn<ActionPort['setIcon']>().mockResolvedValue(undefined);
    const setBadgeText = vi.fn<ActionPort['setBadgeText']>().mockResolvedValue(undefined);
    const setBadgeBackgroundColor = vi
      .fn<ActionPort['setBadgeBackgroundColor']>()
      .mockResolvedValue(undefined);
    const action: ActionPort = {
      setIcon,
      setBadgeText,
      setBadgeBackgroundColor,
    };

    const indicator = createActionIndicator(action);
    await indicator.updateForTab(42, 3);

    expect(setIcon).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 42,
      }),
    );
    expect(setBadgeText).toHaveBeenCalledWith({
      tabId: 42,
      text: '3',
    });
    const bgCall = setBadgeBackgroundColor.mock.calls[0]?.[0];
    expect(bgCall?.tabId).toBe(42);
    expect(bgCall?.color.toLowerCase()).toBe('#6366f1');
  });

  it('SPEC-0022:UT-02 createActionIndicator define ícone inativo cinza e limpa badge quando videoCount === 0', async () => {
    const setIcon = vi.fn<ActionPort['setIcon']>().mockResolvedValue(undefined);
    const setBadgeText = vi.fn<ActionPort['setBadgeText']>().mockResolvedValue(undefined);
    const setBadgeBackgroundColor = vi
      .fn<ActionPort['setBadgeBackgroundColor']>()
      .mockResolvedValue(undefined);
    const action: ActionPort = {
      setIcon,
      setBadgeText,
      setBadgeBackgroundColor,
    };

    const indicator = createActionIndicator(action);
    await indicator.updateForTab(42, 0);

    expect(setIcon).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 42,
      }),
    );
    expect(setBadgeText).toHaveBeenCalledWith({
      tabId: 42,
      text: '',
    });

    setIcon.mockClear();
    setBadgeText.mockClear();
    await indicator.clearForTab(42);

    expect(setIcon).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 42,
      }),
    );
    expect(setBadgeText).toHaveBeenCalledWith({
      tabId: 42,
      text: '',
    });
  });

  it('SPEC-0022:UT-03 tratamento tolerante contra ausência da API ou erros em abas fechadas sem lançar exceções', async () => {
    // API action ausente
    const nilIndicator = createActionIndicator(undefined);
    await expect(nilIndicator.updateForTab(42, 2)).resolves.toBeUndefined();
    await expect(nilIndicator.clearForTab(42)).resolves.toBeUndefined();

    // API action com erro em aba fechada
    const setIcon = vi
      .fn<ActionPort['setIcon']>()
      .mockRejectedValue(new Error('No tab with id: 42'));
    const setBadgeText = vi
      .fn<ActionPort['setBadgeText']>()
      .mockRejectedValue(new Error('No tab with id: 42'));
    const setBadgeBackgroundColor = vi
      .fn<ActionPort['setBadgeBackgroundColor']>()
      .mockRejectedValue(new Error('No tab with id: 42'));
    const failingAction: ActionPort = {
      setIcon,
      setBadgeText,
      setBadgeBackgroundColor,
    };
    const resilientIndicator = createActionIndicator(failingAction);
    await expect(resilientIndicator.updateForTab(42, 2)).resolves.toBeUndefined();
    await expect(resilientIndicator.clearForTab(42)).resolves.toBeUndefined();
  });
});
