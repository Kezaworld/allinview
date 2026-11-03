// AllinViewStoreKit — StoreKit 2 bridge for AllinView.
//
// STATUS: UNTESTED ON A REAL DEVICE. This file was written on a Linux VM and has
// NOT been compiled with Xcode, NOT run on a Mac, and NOT tested on a real iPhone
// or in TestFlight. The Mac build step must:
//   1. Confirm this file is a member of the App target in the Xcode project.
//   2. Enable the In-App Purchase capability on App ID com.allinview.app.
//   3. Build with Xcode 26 / iOS 26 SDK (Apple rule since 28 Apr 2026).
//   4. Test purchase + restore + entitlement in TestFlight with a sandbox tester
//      before any submission. Do NOT submit with this bridge untested.
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
                call.resolve(["entitled": entitlement != nil, "productId": entitlement as Any])
            } catch {
                call.reject("StoreKit restore failed", nil, error)
            }
        }
    }

    @objc func getEntitlement(_ call: CAPPluginCall) {
        Task {
            let entitlement = await self.currentEntitlement()
            call.resolve(["entitled": entitlement != nil, "productId": entitlement as Any])
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
