export enum EspSecurity {
  Security0 = 0,
  Security1 = 1,
  Security2 = 2,
}

export enum EspWifiAuth {
  Open = 0,
  Wep = 1,
  WpaPsk = 2,
  Wpa2Psk = 3,
  WpaWpa2Psk = 4,
  Wpa2Enterprise = 5,
  Wpa3Psk = 6,
  Wpa2Wpa3Psk = 7,
}

export enum EspProvisioningErrorCode {
  Unknown = 'ERR_ESP_PROVISIONING',
  PermissionDenied = 'ERR_ESP_PROVISIONING_PERMISSION_DENIED',
  Timeout = 'ERR_ESP_PROVISIONING_TIMEOUT',
  Cancelled = 'ERR_ESP_PROVISIONING_CANCELLED',
  DiscoveryFailed = 'ERR_ESP_PROVISIONING_DISCOVERY_FAILED',
  DeviceNotFound = 'ERR_ESP_PROVISIONING_DEVICE_NOT_FOUND',
  DeviceNotPrepared = 'ERR_ESP_PROVISIONING_DEVICE_NOT_PREPARED',
  Busy = 'ERR_ESP_PROVISIONING_BUSY',
  CredentialsRequired = 'ERR_ESP_PROVISIONING_CREDENTIALS_REQUIRED',
  ConnectionFailed = 'ERR_ESP_PROVISIONING_CONNECTION_FAILED',
  Disconnected = 'ERR_ESP_PROVISIONING_DISCONNECTED',
  WifiScanFailed = 'ERR_ESP_PROVISIONING_WIFI_SCAN_FAILED',
  EndpointFailed = 'ERR_ESP_PROVISIONING_ENDPOINT_FAILED',
  ProvisioningFailed = 'ERR_ESP_PROVISIONING_PROVISIONING_FAILED',
  InvalidArgument = 'ERR_ESP_PROVISIONING_INVALID_ARGUMENT',
}

export type EspProvisioningError = Error & {
  code: EspProvisioningErrorCode;
};

export type EspTransport = 'ble';

export type EspDeviceInfo = {
  name: string;
  transport: EspTransport;
  security: EspSecurity;
};

export type EspWifiNetwork = {
  ssid: string;
  bssid?: string;
  rssi: number;
  auth: EspWifiAuth | number;
  channel?: number;
};

export type SearchDevicesOptions = {
  prefix: string;
  security?: EspSecurity;
  timeoutMs?: number;
};

export type CreateDeviceOptions = {
  name: string;
  security?: EspSecurity;
};

export type OperationOptions = {
  timeoutMs?: number;
};

export type SecurityCredentials = {
  proofOfPossession?: string;
  username?: string;
};

export type ConnectOptions = OperationOptions & SecurityCredentials;

export type ProvisionOptions = OperationOptions & {
  ssid: string;
  passphrase: string;
};

export enum EspProvisioningProgress {
  Started = 'started',
  ConfigApplied = 'configApplied',
  Completed = 'completed',
}

export enum EspConnectionState {
  Connecting = 'connecting',
  Connected = 'connected',
  Disconnected = 'disconnected',
}

export type EspProvisioningProgressEvent = {
  deviceName: string;
  progress: EspProvisioningProgress;
};

export type EspConnectionStateEvent = {
  deviceName: string;
  state: EspConnectionState;
};

export type EspDeviceEventMap = {
  provisioningProgress: (event: EspProvisioningProgressEvent) => void;
  connectionStateChanged: (event: EspConnectionStateEvent) => void;
};

export type EspIdfProvisioningModuleEvents = EspDeviceEventMap;
