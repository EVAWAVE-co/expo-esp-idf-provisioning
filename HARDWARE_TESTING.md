# Hardware test matrix

Run this matrix before publishing a stable release. BLE provisioning cannot be
fully validated with an emulator or simulator.

Record the package version, Expo SDK, development-build commit, phone model and
OS version, ESP chip, ESP-IDF version, provisioning security version, and Wi-Fi
access-point configuration for every run.

## Required devices

- One supported physical Android phone
- One supported physical iPhone
- One ESP device advertising the ESP-IDF Unified Provisioning BLE service
- A 2.4 GHz Wi-Fi access point with known credentials

## Test each mobile platform

- Grant Bluetooth permissions and discover the ESP device.
- Deny Bluetooth permissions and confirm that the returned error is actionable.
- Connect using Security 0, Security 1, and Security 2 when the firmware supports
  them. For Security 2, verify both valid and invalid username/proof-of-possession
  combinations.
- Scan Wi-Fi networks and confirm that SSID, RSSI, and security values are
  returned without duplicates or stale results.
- Provision valid Wi-Fi credentials and confirm that the ESP device joins the
  selected access point.
- Provision invalid Wi-Fi credentials and confirm that the operation rejects
  with `ERR_ESP_PROVISIONING_PROVISIONING_FAILED` and a useful native message.
- Confirm connection events report `connecting`, `connected`, and
  `disconnected`, and provisioning reports `started`, `configApplied`, and
  `completed` in order.
- Send UTF-8 and base64 payloads to a custom endpoint and validate the response.
- Cancel or interrupt discovery, connection, Wi-Fi scanning, custom-data, and
  provisioning operations. Confirm that each promise settles once and that a
  retry succeeds without restarting the app.
- Turn the ESP device off during every operation. Confirm that timeout or
  disconnect cleanup releases the BLE connection and that a later retry works.
- Background and foreground the app during discovery and an active connection.
- On Android, try connecting a second ESP device while one is connected. Confirm
  that it rejects without disturbing the first device, then disconnect the first
  device and connect the second one successfully.
- Repeat discovery and provisioning at least 10 times while watching for native
  crashes, duplicate devices, retained connections, and increasing memory use.
- Dispose every discovered device after use and confirm a later discovery
  creates a fresh, working native device entry.

## Release evidence

Attach sanitized native logs and a completed result table to the release pull
request. Never include Wi-Fi passwords, proof-of-possession values, Security 2
usernames, or product-specific endpoint secrets.

| Platform | Security | Discovery | Wi-Fi scan | Provision | Endpoint | Cancel/retry | Result |
| -------- | -------- | --------- | ---------- | --------- | -------- | ------------ | ------ |
| Android  | 0        |           |            |           |          |              |        |
| Android  | 1        |           |            |           |          |              |        |
| Android  | 2        |           |            |           |          |              |        |
| iOS      | 0        |           |            |           |          |              |        |
| iOS      | 1        |           |            |           |          |              |        |
| iOS      | 2        |           |            |           |          |              |        |
