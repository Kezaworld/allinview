import type { AppState } from './types';
import { BLANK_STATE } from './types';
import { storageGet, storageSet, storageRemove } from './native';

const KEY = 'allinview:v1';

/**
 * On-device storage only: Capacitor Preferences in the native iOS build,
 * localStorage in the web build (fallback). No server, no host storage.
 * Async because Preferences is async; the app loads the saved copy on open
 * (see App.tsx) and otherwise starts blank.
 */
export async function loadSaved(): Promise<AppState | null> {
  try {
    const raw = await storageGet(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Manual save ONLY. Nothing in the app calls this except the "Save my entries" button and explicit Export. */
export async function save(state: AppState): Promise<AppState> {
  const next = { ...state, savedAt: new Date().toISOString() };
  await storageSet(KEY, JSON.stringify(next));
  return next;
}

export async function eraseSaved(): Promise<void> {
  await storageRemove(KEY);
}

export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(text: string): AppState {
  const parsed = JSON.parse(text) as AppState;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.income)) {
    throw new Error('That file is not an AllinView export.');
  }
  return parsed;
}

export function blank(): AppState {
  return JSON.parse(JSON.stringify(BLANK_STATE)) as AppState;
}
