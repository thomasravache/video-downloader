import { test as base } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';

export type Flavor = 'public' | 'local';

export interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  openPopup: () => Promise<Page>;
  fixturesUrl: string;
  flavor: Flavor;
  downloadsDir: string;
}

const notImplemented = (): never => {
  throw new Error('NotImplemented');
};

export const test = base.extend<ExtensionFixtures>({
  flavor: [
    async ({}, use) => {
      notImplemented();
      await use('public');
    },
    { option: true },
  ],
  downloadsDir: async ({}, use) => {
    notImplemented();
    await use('');
  },
  fixturesUrl: async ({}, use) => {
    notImplemented();
    await use('');
  },
  context: async ({}, use) => {
    notImplemented();
    await use(undefined as never);
  },
  extensionId: async ({}, use) => {
    notImplemented();
    await use('');
  },
  serviceWorker: async ({}, use) => {
    notImplemented();
    await use(undefined as never);
  },
  openPopup: async ({}, use) => {
    notImplemented();
    await use(undefined as never);
  },
});

export const expect = test.expect;
