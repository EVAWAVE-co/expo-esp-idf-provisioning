# @evawave/expo-esp-idf-provisioning

Expo native module for provisioning ESP-IDF devices over Bluetooth LE. It uses
Espressif's official `ESPProvision` SDK on iOS and
`esp-idf-provisioning-android` on Android.

## Status

Version `0.1.0` supports:

- Expo SDK 56 and 57
- iOS and Android development builds
- BLE device discovery
- ESP security 0, 1, and 2
- Session connection
- Device-side Wi-Fi scanning
- Custom provisioning endpoints
- Wi-Fi credential provisioning
- Native cancellation, timeouts, and per-device request serialization
- Typed errors, connection-state events, and provisioning progress events
- Explicit native device disposal

SoftAP and web are not supported in `0.1.0`. Expo Go cannot load custom native
modules, so use a development build.

### Requirements

- Expo SDK 56 or 57 with a development build
- Android 8.0 (API 26) or newer
- iOS 16.4 or newer
- An ESP device running ESP-IDF Unified Provisioning over BLE

### Compatibility

| Expo SDK | Android                   | iOS module       | Verification      |
| -------- | ------------------------- | ---------------- | ----------------- |
| 56       | Compile and lint verified | Compile verified | CI                |
| 57       | Compile verified          | Compile verified | Local build check |

