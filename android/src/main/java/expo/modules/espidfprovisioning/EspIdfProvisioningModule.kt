package expo.modules.espidfprovisioning

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.core.content.ContextCompat
import com.espressif.provisioning.DeviceConnectionEvent
import com.espressif.provisioning.ESPConstants
import com.espressif.provisioning.ESPDevice
import com.espressif.provisioning.ESPProvisionManager
import com.espressif.provisioning.WiFiAccessPoint
import com.espressif.provisioning.listeners.BleScanListener
import com.espressif.provisioning.listeners.ProvisionListener
import com.espressif.provisioning.listeners.ResponseListener
import com.espressif.provisioning.listeners.WiFiScanListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.greenrobot.eventbus.EventBus
import org.greenrobot.eventbus.Subscribe
import org.greenrobot.eventbus.ThreadMode
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

private data class PendingOperation(
  val id: String,
  val promise: Promise,
  val timeout: Runnable,
  val cleanup: (() -> Unit)?
)

private object ErrorCode {
  const val UNKNOWN = "ERR_ESP_PROVISIONING"
  const val PERMISSION_DENIED = "ERR_ESP_PROVISIONING_PERMISSION_DENIED"
  const val TIMEOUT = "ERR_ESP_PROVISIONING_TIMEOUT"
  const val CANCELLED = "ERR_ESP_PROVISIONING_CANCELLED"
  const val DISCOVERY_FAILED = "ERR_ESP_PROVISIONING_DISCOVERY_FAILED"
  const val DEVICE_NOT_FOUND = "ERR_ESP_PROVISIONING_DEVICE_NOT_FOUND"
  const val DEVICE_NOT_PREPARED = "ERR_ESP_PROVISIONING_DEVICE_NOT_PREPARED"
  const val BUSY = "ERR_ESP_PROVISIONING_BUSY"
  const val CREDENTIALS_REQUIRED = "ERR_ESP_PROVISIONING_CREDENTIALS_REQUIRED"
  const val CONNECTION_FAILED = "ERR_ESP_PROVISIONING_CONNECTION_FAILED"
  const val DISCONNECTED = "ERR_ESP_PROVISIONING_DISCONNECTED"
  const val WIFI_SCAN_FAILED = "ERR_ESP_PROVISIONING_WIFI_SCAN_FAILED"
  const val ENDPOINT_FAILED = "ERR_ESP_PROVISIONING_ENDPOINT_FAILED"
  const val PROVISIONING_FAILED = "ERR_ESP_PROVISIONING_PROVISIONING_FAILED"
  const val INVALID_ARGUMENT = "ERR_ESP_PROVISIONING_INVALID_ARGUMENT"
}

class EspIdfProvisioningModule : Module() {
  private val searchKey = "__device_search__"
  private val operationLock = Any()
  private val connectionStateLock = Any()
  // Written from BLE callback threads and read from the JS thread.
  private val devices = ConcurrentHashMap<String, ESPDevice>()
  private val connectionListeners = ConcurrentHashMap<String, Any>()
  private val connectionStates = ConcurrentHashMap<String, String>()
  private val pendingOperations = mutableMapOf<String, PendingOperation>()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var connectingDeviceName: String? = null
  private var connectedDeviceName: String? = null

  private val context: Context
    get() = appContext.reactContext
      ?: throw provisioningError(ErrorCode.UNKNOWN, "React context is unavailable.")

  private val provisionManager: ESPProvisionManager by lazy {
    ESPProvisionManager.getInstance(context)
  }

