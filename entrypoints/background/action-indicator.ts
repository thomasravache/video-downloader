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

export function createActionIndicator(_action?: ActionPort): ActionIndicator {
  throw new Error('NotImplemented');
}
