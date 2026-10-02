/**
 * SPEC-0005:IT-07 (mensagem `detect` para chrome://extensions responde RESTRICTED_PAGE) e
 * SPEC-0005:E2E-04 (o popup mostra o estado restrito, data-testid `restricted-state`).
 *
 * Sem `tabs`/host permission o `tab.url` é indefinido: a restrição vem do erro do executeScript.
 */
import { expect, test } from '../support/extension';
import { expectPortugueseText, openPopupForTab, tabIdOf } from './support';

test.describe('página restrita', () => {
  test('SPEC-0005:IT-07 detect para uma aba em chrome://extensions responde RESTRICTED_PAGE', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto('chrome://extensions');
    const tabId = await tabIdOf(page, serviceWorker);
    const host = await openPopupForTab(context, extensionId, tabId);

    const response: unknown = await host.evaluate(
      (id) =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'detect', tabId: id }, resolve);
        }),
      tabId,
    );

    expect(response).toEqual({ ok: false, error: 'RESTRICTED_PAGE' });
  });

  test('SPEC-0005:E2E-04 o popup em chrome://extensions mostra que o Chrome não permite extensões nesta página', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto('chrome://extensions');
    const tabId = await tabIdOf(page, serviceWorker);
    const popup = await openPopupForTab(context, extensionId, tabId);

    await expect(popup.getByTestId('restricted-state')).toBeVisible();
    await expectPortugueseText(
      popup.getByTestId('restricted-state'),
      'O Chrome não permite extensões nesta página',
      serviceWorker,
    );
    await expect(popup.getByTestId('candidate-item')).toHaveCount(0);
  });
});