  override fun definition() = ModuleDefinition {
    Name("EspIdfProvisioning")
    Events("provisioningProgress", "connectionStateChanged")

    AsyncFunction("searchDevices") { prefix: String, security: Int, timeoutMs: Int, promise: Promise ->
      searchDevices(prefix, security, timeoutMs, promise)
    }

    Function("stopSearch") {
      provisionManager.stopBleScan()
      cancelOperation(searchKey, "Device search was cancelled.")
    }

    AsyncFunction("createDevice") { name: String, security: Int, promise: Promise ->
      createDevice(name, security, promise)
    }

    AsyncFunction("connect") {
      name: String,
      proofOfPossession: String?,
      username: String?,
      timeoutMs: Int,
      promise: Promise ->
      connect(name, proofOfPossession, username, timeoutMs, promise)
    }

    AsyncFunction("scanWifi") { name: String, timeoutMs: Int, promise: Promise ->
      scanWifi(name, timeoutMs, promise)
    }

    AsyncFunction("sendData") {
      name: String,
      endpoint: String,
      data: String,
      encoding: String,
      timeoutMs: Int,
      promise: Promise ->
      sendData(name, endpoint, data, encoding, timeoutMs, promise)
    }

    AsyncFunction("provision") {
      name: String,
      ssid: String,
      passphrase: String,
      timeoutMs: Int,
      promise: Promise ->
      provision(name, ssid, passphrase, timeoutMs, promise)
    }

    Function("cancel") { name: String ->
      val cancelled = cancelOperation(operationKey(name), "Operation was cancelled.")
      if (!cancelled) devices[name]?.let { disconnectManagedDevice(name, it) }
    }

    Function("disconnect") { name: String ->
      val cancelled = cancelOperation(operationKey(name), "Device was disconnected.")
      if (!cancelled) devices[name]?.let { disconnectManagedDevice(name, it) }
    }

    Function("dispose") { name: String ->
      cancelOperation(operationKey(name), "Device was disposed.")
      devices.remove(name)?.let { disconnectManagedDevice(name, it) }
      connectionStates.remove(name)
    }

    OnDestroy {
      provisionManager.stopBleScan()
      cancelAllOperations()
      connectionListeners.values.forEach(::unregisterEventListener)
      connectionListeners.clear()
      devices.forEach { (name, device) -> disconnectManagedDevice(name, device) }
      devices.clear()
      connectionStates.clear()
      clearAllConnectionState()
    }
  }

  @SuppressLint("MissingPermission")
  private fun searchDevices(prefix: String, security: Int, timeoutMs: Int, promise: Promise) {
    if (!hasBluetoothPermissions()) {
      promise.reject(provisioningError(ErrorCode.PERMISSION_DENIED, "Bluetooth scan/connect permissions are required."))
      return
    }

    val operationId = beginOperation(
      searchKey,
      timeoutMs,
      promise,
      cleanup = { provisionManager.stopBleScan() }
    ) ?: return

    val discoveredDevices = ConcurrentHashMap<String, ESPDevice>()
    val securityType = securityType(security)
    provisionManager.searchBleEspDevices(prefix, object : BleScanListener {
      override fun scanStartFailed() {
        rejectOperation(searchKey, operationId, "Bluetooth scan could not be started.", ErrorCode.DISCOVERY_FAILED)
      }

      override fun onPeripheralFound(device: BluetoothDevice?, scanResult: ScanResult?) {
        val bluetoothDevice = device ?: return
        val deviceName = scanResult?.scanRecord?.deviceName ?: return
        val serviceUuid = scanResult.scanRecord?.serviceUuids?.firstOrNull()?.toString() ?: return
        if (discoveredDevices.containsKey(deviceName)) return

        val espDevice = ESPDevice(context, ESPConstants.TransportType.TRANSPORT_BLE, securityType)
        espDevice.bluetoothDevice = bluetoothDevice
        espDevice.deviceName = deviceName
        espDevice.primaryServiceUuid = serviceUuid
        discoveredDevices[deviceName] = espDevice
      }

      override fun scanCompleted() {
        devices.putAll(discoveredDevices)
        val result = discoveredDevices.values.map {
          mapOf(
            "name" to it.deviceName,
            "transport" to "ble",
            "security" to security
          )
        }
        resolveOperation(searchKey, operationId, result)
      }

      override fun onFailure(error: Exception?) {
        rejectOperation(searchKey, operationId, error?.message ?: "Bluetooth scan failed.", ErrorCode.DISCOVERY_FAILED)
      }
    })
  }

  @SuppressLint("MissingPermission")
  private fun createDevice(
    name: String,
    security: Int,
    promise: Promise
  ) {
    val existing = devices[name]
    if (existing != null) {
      existing.securityType = securityType(security)
      promise.resolve(deviceInfo(existing, security))
      return
    }

    if (!hasBluetoothPermissions()) {
      promise.reject(provisioningError(ErrorCode.PERMISSION_DENIED, "Bluetooth scan/connect permissions are required."))
      return
    }

    val key = searchKey
    val operationId = beginOperation(
      key,
      10_000,
      promise,
      cleanup = { provisionManager.stopBleScan() }
    ) ?: return
    val securityType = securityType(security)

    provisionManager.searchBleEspDevices(name, object : BleScanListener {
      override fun scanStartFailed() {
        rejectOperation(key, operationId, "Bluetooth scan could not be started.", ErrorCode.DISCOVERY_FAILED)
      }

      override fun onPeripheralFound(device: BluetoothDevice?, scanResult: ScanResult?) {
        val bluetoothDevice = device ?: return
        val deviceName = scanResult?.scanRecord?.deviceName ?: return
        if (deviceName != name) return
        val serviceUuid = scanResult.scanRecord?.serviceUuids?.firstOrNull()?.toString() ?: return

        val espDevice = ESPDevice(context, ESPConstants.TransportType.TRANSPORT_BLE, securityType)
        espDevice.bluetoothDevice = bluetoothDevice
        espDevice.deviceName = deviceName
        espDevice.primaryServiceUuid = serviceUuid
        devices[name] = espDevice
        provisionManager.stopBleScan()
        resolveOperation(key, operationId, deviceInfo(espDevice, security))
      }

      override fun scanCompleted() {
        rejectOperation(key, operationId, "Device '$name' was not found.", ErrorCode.DEVICE_NOT_FOUND)
      }

      override fun onFailure(error: Exception?) {
        rejectOperation(key, operationId, error?.message ?: "Device search failed.", ErrorCode.DISCOVERY_FAILED)
      }
    })
  }

