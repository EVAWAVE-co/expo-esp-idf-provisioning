# Contributing

Thanks for helping improve `expo-esp-idf-provisioning`.

## Scope

This package provides generic ESP-IDF Unified Provisioning over BLE for Expo.
Product-specific endpoints and payloads belong in consuming applications.
SoftAP and web support need a separate proposal and platform validation.

## Development

Requirements:

- Node.js 20 or newer
- Android Studio with JDK 21 for Android changes
- macOS with Xcode and CocoaPods for iOS changes
- A development build; Expo Go cannot load this module

Install and run the portable checks:

```sh
npm ci
npm run verify
```

For native changes, regenerate the example projects and compile both targets:

```sh
cd example
npx expo prebuild --clean
npx expo run:android
npx expo run:ios
```

BLE behavior must be tested on physical Android and iOS devices with an ESP
device before release. Include the phone OS, Expo SDK, ESP chip, ESP-IDF
version, transport, and security version in bug reports. Follow the complete
[hardware test matrix](./HARDWARE_TESTING.md) for stable releases.

## Pull requests

- Keep changes focused and add tests for behavior changes.
- Update `README.md` when the public API or supported configuration changes.
- Update `CHANGELOG.md` for user-visible changes and native SDK upgrades.
- Do not include generated `example/android` or `example/ios` directories.
- Confirm that `npm pack --dry-run` contains no build caches or test fixtures.

## Documentation

- Keep examples generic to ESP-IDF Unified Provisioning; product-specific
  endpoints and payloads do not belong in this repository.
- Document platform-specific behavior instead of implying identical native SDK
  output where it does not exist.
- Never add real Wi-Fi credentials, PoP values, Security 2 usernames, BLE
  captures containing secrets, or production device identifiers.

## Release checklist

- Move the planned release notes out of `Unreleased` and add the release date.
- Keep `package.json`, the podspec, and Android version fields synchronized.
- Run the JavaScript checks and native builds against every supported Expo SDK.
- Complete the physical-device matrix for Android and iOS.
- Confirm that the Git tag exactly matches the package version.
