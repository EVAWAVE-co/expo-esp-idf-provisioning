import CoreBluetooth
import ESPProvision
import ExpoModulesCore
import Foundation

private final class EspProvisioningException: GenericException<String>, @unchecked Sendable {
  private let errorCode: String

  init(_ code: String, _ message: String) {
    self.errorCode = code
    super.init(message)
  }

  override var code: String { errorCode }
  override var reason: String { param }
}

private enum ErrorCode {
  static let unknown = "ERR_ESP_PROVISIONING"
  static let permissionDenied = "ERR_ESP_PROVISIONING_PERMISSION_DENIED"
  static let timeout = "ERR_ESP_PROVISIONING_TIMEOUT"
  static let cancelled = "ERR_ESP_PROVISIONING_CANCELLED"
  static let discoveryFailed = "ERR_ESP_PROVISIONING_DISCOVERY_FAILED"
  static let deviceNotFound = "ERR_ESP_PROVISIONING_DEVICE_NOT_FOUND"
  static let deviceNotPrepared = "ERR_ESP_PROVISIONING_DEVICE_NOT_PREPARED"
  static let busy = "ERR_ESP_PROVISIONING_BUSY"
  static let credentialsRequired = "ERR_ESP_PROVISIONING_CREDENTIALS_REQUIRED"
  static let connectionFailed = "ERR_ESP_PROVISIONING_CONNECTION_FAILED"
  static let disconnected = "ERR_ESP_PROVISIONING_DISCONNECTED"
  static let wifiScanFailed = "ERR_ESP_PROVISIONING_WIFI_SCAN_FAILED"
  static let endpointFailed = "ERR_ESP_PROVISIONING_ENDPOINT_FAILED"
  static let provisioningFailed = "ERR_ESP_PROVISIONING_PROVISIONING_FAILED"
  static let invalidArgument = "ERR_ESP_PROVISIONING_INVALID_ARGUMENT"
}

private struct PendingOperation {
  let id: UUID
  let promise: Promise
  let timeout: DispatchWorkItem
  let cleanup: (() -> Void)?
}

private final class ConnectionCredentials: ESPDeviceConnectionDelegate {
  private let proofOfPossession: String?
  private let username: String?
  private let onMissingCredential: (String) -> Void

  init(
    proofOfPossession: String?,
    username: String?,
    onMissingCredential: @escaping (String) -> Void
  ) {
    self.proofOfPossession = proofOfPossession
    self.username = username
    self.onMissingCredential = onMissingCredential
  }

  func getProofOfPossesion(
    forDevice _: ESPDevice,
    completionHandler: @escaping (String) -> Void
  ) {
    guard let proofOfPossession, !proofOfPossession.isEmpty else {
      onMissingCredential("Device requires proofOfPossession.")
      return
    }
    completionHandler(proofOfPossession)
  }

  func getUsername(
    forDevice _: ESPDevice,
    completionHandler: @escaping (String?) -> Void
  ) {
    guard let username, !username.isEmpty else {
      onMissingCredential("Security 2 device requires username.")
      return
    }
    completionHandler(username)
  }
}

public final class EspIdfProvisioningModule: Module {
  private let searchKey = "__device_search__"
  private let operationLock = NSLock()
  private let devicesLock = NSLock()
  // Written from ESPProvision callback threads and read from the JS thread.
  private var devices: [String: ESPDevice] = [:]
  private var connectionStates: [String: String] = [:]
  private var pendingOperations: [String: PendingOperation] = [:]

