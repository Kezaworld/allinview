#!/usr/bin/env python3
"""Wire AllinViewStoreKit.swift into the App target — deterministically.

Run from the project root:  python3 scripts/wire-storekit.py

What it does (idempotent — safe to re-run, it makes no change if already wired):
  1. PBXBuildFile entry for AllinViewStoreKit.swift in Sources.
  2. PBXFileReference entry (sourcecode.swift, path AllinViewStoreKit.swift).
  3. Adds the file reference to the App group's children.
  4. Adds the build file to the App target's PBXSourcesBuildPhase.
  5. SWIFT_VERSION 5.0 -> 5.9 in the App target configs (StoreKit 2 uses
     async/await and Task, which do not exist in Swift 5.0 language mode).
  6. IPHONEOS_DEPLOYMENT_TARGET 14.0 -> 15.0 in every config (StoreKit 2
     requires iOS 15+; Capacitor 7 itself still targets 14.0 in its podspec,
     which is unaffected by the App target's higher floor).
  7. CURRENT_PROJECT_VERSION 1 -> 2 in the App target configs (build 1.0 (1)
     is already in App Store Connect, so the next upload must be build 2;
     MARKETING_VERSION stays 1.0).

IDs are derived deterministically (md5 of a fixed label, upper-cased, first
24 hex chars) and are checked against every existing ID in the file, so a
collision can never silently corrupt the project. The script asserts each
insertion happens exactly once and fails loudly otherwise. It never touches
any other file. Back up project.pbxproj before running (see README note);
the script itself does not back up.
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PBX = ROOT / "ios/App/App.xcodeproj/project.pbxproj"


def new_id(label: str) -> str:
    return hashlib.md5(label.encode()).hexdigest()[:24].upper()


def main() -> int:
    text = PBX.read_text()
    orig = text

    already_wired = "AllinViewStoreKit.swift" in text
    if already_wired:
        # Already wired (by this script or in Xcode): never re-assert the
        # derived IDs against the file, or the script's own IDs would read
        # as a "collision" on re-run. Only the version bumps below apply.
        print("AllinViewStoreKit.swift already referenced in project.pbxproj; skipping wiring.")
        file_ref = build_file = ""
    else:
        file_ref = new_id("AllinViewStoreKit.swift fileRef")
        build_file = new_id("AllinViewStoreKit.swift in Sources buildFile")
        existing_ids = set(re.findall(r"\b[0-9A-F]{24}\b", text))
        assert file_ref not in existing_ids, f"fileRef ID collision: {file_ref}"
        assert build_file not in existing_ids, f"buildFile ID collision: {build_file}"
        assert file_ref != build_file
    if not already_wired:
        # 1. PBXBuildFile — insert after the AppDelegate.swift build-file line.
        anchor = "\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F /* AppDelegate.swift */; };"
        assert text.count(anchor) == 1, "AppDelegate PBXBuildFile anchor not found exactly once"
        text = text.replace(
            anchor,
            anchor
            + f"\n\t\t{build_file} /* AllinViewStoreKit.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {file_ref} /* AllinViewStoreKit.swift */; }};",
        )
        # 2. PBXFileReference — insert after the AppDelegate.swift file-ref line.
        anchor = "\t\t504EC3071FED79650016851F /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AppDelegate.swift; sourceTree = \"<group>\"; };"
        assert text.count(anchor) == 1, "AppDelegate PBXFileReference anchor not found exactly once"
        text = text.replace(
            anchor,
            anchor
            + f"\n\t\t{file_ref} /* AllinViewStoreKit.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AllinViewStoreKit.swift; sourceTree = \"<group>\"; }};",
        )
        # 3. App group children — insert after the AppDelegate.swift child line.
        anchor = "\t\t\t\t504EC3071FED79650016851F /* AppDelegate.swift */,\n"
        assert text.count(anchor) == 1, "App group AppDelegate child anchor not found exactly once"
        text = text.replace(
            anchor, anchor + f"\t\t\t\t{file_ref} /* AllinViewStoreKit.swift */,\n"
        )
        # 4. Sources build phase — insert after the AppDelegate.swift file line.
        anchor = "\t\t\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n"
        assert text.count(anchor) == 1, "Sources phase AppDelegate anchor not found exactly once"
        text = text.replace(
            anchor, anchor + f"\t\t\t\t{build_file} /* AllinViewStoreKit.swift in Sources */,\n"
        )

    # 5/6/7. Version bumps (target configs only for SWIFT_VERSION and
    # CURRENT_PROJECT_VERSION; deployment target in every config).
    # Re-running after a successful run must be a no-op, so assert the
    # FINAL counts, not how many replacements this run performed.
    text = text.replace("SWIFT_VERSION = 5.0;", "SWIFT_VERSION = 5.9;")
    text = text.replace("IPHONEOS_DEPLOYMENT_TARGET = 14.0;", "IPHONEOS_DEPLOYMENT_TARGET = 15.0;")
    text = text.replace("CURRENT_PROJECT_VERSION = 1;", "CURRENT_PROJECT_VERSION = 2;")
    n_swift = text.count("SWIFT_VERSION = 5.9;")
    n_deploy = text.count("IPHONEOS_DEPLOYMENT_TARGET = 15.0;")
    n_build = text.count("CURRENT_PROJECT_VERSION = 2;")

    # Verify: exactly one reference to the Swift file in each section.
    if already_wired:
        assert "AllinViewStoreKit.swift" in text
    else:
        assert text.count("AllinViewStoreKit.swift in Sources") == 2, "build-file entries != 2"
        assert text.count("AllinViewStoreKit.swift */ = {isa = PBXFileReference") == 1
        assert text.count(f"{file_ref} /* AllinViewStoreKit.swift */,") == 1
        assert text.count(f"{build_file} /* AllinViewStoreKit.swift in Sources */,") == 1
        # Brace balance: only the two new object entries were added.
        assert text.count("{") == orig.count("{") + 2, "brace count unexpected"
        assert text.count("(") == orig.count("("), "paren count changed"
    print(f"SWIFT_VERSION bumps: {n_swift}, deployment bumps: {n_deploy}, build-number bumps: {n_build}")
    assert n_swift == 2 and n_deploy == 4 and n_build == 2, "unexpected bump counts — refusing to write"

    if text != orig:
        PBX.write_text(text)
        print("project.pbxproj updated.")
    else:
        print("project.pbxproj already up to date; no change.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
