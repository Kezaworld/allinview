import type { CapacitorConfig } from '@capacitor/core';

const config: CapacitorConfig = {
  appId: 'com.allinview.app',
  appName: 'AllinView',
  webDir: 'dist',
  backgroundColor: '#FAF6F0',
  ios: {
    // First binary must be built with Xcode 26 / iOS 26 SDK (Apple rule since 28 Apr 2026).
    // Signing is NOT configured here — it needs an App Store Connect API key, created by Clare,
    // and must never use her Apple password or 2FA code.
    // Native plugins in this project: Preferences, LocalNotifications, and the
    // AllinViewStoreKit Swift bridge (ios/App/App/AllinViewStoreKit.swift, UNTESTED
    // on a real device until the Mac build step compiles it).
    contentInset: 'automatic',
  },
};

export default config;
