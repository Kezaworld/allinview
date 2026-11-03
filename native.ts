import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';

/** True only inside the native iOS build. The web build always takes the fallback path. */
export const isNative = Capacitor.isNativePlatform();

/** On-device key/value storage: Capacitor Preferences on iOS, localStorage on the web. */
export async function storageGet(key: string): Promise<string | null> {
  if (isNative) {
    try {
      const { value } = await Preferences.get({ key });
      return value;
    } catch {
      // Fall through to the web fallback rather than losing the user's data.
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function storageSet(key: string, value: string): Promise<void> {
  if (isNative) {
    try {
      await Preferences.set({ key, value });
      return;
    } catch {
      // Fall through to the web fallback.
    }
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (e.g. private mode): the caller still keeps the in-memory draft.
  }
}

export async function storageRemove(key: string): Promise<void> {
  if (isNative) {
    try {
      await Preferences.remove({ key });
      return;
    } catch {
      // Fall through to the web fallback.
    }
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/**
 * Reminder permission + one local notification 24 hours out.
 * iOS: Capacitor LocalNotifications (native, scheduled on-device).
 * Web: the browser Notification permission; the reminder itself stays in-app.
 * Returns a human-readable status for the notice line; never throws.
 */
export async function requestReminder(title: string, body: string): Promise<string> {
  if (isNative) {
    try {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') return 'Notification permission: not granted.';
      const at = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await LocalNotifications.schedule({
        notifications: [{ title, body, id: 1, schedule: { at } }],
      });
      return 'Reminder scheduled on this device (native local notification, 24 hours out).';
    } catch (e) {
      return `Could not schedule a native reminder: ${e instanceof Error ? e.message : 'unknown error'}`;
    }
  }
  if (!('Notification' in window)) {
    return 'Reminders in this build are in-app lists. Native local notifications come with the iOS build.';
  }
  const result = await Notification.requestPermission();
  return `Notification permission: ${result}. On the web, reminders stay in-app; native reminders come with the iOS build.`;
}