  @SuppressLint("MissingPermission")
  private fun connect(
    name: String,
    proofOfPossession: String?,
    username: String?,
    timeoutMs: Int,
    promise: Promise
  ) {
    val device = devices[name]
    if (device == null) {
      promise.reject(provisioningError(ErrorCode.DEVICE_NOT_PREPARED, "Device '$name' is not prepared."))
      return
    }
    if (!hasBluetoothPermissions()) {
      promise.reject(provisioningError(ErrorCode.PERMISSION_DENIED, "Bluetooth connect permission is required."))
      return
    }
    device.proofOfPossession = proofOfPossession
    device.userName = username
    if (!reserveConnection(name, promise)) return

    val key = operationKey(name)
    var listener: Any? = null
    val operationId = beginOperation(
      key,
      timeoutMs,
      promise,
      cleanup = {
        listener?.let(::unregisterEventListener)
        disconnectManagedDevice(name, device)
      }
    ) ?: run {
      clearConnectionState(name)
      return
    }

    val eventListener = object {
      @Subscribe(threadMode = ThreadMode.MAIN)
      fun onEvent(event: DeviceConnectionEvent) {
        when (event.eventType) {
          ESPConstants.EVENT_DEVICE_CONNECTED -> {
            val security1NeedsProof =
              device.securityType == ESPConstants.SecurityType.SECURITY_1 &&
                device.proofOfPossession.isNullOrEmpty() &&
                device.deviceCapabilities?.contains("no_pop") != true
            if (security1NeedsProof) {
              if (rejectOperation(
                  key,
                  operationId,
                  "Security 1 device '$name' requires proofOfPossession.",
                  ErrorCode.CREDENTIALS_REQUIRED
                )) {
                disconnectManagedDevice(name, device)
              }
              return
            }
            if (resolveOperation(key, operationId, null)) {
              markConnected(name)
              updateConnectionState(name, "connected")
            }
          }
          ESPConstants.EVENT_DEVICE_CONNECTION_FAILED -> {
            rejectOperation(key, operationId, "Device connection failed.", ErrorCode.CONNECTION_FAILED)
            disconnectManagedDevice(name, device)
          }
          ESPConstants.EVENT_DEVICE_DISCONNECTED -> {
            rejectOperation(key, operationId, "Device disconnected while connecting.", ErrorCode.DISCONNECTED)
            cancelOperation(key, "Device disconnected during the active operation.", ErrorCode.DISCONNECTED)
            disconnectManagedDevice(name, device)
          }
        }
      }
    }
    listener = eventListener
    connectionListeners.remove(name)?.let(::unregisterEventListener)
    connectionListeners[name] = eventListener
    EventBus.getDefault().register(eventListener)
    updateConnectionState(name, "connecting")
    device.connectToDevice()
  }

  private fun scanWifi(name: String, timeoutMs: Int, promise: Promise) {
    val device = devices[name]
    if (device == null) {
      promise.reject(provisioningError(ErrorCode.DEVICE_NOT_PREPARED, "Device '$name' is not prepared."))
      return
    }
    val key = operationKey(name)
    val operationId = beginOperation(
      key,
      timeoutMs,
      promise,
      cleanup = { disconnectManagedDevice(name, device) }
    ) ?: return

    device.scanNetworks(object : WiFiScanListener {
      override fun onWifiListReceived(wifiList: ArrayList<WiFiAccessPoint>?) {
        val result = wifiList.orEmpty().map {
          mapOf(
            "ssid" to it.wifiName,
            "rssi" to it.rssi,
            "auth" to it.security
          )
        }
        resolveOperation(key, operationId, result)
      }

      override fun onWiFiScanFailed(error: Exception?) {
        rejectOperation(key, operationId, error?.message ?: "Wi-Fi scan failed.", ErrorCode.WIFI_SCAN_FAILED)
      }
    })
  }