  public func definition() -> ModuleDefinition {
    Name("EspIdfProvisioning")
    Events("provisioningProgress", "connectionStateChanged")

    AsyncFunction("searchDevices") {
      (prefix: String, security: Int, timeoutMs: Int, promise: Promise) in
      self.searchDevices(prefix: prefix, security: security, timeoutMs: timeoutMs, promise: promise)
    }

    Function("stopSearch") {
      ESPProvisionManager.shared.stopESPDevicesSearch()
      self.cancelOperation(key: self.searchKey, message: "Device search was cancelled.")
    }

    AsyncFunction("createDevice") { (name: String, security: Int, promise: Promise) in
      self.createDevice(name: name, security: security, promise: promise)
    }

    AsyncFunction("connect") {
      (name: String, proofOfPossession: String?, username: String?, timeoutMs: Int, promise: Promise) in
      guard let device = self.device(named: name) else {
        promise.reject(EspProvisioningException(ErrorCode.deviceNotPrepared, "Device '\(name)' is not prepared."))
        return
      }
      guard self.hasBluetoothPermission() else {
        promise.reject(EspProvisioningException(ErrorCode.permissionDenied, "Bluetooth permission is required."))
        return
      }
      let key = self.operationKey(name)
      guard let operationId = self.beginOperation(
        key: key,
        timeoutMs: timeoutMs,
        promise: promise,
        cleanup: { self.disconnectManagedDevice(name: name, device: device) }
      ) else {
        return
      }

      let credentials = ConnectionCredentials(
        proofOfPossession: proofOfPossession,
        username: username
      ) { [weak self, weak device] message in
        guard let self, let device else {
          return
        }
        self.disconnectManagedDevice(name: name, device: device)
        self.rejectOperation(key: key, id: operationId, message: message, code: ErrorCode.credentialsRequired)
      }
      self.updateConnectionState(name: name, state: "connecting")
      device.connect(delegate: credentials) { status in
        switch status {
        case .connected:
          if self.resolveOperation(key: key, id: operationId, value: nil) {
            self.updateConnectionState(name: name, state: "connected")
          }
        case .failedToConnect(let error):
          self.disconnectManagedDevice(name: name, device: device)
          self.rejectOperation(key: key, id: operationId, message: error.description, code: ErrorCode.connectionFailed)
        case .disconnected:
          self.rejectOperation(key: key, id: operationId, message: "Device disconnected while connecting.", code: ErrorCode.disconnected)
          self.cancelOperation(
            key: key,
            message: "Device disconnected during the active operation.",
            code: ErrorCode.disconnected
          )
          self.disconnectManagedDevice(name: name, device: device)
        }
      }
    }

    AsyncFunction("scanWifi") { (name: String, timeoutMs: Int, promise: Promise) in
      guard let device = self.device(named: name) else {
        promise.reject(EspProvisioningException(ErrorCode.deviceNotPrepared, "Device '\(name)' is not prepared."))
        return
      }
      let key = self.operationKey(name)
      guard let operationId = self.beginOperation(
        key: key,
        timeoutMs: timeoutMs,
        promise: promise,
        cleanup: { self.disconnectManagedDevice(name: name, device: device) }
      ) else {
        return
      }

      device.scanWifiList { wifiList, error in
        if let wifiList {
          let result: [[String: Any]] = wifiList.map { network in
            [
              "ssid": network.ssid,
              "bssid": network.bssid.toHexString(),
              "rssi": network.rssi,
              "auth": network.auth.rawValue,
              "channel": network.channel
            ]
          }
          self.resolveOperation(key: key, id: operationId, value: result)
          return
        }

        guard let error else {
          self.rejectOperation(key: key, id: operationId, message: "Wi-Fi scan returned no result.", code: ErrorCode.wifiScanFailed)
          return
        }

        switch error {
        case .emptyResultCount:
          self.resolveOperation(key: key, id: operationId, value: [])
        case .scanRequestError:
          // ESPProvision 3.0.3 may emit a transient protobuf error and then a valid
          // result for the same scan. Give the second callback a short grace period.
          DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            self.rejectOperation(key: key, id: operationId, message: error.description, code: ErrorCode.wifiScanFailed)
          }
        default:
          self.rejectOperation(key: key, id: operationId, message: error.description, code: ErrorCode.wifiScanFailed)
        }
      }
    }

    AsyncFunction("sendData") {
      (name: String, endpoint: String, data: String, encoding: String, timeoutMs: Int, promise: Promise) in
      guard let device = self.device(named: name) else {
        promise.reject(EspProvisioningException(ErrorCode.deviceNotPrepared, "Device '\(name)' is not prepared."))
        return
      }

      let requestData: Data?
      switch encoding {
      case "utf8":
        requestData = data.data(using: .utf8)
      case "base64":
        requestData = Data(base64Encoded: data)
      default:
        requestData = nil
      }
      guard let requestData else {
        promise.reject(EspProvisioningException(ErrorCode.invalidArgument, "Data could not be decoded as \(encoding)."))
        return
      }

      let key = self.operationKey(name)
      guard let operationId = self.beginOperation(
        key: key,
        timeoutMs: timeoutMs,
        promise: promise,
        cleanup: { self.disconnectManagedDevice(name: name, device: device) }
      ) else {
        return
      }

      device.sendData(path: endpoint, data: requestData) { response, error in
        if let error {
          self.rejectOperation(key: key, id: operationId, message: error.description, code: ErrorCode.endpointFailed)
          return
        }
        guard let response else {
          self.rejectOperation(key: key, id: operationId, message: "Endpoint returned no data.", code: ErrorCode.endpointFailed)
          return
        }

        if encoding == "base64" {
          self.resolveOperation(key: key, id: operationId, value: response.base64EncodedString())
        } else if let text = String(data: response, encoding: .utf8) {
          self.resolveOperation(key: key, id: operationId, value: text)
        } else {
          self.rejectOperation(key: key, id: operationId, message: "Endpoint response is not valid UTF-8.", code: ErrorCode.endpointFailed)
        }
      }
    }

