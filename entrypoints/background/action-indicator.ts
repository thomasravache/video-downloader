/**
 * Contrato do indicador da toolbar (SPEC-0022: Artefato A).
 */
export interface ActionPort {
  setIcon(details: { tabId?: number; path: Record<number, string> }): Promise<void> | void;
  setBadgeText(details: { tabId?: number; text: string }): Promise<void> | void;
  setBadgeBackgroundColor(details: { tabId?: number; color: string }): Promise<void> | void;
  setBadgeTextColor?(details: { tabId?: number; color: string }): Promise<void> | void;
}

export interface ActionIndicator {
  updateForTab(tabId: number, videoCount: number): Promise<void>;
  clearForTab(tabId: number): Promise<void>;
}

export const ACTIVE_ICONS: Record<number, string> = {
  16: 'icon/icon-16.png',
  32: 'icon/icon-32.png',
  48: 'icon/icon-48.png',
  128: 'icon/icon-128.png',
};

export const IDLE_ICONS: Record<number, string> = {
  16: 'icon/icon-idle-16.png',
  32: 'icon/icon-idle-32.png',
  48: 'icon/icon-idle-48.png',
  128: 'icon/icon-idle-128.png',
};

export function createActionIndicator(action?: ActionPort): ActionIndicator {
  return {
    async updateForTab(tabId: number, videoCount: number): Promise<void> {
      if (!action) {
        return;
      }
      try {
        if (videoCount > 0) {
          try {
            await action.setIcon({
              tabId,
              path: ACTIVE_ICONS,
            });
          } catch {
            // Tolerante se setIcon não estiver implementado (ex.: fakes do WXT)
          }
          try {
            await action.setBadgeText({
              tabId,
              text: String(videoCount),
            });
          } catch {
            // Tolerante se setBadgeText falhar
          }
          try {
            await action.setBadgeBackgroundColor({
              tabId,
              color: '#6366f1',
            });
          } catch {
            // Tolerante se setBadgeBackgroundColor falhar
          }
          if (typeof action.setBadgeTextColor === 'function') {
            try {
              await action.setBadgeTextColor({
                tabId,
                color: '#ffffff',
              });
            } catch {
              // Tolerante se setBadgeTextColor falhar
            }
          }
        } else {
          try {
            await action.setIcon({
              tabId,
              path: IDLE_ICONS,
            });
          } catch {
            // Tolerante se setIcon não estiver implementado
          }
          try {
            await action.setBadgeText({
              tabId,
              text: '',
            });
          } catch {
            // Tolerante se setBadgeText falhar
          }
        }
      } catch {
        // Tolerante a APIs ausentes, parciais ou abas fechadas (SPEC-0022:UT-03)
      }
    },

    async clearForTab(tabId: number): Promise<void> {
      await this.updateForTab(tabId, 0);
    },
  };
}