  private fun sendData(
    name: String,
    endpoint: String,
    data: String,
    encoding: String,
    timeoutMs: Int,
    promise: Promise
  ) {
    val device = devices[name]
    if (device == null) {
      promise.reject(provisioningError(ErrorCode.DEVICE_NOT_PREPARED, "Device '$name' is not prepared."))
      return
    }

    val requestData = when (encoding) {
      "utf8" -> data.toByteArray(StandardCharsets.UTF_8)
      "base64" -> try {
        Base64.decode(data, Base64.DEFAULT)
      } catch (_: IllegalArgumentException) {
        null
      }
      else -> null
    }
    if (requestData == null) {
      promise.reject(provisioningError(ErrorCode.INVALID_ARGUMENT, "Data could not be decoded as $encoding."))
      return
    }

    val key = operationKey(name)
    val operationId = beginOperation(
      key,
      timeoutMs,
      promise,
      cleanup = { disconnectManagedDevice(name, device) }
    ) ?: return
    device.sendDataToCustomEndPoint(endpoint, requestData, object : ResponseListener {
      override fun onSuccess(returnData: ByteArray?) {
        val response = returnData ?: byteArrayOf()
        val result = if (encoding == "base64") {
          Base64.encodeToString(response, Base64.NO_WRAP)
        } else {
          String(response, StandardCharsets.UTF_8)
        }
        resolveOperation(key, operationId, result)
      }

      override fun onFailure(error: Exception?) {
        rejectOperation(key, operationId, error?.message ?: "Endpoint request failed.", ErrorCode.ENDPOINT_FAILED)
      }
    })
  }

  private fun provision(
    name: String,
    ssid: String,
    passphrase: String,
    timeoutMs: Int,
    promise: Promise
  ) {
    val device = devices[name]
    if (device == null) {
      promise.reject(provisioningError(ErrorCode.DEVICE_NOT_PREPARED, "Device '$name' is not prepared."))
      return
    }
    val key = operationKey(name)
    val operationId = beginOperation(
      key,
      timeoutMs,
      promise,
      cleanup = { disconnectManagedDevice(name, device) }
    ) ?: return

    sendProvisioningProgress(name, "started")
    device.provision(ssid, passphrase, object : ProvisionListener {
      override fun createSessionFailed(error: Exception?) = fail(error, "Session creation failed.")
      override fun wifiConfigSent() = Unit
      override fun wifiConfigFailed(error: Exception?) = fail(error, "Sending Wi-Fi config failed.")
      override fun wifiConfigApplied() {
        if (isOperationPending(key, operationId)) {
          sendProvisioningProgress(name, "configApplied")
        }
      }
      override fun wifiConfigApplyFailed(error: Exception?) = fail(error, "Applying Wi-Fi config failed.")
      override fun provisioningFailedFromDevice(reason: ESPConstants.ProvisionFailureReason?) {
        rejectOperation(key, operationId, reason?.toString() ?: "Device rejected provisioning.", ErrorCode.PROVISIONING_FAILED)
      }
      override fun deviceProvisioningSuccess() {
        if (resolveOperation(key, operationId, null)) {
          sendProvisioningProgress(name, "completed")
        }
      }
      override fun onProvisioningFailed(error: Exception?) = fail(error, "Provisioning failed.")

      private fun fail(error: Exception?, fallback: String) {
        rejectOperation(key, operationId, error?.message ?: fallback, ErrorCode.PROVISIONING_FAILED)
      }
    })
  }

  private fun reserveConnection(name: String, promise: Promise): Boolean =
    synchronized(connectionStateLock) {
      val otherDevice = connectingDeviceName ?: connectedDeviceName
      if (otherDevice != null && otherDevice != name) {
        promise.reject(
          provisioningError(
            ErrorCode.BUSY,
            "Another BLE device '$otherDevice' is connecting or connected. " +
              "Disconnect it before connecting '$name'."
          )
        )
        false
      } else {
        connectingDeviceName = name
        connectedDeviceName = null
        true
      }
    }

  private fun markConnected(name: String) {
    synchronized(connectionStateLock) {
      if (connectingDeviceName == name) {
        connectingDeviceName = null
        connectedDeviceName = name
      }
    }
  }

  private fun clearConnectionState(name: String) {
    synchronized(connectionStateLock) {
      if (connectingDeviceName == name) connectingDeviceName = null
      if (connectedDeviceName == name) connectedDeviceName = null
    }
  }

  private fun clearAllConnectionState() {
    synchronized(connectionStateLock) {
      connectingDeviceName = null
      connectedDeviceName = null
    }
  }

