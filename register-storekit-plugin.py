#!/usr/bin/env python3
"""Register AllinViewStoreKit in capacitor.config.json's packageClassList.

WHY THIS EXISTS: `npx cap sync ios` regenerates packageClassList from the
installed npm plugin packages only (see @capacitor/cli iosplugin.js
writePluginJSON). AllinViewStoreKit.swift lives in the App target, not in
an npm package, so every sync WIPES it from the list — and Capacitor's
bridge only registers plugins named in that list. Without this step the
Swift file compiles into the binary but JavaScript can never reach it,
so every purchase/restore call fails.

Run AFTER every `npx cap sync ios` (locally and in Codemagic, before
pod install / build). Idempotent: adds "AllinViewStoreKit" once, keeps
every other entry and key untouched, fails loudly if the file is missing.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = ROOT / "ios/App/App/capacitor.config.json"


def main() -> int:
    if not CFG.exists():
        print(f"ERROR: {CFG} not found — run `npx cap sync ios` first.", file=sys.stderr)
        return 1
    data = json.loads(CFG.read_text())
    lst = data.get("packageClassList", [])
    if "AllinViewStoreKit" not in lst:
        lst.append("AllinViewStoreKit")
        data["packageClassList"] = lst
        CFG.write_text(json.dumps(data, indent="\t") + "\n")
        print("Added AllinViewStoreKit to packageClassList.")
    else:
        print("AllinViewStoreKit already in packageClassList.")
    print("packageClassList:", data["packageClassList"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
