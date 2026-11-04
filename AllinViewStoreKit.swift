// AllinViewStoreKit — StoreKit 2 bridge for AllinView.
//
// STATUS: STILL UNTESTED ON A REAL DEVICE. This file was written on a Linux VM and has
// NOT been compiled with Xcode, NOT run on a Mac, and NOT tested on a real iPhone
// or in TestFlight. Wiring done Nov 3, 2026 (scripts/wire-storekit.py):
//   1. DONE (locally): file added to the App target in project.pbxproj, and
//      registered in capacitor.config.json packageClassList by
//      scripts/register-storekit-plugin.py (run AFTER every `npx cap sync ios`,
//      which otherwise wipes it — see that script).
//   2. STILL TO DO (separate step, Apple Developer portal): enable the In-App
//      Purchase capability on App ID com.allinview.app, then REGENERATE the
//      App Store provisioning profile and re-fetch it in Codemagic — a profile
//      made before the capability was enabled will NOT include it.
//   3. Build with Xcode 26 / iOS 26 SDK (Apple rule since 28 Apr 2026).
//   4. Test purchase + restore + entitlement on a real device / TestFlight
//      with a sandbox tester before any App Store submission. Do NOT submit
//      with this bridge untested.
// Also fixed Nov 3: @available(iOS 15.0, *) (StoreKit 2 needs iOS 15+), and
// nil entitlements now resolve as NSNull instead of an Optional wrapped in Any.
//
// Products (must match App Store Connect exactly):
//   com.allinview.app.monthly — $0.99/month, first month free (introductory offer)
//   com.allinview.app.yearly  — $11.99/year,  first month free (introductory offer)
// No other yearly price exists. Never hard-code a different price here.
//
// Design notes:
// - purchase() fetches the product, runs product.purchase(), and only calls
//   transaction.finish() after a VERIFIED transaction is returned. Unverified
//   transactions are not treated as entitled.
// - getEntitlement() / restore() use Transaction.currentEntitlements, skipping
//   revoked transactions and expired subscriptions. restore() first calls
//   AppStore.sync() so purchases made on another device are picked up.
// - No receipt/JWS is sent to any server by this bridge. Production hardening
//   (server-side receipt validation) is a later decision, not done here.

import Foundation
import Capacitor
import StoreKit

@available(iOS 15.0, *)
@objc(AllinViewStoreKit)
public class AllinViewStoreKit: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AllinViewStoreKit"
    public let jsName = "AllinViewStoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEntitlement", returnType: CAPPluginReturnPromise),
    ]

    private let productIds = ["com.allinview.app.monthly", "com.allinview.app.yearly"]

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), productIds.contains(productId) else {
            call.reject("Unknown product id")
            return
        }
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    call.reject("Product not found in App Store Connect: \(productId)")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        await transaction.finish()
                        call.resolve(["entitled": true, "productId": transaction.productID])
                    case .unverified:
                        call.resolve(["entitled": false, "productId": productId])
                    }
                case .userCancelled:
                    call.resolve(["entitled": false, "productId": productId])
                case .pending:
                    call.resolve(["entitled": false, "productId": productId])
                @unknown default:
                    call.resolve(["entitled": false, "productId": productId])
                }
            } catch {
                call.reject("StoreKit purchase failed", nil, error)
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                let entitlement = await self.currentEntitlement()
                call.resolve(["entitled": entitlement != nil, "productId": entitlement ?? NSNull()])
            } catch {
                call.reject("StoreKit restore failed", nil, error)
            }
        }
    }

    @objc func getEntitlement(_ call: CAPPluginCall) {
        Task {
            let entitlement = await self.currentEntitlement()
            call.resolve(["entitled": entitlement != nil, "productId": entitlement ?? NSNull()])
        }
    }

    private func currentEntitlement() async -> String? {
        for await result in Transaction.currentEntitlements {
            switch result {
            case .verified(let transaction):
                guard productIds.contains(transaction.productID) else { continue }
                guard transaction.revocationDate == nil else { continue }
                if let expiry = transaction.expirationDate, expiry < Date() { continue }
                return transaction.productID
            case .unverified:
                continue
            }
        }
        return nil
    }
}
