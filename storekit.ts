import { Capacitor } from '@capacitor/core';
import { isNative } from './native';

/**
 * StoreKit 2-ready paywall layer — UNTESTED ON A REAL DEVICE.
 *
 * What this layer does:
 * - On the native iOS build, it calls the `AllinViewStoreKit` Capacitor plugin
 *   (Swift bridge: ios/App/App/AllinViewStoreKit.swift), which uses StoreKit 2 to
 *   fetch products, purchase, check current entitlements, and restore (AppStore.sync
 *   + Transaction.currentEntitlements). Purchase transactions are finished only
 *   after a verified transaction is returned.
 * - On the web build there is no StoreKit, so every call returns ok:false and
 *   charges nothing. The buttons still show the approved prices.
 *
 * What is NOT true yet (do not claim otherwise):
 * - This code has NOT been compiled with Xcode, NOT run on a Mac, and NOT tested
 *   on a real iPhone or in TestFlight. The Swift bridge must be compiled in the
 *   Mac build step, the In-App Purchase capability must be enabled on App ID
 *   com.allinview.app, and the products below must match App Store Connect.
 * - No receipt/JWS verification against an Apple server happens on-device here;
 *   entitlement is the StoreKit 2 current-entitlement check in the bridge.
 *   A production hardening step (server-side receipt validation) is a later
 *   decision, not part of this step.
 *
 * Products (already exist in App Store Connect; yearly price is $11.99 only):
 * - com.allinview.app.monthly — $0.99/month, first month free
 * - com.allinview.app.yearly  — $11.99/year, first month free
 */
export type PremiumPlan = 'monthly' | 'yearly';

export const PRODUCT_IDS: Record<PremiumPlan, string> = {
  monthly: 'com.allinview.app.monthly',
  yearly: 'com.allinview.app.yearly',
};

export const PREMIUM_PRICES: Record<PremiumPlan, string> = {
  monthly: '$0.99/month',
  yearly: '$11.99/year',
};

export const FREE_TRIAL = 'First month free on both plans. Cancel anytime.';

export type Entitlement = {
  active: boolean;
  plan: PremiumPlan | null;
  productId: string | null;
  source: 'storekit' | 'web';
};

type StoreKitPlugin = {
  purchase(options: { productId: string }): Promise<{ entitled: boolean; productId: string }>;
  restore(): Promise<{ entitled: boolean; productId: string | null }>;
  getEntitlement(): Promise<{ entitled: boolean; productId: string | null }>;
};

function plugin(): StoreKitPlugin | null {
  if (!isNative) return null;
  try {
    return Capacitor.registerPlugin<StoreKitPlugin>('AllinViewStoreKit');
  } catch {
    return null;
  }
}

const NOT_ON_WEB: { ok: false; reason: string } = {
  ok: false,
  reason:
    'StoreKit is not available on the web — charges nothing. Premium works in the iOS app.',
};

function planOf(productId: string | null): PremiumPlan | null {
  if (productId === PRODUCT_IDS.monthly) return 'monthly';
  if (productId === PRODUCT_IDS.yearly) return 'yearly';
  return null;
}

export async function purchase(
  plan: PremiumPlan,
): Promise<{ ok: boolean; reason: string; entitlement?: Entitlement }> {
  const p = plugin();
  if (!p) return NOT_ON_WEB;
  try {
    const r = await p.purchase({ productId: PRODUCT_IDS[plan] });
    if (r.entitled) {
      return {
        ok: true,
        reason: `Premium active (${plan}).`,
        entitlement: { active: true, plan: planOf(r.productId) ?? plan, productId: r.productId, source: 'storekit' },
      };
    }
    return { ok: false, reason: 'Purchase did not complete (cancelled or pending). Nothing was charged by this app.' };
  } catch (e) {
    return { ok: false, reason: `StoreKit purchase failed: ${e instanceof Error ? e.message : 'unknown error'}. Nothing was charged by this app.` };
  }
}

export async function restorePurchases(): Promise<{
  ok: boolean;
  reason: string;
  entitlement?: Entitlement;
}> {
  const p = plugin();
  if (!p) return NOT_ON_WEB;
  try {
    const r = await p.restore();
    const plan = planOf(r.productId);
    return {
      ok: r.entitled,
      reason: r.entitled
        ? `Premium restored (${plan ?? 'unknown plan'}).`
        : 'No active premium purchase was found to restore.',
      entitlement: { active: r.entitled, plan, productId: r.productId, source: 'storekit' },
    };
  } catch (e) {
    return { ok: false, reason: `StoreKit restore failed: ${e instanceof Error ? e.message : 'unknown error'}` };
  }
}

export async function getEntitlement(): Promise<Entitlement> {
  const p = plugin();
  if (!p) return { active: false, plan: null, productId: null, source: 'web' };
  try {
    const r = await p.getEntitlement();
    return { active: r.entitled, plan: planOf(r.productId), productId: r.productId, source: 'storekit' };
  } catch {
    return { active: false, plan: null, productId: null, source: 'storekit' };
  }
}
