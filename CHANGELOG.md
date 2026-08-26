# Changelog

## Unreleased (planned 0.1.0)

- Moved proof-of-possession and Security 2 usernames to `device.connect()` so
  both discovery paths support device-specific credentials through one API.
- Added explicit missing-credential errors while preserving Security 1 devices
  that advertise the standard `no_pop` capability.
- Unified iOS credential delivery through the official connection delegate.
- Added CI for JavaScript, Android, and iOS validation.
- Added a release workflow so npm provenance can actually be generated.
- Added package, config plugin, and public API verification.
- Added contribution, security, conduct, and third-party license documentation.
- Verified native compilation with Expo SDK 56 and 57.
- Updated the iOS CI runner to macOS 26 with Xcode 26.4.1, matching Expo SDK
  56's Swift 6.3 toolchain requirement, and updated the Expo 56 consumer to
  56.0.20.
- Capped `ACCESS_FINE_LOCATION` at `maxSdkVersion="30"` in the module manifest so
  apps that do not add the config plugin no longer request unrestricted location.
- Made the config plugin own only the iOS usage description and the
  `neverForLocation` flag instead of restating the module's Android permissions.
- Replaced the template build scripts with direct `tsc`/`jest` invocations. The
  previous scripts turned on watch mode on a TTY, which made `npm run verify`
  and `npm publish` hang in an interactive terminal.
- Guarded the native device registries against concurrent access from BLE
  callback threads.
- Made the web build throw an explanatory error instead of exposing an empty
  module.
- Removed the raw native module from the public API surface.
- Kept Android module teardown from initializing Espressif's manager on a
  background thread, and ensured its first initialization runs on the main
  looper as required by the SDK.

- Added Expo-only BLE provisioning for iOS and Android.
- Added discovery, connection, Wi-Fi scanning, custom endpoints, provisioning,
  cancellation, and disconnect APIs.
- Added request serialization and native timeouts.
- Added typed operation-specific error codes and an `isEspProvisioningError()`
  type guard.
- Added per-device connection-state and provisioning-progress events.
- Added `device.dispose()` to release native device registry entries.
- Added the forward-compatible `EspWifiAuth` enum.
- Expanded the example app through connection, Wi-Fi scan, provisioning, event,
  and disposal flows.
- Kept reused Android devices' native security type in sync with the public API.
- Prevented Android connection events from being shared across concurrent device
  connections by allowing one active BLE connection at a time.
- Added an Expo config plugin for Bluetooth permissions.