    AsyncFunction("provision") {
      (name: String, ssid: String, passphrase: String, timeoutMs: Int, promise: Promise) in
      guard let device = self.device(named: name) else {
        promise.reject(EspProvisioningException(ErrorCode.deviceNotPrepared, "Device '\(name)' is not prepared."))
        return
      }
      let key = self.operationKey(name)
      guard let operationId = self.beginOperation(
        key: key,
        timeoutMs: timeoutMs,
        promise: promise,
        cleanup: { self.disconnectManagedDevice(name: name, device: device) }
      ) else {
        return
      }

      self.sendProvisioningProgress(name: name, progress: "started")
      device.provision(ssid: ssid, passPhrase: passphrase) { status in
        switch status {
        case .success:
          if self.resolveOperation(key: key, id: operationId, value: nil) {
            self.sendProvisioningProgress(name: name, progress: "completed")
          }
        case .failure(let error):
          self.rejectOperation(key: key, id: operationId, message: error.description, code: ErrorCode.provisioningFailed)
        case .configApplied:
          if self.isOperationPending(key: key, id: operationId) {
            self.sendProvisioningProgress(name: name, progress: "configApplied")
          }
        }
      }
    }

    Function("cancel") { (name: String) in
      self.cancelOperation(key: self.operationKey(name), message: "Operation was cancelled.")
      if let device = self.device(named: name) {
        self.disconnectManagedDevice(name: name, device: device)
      }
    }

    Function("disconnect") { (name: String) in
      self.cancelOperation(key: self.operationKey(name), message: "Device was disconnected.")
      if let device = self.device(named: name) {
        self.disconnectManagedDevice(name: name, device: device)
      }
    }

    Function("dispose") { (name: String) in
      self.cancelOperation(key: self.operationKey(name), message: "Device was disposed.")
      if let device = self.removeDevice(named: name) {
        self.disconnectManagedDevice(name: name, device: device)
      }
      self.removeConnectionState(name: name)
    }