  private fun disconnectManagedDevice(name: String, device: ESPDevice) {
    connectionListeners.remove(name)?.let(::unregisterEventListener)
    clearConnectionState(name)
    device.proofOfPossession = null
    device.userName = null
    device.disconnectDevice()
    updateConnectionState(name, "disconnected")
  }

  private fun updateConnectionState(name: String, state: String) {
    if (state == "disconnected" && connectionStates[name] == null) return
    if (connectionStates.put(name, state) == state) return
    sendEvent("connectionStateChanged", mapOf("deviceName" to name, "state" to state))
  }

  private fun sendProvisioningProgress(name: String, progress: String) {
    sendEvent("provisioningProgress", mapOf("deviceName" to name, "progress" to progress))
  }

  private fun deviceInfo(device: ESPDevice, security: Int): Map<String, Any> = mapOf(
    "name" to (device.deviceName ?: ""),
    "transport" to "ble",
    "security" to security
  )

  private fun securityType(value: Int): ESPConstants.SecurityType = when (value) {
    0 -> ESPConstants.SecurityType.SECURITY_0
    1 -> ESPConstants.SecurityType.SECURITY_1
    2 -> ESPConstants.SecurityType.SECURITY_2
    else -> throw provisioningError(ErrorCode.INVALID_ARGUMENT, "Unsupported ESP security version: $value")
  }

  private fun hasBluetoothPermissions(): Boolean {
    val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      arrayOf(
        Manifest.permission.BLUETOOTH,
        Manifest.permission.BLUETOOTH_ADMIN,
        Manifest.permission.ACCESS_FINE_LOCATION
      )
    }
    return permissions.all {
      ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }
  }

  private fun operationKey(deviceName: String) = "device:$deviceName"

  private fun beginOperation(
    key: String,
    timeoutMs: Int,
    promise: Promise,
    cleanup: (() -> Unit)? = null
  ): String? {
    synchronized(operationLock) {
      if (pendingOperations.containsKey(key)) {
        promise.reject(provisioningError(ErrorCode.BUSY, "Another operation is already running for '$key'."))
        return null
      }
      val id = UUID.randomUUID().toString()
      val timeout = Runnable {
        rejectOperation(key, id, "Operation timed out after $timeoutMs ms.", ErrorCode.TIMEOUT, runCleanup = true)
      }
      pendingOperations[key] = PendingOperation(id, promise, timeout, cleanup)
      mainHandler.postDelayed(timeout, timeoutMs.coerceAtLeast(1).toLong())
      return id
    }
  }

  private fun takeOperation(key: String, id: String): PendingOperation? {
    val operation = synchronized(operationLock) {
      val current = pendingOperations[key]
      if (current?.id != id) return null
      pendingOperations.remove(key)
    }
    if (operation != null) mainHandler.removeCallbacks(operation.timeout)
    return operation
  }

  private fun isOperationPending(key: String, id: String): Boolean =
    synchronized(operationLock) { pendingOperations[key]?.id == id }

  private fun resolveOperation(key: String, id: String, value: Any?): Boolean {
    val operation = takeOperation(key, id) ?: return false
    operation.promise.resolve(value)
    return true
  }

  private fun rejectOperation(
    key: String,
    id: String,
    message: String,
    code: String = ErrorCode.UNKNOWN,
    runCleanup: Boolean = false
  ): Boolean {
    val operation = takeOperation(key, id) ?: return false
    if (runCleanup) operation.cleanup?.invoke()
    operation.promise.reject(provisioningError(code, message))
    return true
  }

  private fun cancelOperation(
    key: String,
    message: String,
    code: String = ErrorCode.CANCELLED
  ): Boolean {
    val operation = synchronized(operationLock) { pendingOperations.remove(key) } ?: return false
    mainHandler.removeCallbacks(operation.timeout)
    operation.cleanup?.invoke()
    operation.promise.reject(provisioningError(code, message))
    return true
  }

  private fun cancelAllOperations() {
    val operations = synchronized(operationLock) {
      val copy = pendingOperations.values.toList()
      pendingOperations.clear()
      copy
    }
    operations.forEach {
      mainHandler.removeCallbacks(it.timeout)
      it.cleanup?.invoke()
      it.promise.reject(provisioningError(ErrorCode.CANCELLED, "Module was destroyed."))
    }
  }

  private fun unregisterEventListener(listener: Any) {
    if (EventBus.getDefault().isRegistered(listener)) {
      EventBus.getDefault().unregister(listener)
    }
  }

  private fun provisioningError(code: String, message: String) =
    CodedException(code, message, null)
}