The native module compiles against both SDKs. Expo SDK 56 requires Xcode 26.4
or newer because `ExpoModulesJSI` uses Swift 6.3 language features. CI pins
Xcode 26.4.1 on GitHub's macOS 26 runner, following Expo's
[toolchain guidance](https://github.com/expo/expo/issues/46242).
The current CI consumer app uses Expo SDK 56; SDK 57 is checked separately
before release.

## Installation

```sh
npx expo install @evawave/expo-esp-idf-provisioning
```

Add the config plugin to `app.json` or `app.config.js`. Config plugins are not
applied automatically by autolinking, so it must be listed explicitly:

```json
{
  "expo": {
    "plugins": [
      [
        "@evawave/expo-esp-idf-provisioning",
        {
          "neverForLocation": true,
          "bluetoothPermission": "Allow $(PRODUCT_NAME) to provision nearby devices."
        }
      ]
    ]
  }
}
```

Then rebuild the native app:

```sh
npx expo prebuild
npx expo run:ios
# or
npx expo run:android
```

The Android BLE permissions are declared by the module's own manifest and merge
into the app whether or not the plugin is used, with `ACCESS_FINE_LOCATION`
capped at `maxSdkVersion="30"`. The plugin adds the iOS usage description and
sets `neverForLocation` on `BLUETOOTH_SCAN`; pass `neverForLocation: false` if
the app derives location from BLE scan results.

On Android, request `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` at runtime before
searching. Android 11 and older also require location permission for BLE scans.
The example app includes a runtime permission helper.

## Security modes

| Mode                                | `security` value        | Credentials passed to `connect()`  |
| ----------------------------------- | ----------------------- | ---------------------------------- |
| Security 0                          | `EspSecurity.Security0` | None                               |
| Security 1 with `no_pop` capability | `EspSecurity.Security1` | None                               |
| Security 1 with PoP                 | `EspSecurity.Security1` | `proofOfPossession`                |
| Security 2                          | `EspSecurity.Security2` | `proofOfPossession` and `username` |

Credentials are associated with one device connection, not a discovery query.
Do not log PoP values, Security 2 usernames, or Wi-Fi passphrases.

## Usage

```ts
import { EspSecurity, searchDevices } from '@evawave/expo-esp-idf-provisioning';

const [device] = await searchDevices({
  prefix: 'PROV_',
  security: EspSecurity.Security1,
  timeoutMs: 10_000,
});

const connection = device.addListener('connectionStateChanged', ({ state }) => {
  console.log('Connection state:', state);
});
const progress = device.addListener('provisioningProgress', ({ progress }) => {
  console.log('Provisioning progress:', progress);
});

try {
  await device.connect({
    proofOfPossession: 'abcd1234',
    timeoutMs: 15_000,
  });

  const networks = await device.scanWifi({ timeoutMs: 20_000 });

  const response = await device.sendData('device-info', JSON.stringify({}));

  await device.provision({
    ssid: networks[0].ssid,
    passphrase: 'password',
    timeoutMs: 30_000,
  });
} finally {
  connection.remove();
  progress.remove();
  device.dispose();
}
```

If a device was not obtained through discovery, prepare it by name:

```ts
import { createDevice, EspSecurity } from '@evawave/expo-esp-idf-provisioning';

const device = await createDevice({
  name: 'PROV_1234',
  security: EspSecurity.Security1,
});

await device.connect({ proofOfPossession: 'abcd1234' });
```

Security 2 requires both credentials:

```ts
const [device] = await searchDevices({
  prefix: 'PROV_',
  security: EspSecurity.Security2,
});

await device.connect({
  proofOfPossession: 'abcd1234',
  username: 'provisioning-user',
});
```

For binary endpoints, `sendDataBase64()` accepts and returns Base64 strings.
Security credentials belong to an individual connection, so both discovery
paths stay credential-free. Pass `proofOfPossession` (and `username` for
Security 2) to `device.connect()`.

Security 2 rejects immediately when either credential is missing. Security 1
allows credentials to be omitted for devices advertising the standard
`no_pop` capability; otherwise connection rejects with a clear missing-PoP
message after capabilities are read.

## API reference

### Top-level functions

| API                      | Purpose                                                      | Default timeout |
| ------------------------ | ------------------------------------------------------------ | --------------- |
| `searchDevices(options)` | Discover matching BLE devices by `prefix` and security mode  | 10 seconds      |
| `stopSearch()`           | Cancel the active discovery request                          | —               |
| `createDevice(options)`  | Prepare one named BLE device without a broad discovery query | 10 seconds      |

`searchDevices()` defaults to `EspSecurity.Security1`. `createDevice()` uses the
same default and is useful when an app already knows the complete advertised
device name.

### Device methods

| API                                               | Purpose                                                           | Default timeout |
| ------------------------------------------------- | ----------------------------------------------------------------- | --------------- |
| `device.connect(options?)`                        | Connect over BLE and apply credentials used for session setup     | 20 seconds      |
| `device.scanWifi(options?)`                       | Ask the ESP device to scan nearby Wi-Fi networks                  | 20 seconds      |
| `device.sendData(endpoint, data, options?)`       | Send and receive UTF-8 custom-endpoint data                       | 20 seconds      |
| `device.sendDataBase64(endpoint, data, options?)` | Send and receive Base64 custom-endpoint data                      | 20 seconds      |
| `device.provision(options)`                       | Send Wi-Fi credentials and wait for the final provisioning result | 20 seconds      |
| `device.cancel()`                                 | Reject the pending request and close its BLE connection           | —               |
| `device.disconnect()`                             | Close the BLE connection and clear stored connection credentials  | —               |
| `device.dispose()`                                | Disconnect and remove the device from the native registry         | —               |
| `device.addListener(event, listener)`             | Observe this device's connection or provisioning events           | —               |

All timeout values are expressed in milliseconds through `timeoutMs`. Custom
endpoint names and payload schemas are defined by the ESP firmware and are not
interpreted by this package.

### Wi-Fi scan results

`scanWifi()` returns objects with `ssid`, `rssi`, and an `auth` value typed with
`EspWifiAuth`. The type also permits unknown numeric values so newer ESP-IDF
authentication modes remain forward-compatible. iOS also returns `bssid` and
`channel`; these fields are currently `undefined` on Android.

| Enum member                  | Value | Mode            |
| ---------------------------- | ----- | --------------- |
| `EspWifiAuth.Open`           | `0`   | Open            |
| `EspWifiAuth.Wep`            | `1`   | WEP             |
| `EspWifiAuth.WpaPsk`         | `2`   | WPA-PSK         |
| `EspWifiAuth.Wpa2Psk`        | `3`   | WPA2-PSK        |
| `EspWifiAuth.WpaWpa2Psk`     | `4`   | WPA/WPA2-PSK    |
| `EspWifiAuth.Wpa2Enterprise` | `5`   | WPA2 Enterprise |
| `EspWifiAuth.Wpa3Psk`        | `6`   | WPA3-PSK        |
| `EspWifiAuth.Wpa2Wpa3Psk`    | `7`   | WPA2/WPA3-PSK   |

Unknown future ESP-IDF authentication values may be returned as numbers not
listed above.

### Errors

```ts
import {
  EspProvisioningErrorCode,
  isEspProvisioningError,
} from '@evawave/expo-esp-idf-provisioning';

try {
  await device.connect({ proofOfPossession: 'abcd1234' });
} catch (error) {
  if (isEspProvisioningError(error)) {
    if (error.code === EspProvisioningErrorCode.CredentialsRequired) {
      // Ask the user for the device's proof of possession.
    }
    console.error(error.code, error.message);
  }
}
```

Applications should branch on `EspProvisioningErrorCode` and display or log the
message; they should not parse message text as an API contract.

| Error code                             | Meaning                                      |
| -------------------------------------- | -------------------------------------------- |
| `PermissionDenied`                     | Required Bluetooth permission is unavailable |
| `Timeout`                              | A native operation exceeded its deadline     |
| `Cancelled`                            | The app cancelled, disconnected, or disposed |
| `DiscoveryFailed`                      | BLE discovery could not start or complete    |
| `DeviceNotFound` / `DeviceNotPrepared` | Discovery or device lifecycle failure        |
| `Busy`                                 | A conflicting operation is already running   |
| `CredentialsRequired`                  | PoP or Security 2 username is missing        |
| `ConnectionFailed` / `Disconnected`    | BLE session connection failure               |
| `WifiScanFailed`                       | Device-side Wi-Fi scan failure               |
| `EndpointFailed`                       | Custom endpoint request failure              |
| `ProvisioningFailed`                   | Wi-Fi credential provisioning failure        |
| `InvalidArgument`                      | Unsupported or malformed input               |
| `Unknown`                              | An unclassified native failure               |

### Events

`connectionStateChanged` emits `connecting`, `connected`, and `disconnected`.
`provisioningProgress` emits `started`, `configApplied`, and `completed`.
Listeners are scoped to the `EspProvisioningDevice` instance and return a
subscription with `remove()`. Subscribe before starting an operation so the
initial event is not missed.

## Operation model

Only one request may run against a device at a time. A second request rejects
immediately instead of replacing the native SDK callback. Calling `cancel()` or
`disconnect()` rejects the pending request and closes the BLE connection.
`disconnect()` leaves the prepared device available for a later reconnect;
`dispose()` also removes its native entry and should be used when the app no
longer needs the device.

Android allows one active BLE device connection at a time because Espressif's
Android SDK publishes connection events without a device identifier. Disconnect
the current device before connecting another one. Reconnecting the same device
is allowed.

The iOS implementation also handles the ESPProvision 3.0.3 behavior where a
Wi-Fi scan can emit a transient protobuf error before returning a valid result.
Late callbacks after a timeout or cancellation are ignored.

## Native dependencies

- iOS: `ESPProvision ~> 3.0.3`
- Android: `com.github.espressif:esp-idf-provisioning-android:lib-2.4.4`

## Development

```sh
npm install
npm run verify
```

The example app is under `example/` and demonstrates runtime permissions,
discovery, connection events, Wi-Fi scanning, provisioning progress, and
device disposal. Native directories are generated with Expo Prebuild and are
excluded from the published package.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development and validation
workflow. Security issues should be reported according to
[SECURITY.md](SECURITY.md), not through a public issue.

Stable releases also require the physical-device checks in
[HARDWARE_TESTING.md](HARDWARE_TESTING.md).

## License

MIT

Third-party native SDK notices are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