    OnDestroy {
      ESPProvisionManager.shared.stopESPDevicesSearch()
      self.cancelAllOperations()
      for (name, device) in self.removeAllDevices() {
        self.disconnectManagedDevice(name: name, device: device)
      }
    }
  }

  private func searchDevices(prefix: String, security: Int, timeoutMs: Int, promise: Promise) {
    guard hasBluetoothPermission() else {
      promise.reject(EspProvisioningException(ErrorCode.permissionDenied, "Bluetooth permission is required."))
      return
    }
    guard let operationId = beginOperation(
      key: searchKey,
      timeoutMs: timeoutMs,
      promise: promise,
      cleanup: { ESPProvisionManager.shared.stopESPDevicesSearch() }
    ) else {
      return
    }

    let securityValue = ESPSecurity(rawValue: security)
    ESPProvisionManager.shared.searchESPDevices(
      devicePrefix: prefix,
      transport: .ble,
      security: securityValue
    ) { foundDevices, error in
      if let error {
        self.rejectOperation(key: self.searchKey, id: operationId, message: error.description, code: ErrorCode.discoveryFailed)
        return
      }
      let foundDevices = foundDevices ?? []
      foundDevices.forEach { self.storeDevice($0, name: $0.name) }
      let result: [[String: Any]] = foundDevices.map {
        ["name": $0.name, "transport": "ble", "security": $0.security.rawValue]
      }
      self.resolveOperation(key: self.searchKey, id: operationId, value: result)
    }
  }

  private func createDevice(
    name: String,
    security: Int,
    promise: Promise
  ) {
    guard hasBluetoothPermission() else {
      promise.reject(EspProvisioningException(ErrorCode.permissionDenied, "Bluetooth permission is required."))
      return
    }
    let key = searchKey
    guard let operationId = beginOperation(key: key, timeoutMs: 10_000, promise: promise) else {
      return
    }
    let securityValue = ESPSecurity(rawValue: security)

    ESPProvisionManager.shared.createESPDevice(
      deviceName: name,
      transport: .ble,
      security: securityValue,
      proofOfPossession: nil,
      softAPPassword: nil,
      username: nil
    ) { device, error in
      if let error {
        self.rejectOperation(key: key, id: operationId, message: error.description, code: ErrorCode.discoveryFailed)
        return
      }
      guard let device else {
        self.rejectOperation(key: key, id: operationId, message: "ESPProvision did not create a device.", code: ErrorCode.deviceNotFound)
        return
      }
      self.storeDevice(device, name: name)
      self.resolveOperation(
        key: key,
        id: operationId,
        value: ["name": device.name, "transport": "ble", "security": device.security.rawValue]
      )
    }
  }

  private func operationKey(_ deviceName: String) -> String {
    "device:\(deviceName)"
  }

  private func hasBluetoothPermission() -> Bool {
    let authorization = CBManager.authorization
    return authorization != .denied && authorization != .restricted
  }

  private static func disconnectDevice(_ device: ESPDevice) {
    device.delegate = nil
    device.username = nil
    device.disconnect()
  }

  private func disconnectManagedDevice(name: String, device: ESPDevice) {
    Self.disconnectDevice(device)
    updateConnectionState(name: name, state: "disconnected")
  }

  private func device(named name: String) -> ESPDevice? {
    devicesLock.lock()
    defer { devicesLock.unlock() }
    return devices[name]
  }

  private func storeDevice(_ device: ESPDevice, name: String) {
    devicesLock.lock()
    defer { devicesLock.unlock() }
    devices[name] = device
  }

  private func removeDevice(named name: String) -> ESPDevice? {
    devicesLock.lock()
    defer { devicesLock.unlock() }
    return devices.removeValue(forKey: name)
  }

  private func removeAllDevices() -> [(String, ESPDevice)] {
    devicesLock.lock()
    defer { devicesLock.unlock() }
    let all = Array(devices)
    devices.removeAll()
    return all
  }

  private func updateConnectionState(name: String, state: String) {
    devicesLock.lock()
    if state == "disconnected" && connectionStates[name] == nil {
      devicesLock.unlock()
      return
    }
    let previous = connectionStates.updateValue(state, forKey: name)
    devicesLock.unlock()
    guard previous != state else {
      return
    }
    sendEvent("connectionStateChanged", ["deviceName": name, "state": state])
  }

  private func removeConnectionState(name: String) {
    devicesLock.lock()
    connectionStates.removeValue(forKey: name)
    devicesLock.unlock()
  }

  private func sendProvisioningProgress(name: String, progress: String) {
    sendEvent("provisioningProgress", ["deviceName": name, "progress": progress])
  }

  private func beginOperation(
    key: String,
    timeoutMs: Int,
    promise: Promise,
    cleanup: (() -> Void)? = nil
  ) -> UUID? {
    operationLock.lock()
    defer { operationLock.unlock() }

    guard pendingOperations[key] == nil else {
      promise.reject(EspProvisioningException(ErrorCode.busy, "Another operation is already running for '\(key)'."))
      return nil
    }

    let id = UUID()
    let timeout = DispatchWorkItem { [weak self] in
      self?.rejectOperation(
        key: key,
        id: id,
        message: "Operation timed out after \(timeoutMs) ms.",
        code: ErrorCode.timeout,
        runCleanup: true
      )
    }
    pendingOperations[key] = PendingOperation(id: id, promise: promise, timeout: timeout, cleanup: cleanup)
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(max(timeoutMs, 1)), execute: timeout)
    return id
  }

  private func takeOperation(key: String, id: UUID) -> PendingOperation? {
    operationLock.lock()
    defer { operationLock.unlock() }
    guard let operation = pendingOperations[key], operation.id == id else {
      return nil
    }
    pendingOperations.removeValue(forKey: key)
    operation.timeout.cancel()
    return operation
  }

  @discardableResult
  private func resolveOperation(key: String, id: UUID, value: Any?) -> Bool {
    guard let operation = takeOperation(key: key, id: id) else {
      return false
    }
    operation.promise.resolve(value)
    return true
  }

  private func isOperationPending(key: String, id: UUID) -> Bool {
    operationLock.lock()
    defer { operationLock.unlock() }
    return pendingOperations[key]?.id == id
  }

  private func rejectOperation(
    key: String,
    id: UUID,
    message: String,
    code: String = ErrorCode.unknown,
    runCleanup: Bool = false
  ) {
    guard let operation = takeOperation(key: key, id: id) else {
      return
    }
    if runCleanup {
      operation.cleanup?()
    }
    operation.promise.reject(EspProvisioningException(code, message))
  }

  private func cancelOperation(
    key: String,
    message: String,
    code: String = ErrorCode.cancelled
  ) {
    operationLock.lock()
    let operation = pendingOperations.removeValue(forKey: key)
    operationLock.unlock()
    operation?.timeout.cancel()
    operation?.cleanup?()
    operation?.promise.reject(EspProvisioningException(code, message))
  }

  private func cancelAllOperations() {
    operationLock.lock()
    let operations = Array(pendingOperations.values)
    pendingOperations.removeAll()
    operationLock.unlock()
    operations.forEach {
      $0.timeout.cancel()
      $0.cleanup?()
      $0.promise.reject(EspProvisioningException(ErrorCode.cancelled, "Module was destroyed."))
    }
  }
}
