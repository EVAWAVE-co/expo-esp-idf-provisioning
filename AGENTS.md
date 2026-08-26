# AGENTS.md

## Scope

- This package is an Expo native module. Do not add React Native CLI-specific
  bridges unless the package scope is explicitly changed.
- Keep the public API generic to ESP-IDF Unified Provisioning. Product-specific
  endpoint names and payload schemas belong in consuming apps.
- BLE is the supported transport for version 0.1. SoftAP support requires a
  separate design and platform validation before implementation.

## Native dependencies

- iOS wraps Espressif `ESPProvision` and Android wraps Espressif
  `esp-idf-provisioning-android`.
- Pin native SDK versions and document upgrades in `CHANGELOG.md`.
- Do not implement ESP security or protobuf protocols independently when the
  official SDK provides them.

## Reliability

- Serialize native requests per device.
- Every asynchronous native request must have a timeout and settle exactly
  once. Ignore callbacks arriving after timeout or cancellation.
- Keep cancellation connected to the native BLE lifecycle; a JavaScript-only
  timeout is insufficient.

## Verification

- Run `npm run build`, `npm run lint`, and the example typecheck after TypeScript
  changes.
- Compile both native module targets after Swift, Kotlin, podspec, Gradle, or
  config plugin changes.
- Verify Wi-Fi scanning and provisioning with physical ESP hardware before a
  release. Simulators are insufficient for BLE behavior.
