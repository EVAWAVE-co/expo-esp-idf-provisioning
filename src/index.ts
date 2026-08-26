import { CodedError } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

import type {
  ConnectOptions,
  CreateDeviceOptions,
  EspDeviceEventMap,
  EspDeviceInfo,
  EspProvisioningError,
  EspWifiNetwork,
  OperationOptions,
  ProvisionOptions,
  SearchDevicesOptions,
} from './EspIdfProvisioning.types';
import { EspProvisioningErrorCode, EspSecurity } from './EspIdfProvisioning.types';
import NativeModule from './EspIdfProvisioningModule';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 10_000;
function timeout(options?: OperationOptions): number {
  return options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

export function isEspProvisioningError(error: unknown): error is EspProvisioningError {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }
  return Object.values(EspProvisioningErrorCode).includes(
    (error as { code: EspProvisioningErrorCode }).code
  );
}

export class EspProvisioningDevice {
  readonly name: string;
  readonly security: EspSecurity;
  readonly transport = 'ble' as const;

  constructor(info: EspDeviceInfo) {
    this.name = info.name;
    this.security = info.security;
  }

  connect(options?: ConnectOptions): Promise<void> {
    if (this.security === EspSecurity.Security2) {
      if (!options?.proofOfPossession) {
        return Promise.reject(
          new CodedError(
            EspProvisioningErrorCode.CredentialsRequired,
            'Security 2 requires proofOfPossession.'
          )
        );
      }
      if (!options.username) {
        return Promise.reject(
          new CodedError(
            EspProvisioningErrorCode.CredentialsRequired,
            'Security 2 requires username.'
          )
        );
      }
    }
    return NativeModule.connect(
      this.name,
      options?.proofOfPossession ?? null,
      options?.username ?? null,
      timeout(options)
    );
  }

  scanWifi(options?: OperationOptions): Promise<EspWifiNetwork[]> {
    return NativeModule.scanWifi(this.name, timeout(options));
  }

  sendData(endpoint: string, data: string, options?: OperationOptions): Promise<string> {
    return NativeModule.sendData(this.name, endpoint, data, 'utf8', timeout(options));
  }

  sendDataBase64(endpoint: string, data: string, options?: OperationOptions): Promise<string> {
    return NativeModule.sendData(this.name, endpoint, data, 'base64', timeout(options));
  }

  provision(options: ProvisionOptions): Promise<void> {
    return NativeModule.provision(this.name, options.ssid, options.passphrase, timeout(options));
  }

  cancel(): void {
    NativeModule.cancel(this.name);
  }

  disconnect(): void {
    NativeModule.disconnect(this.name);
  }

  dispose(): void {
    NativeModule.dispose(this.name);
  }

  addListener<EventName extends keyof EspDeviceEventMap>(
    eventName: EventName,
    listener: EspDeviceEventMap[EventName]
  ): EventSubscription {
    return NativeModule.addListener(eventName, ((event: { deviceName: string }) => {
      if (event.deviceName === this.name) {
        listener(event as never);
      }
    }) as EspDeviceEventMap[EventName]);
  }
}

export async function searchDevices(
  options: SearchDevicesOptions
): Promise<EspProvisioningDevice[]> {
  const devices = await NativeModule.searchDevices(
    options.prefix,
    options.security ?? EspSecurity.Security1,
    options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
  );
  return devices.map((device) => new EspProvisioningDevice(device));
}

export function stopSearch(): void {
  NativeModule.stopSearch();
}

export async function createDevice(options: CreateDeviceOptions): Promise<EspProvisioningDevice> {
  const device = await NativeModule.createDevice(
    options.name,
    options.security ?? EspSecurity.Security1
  );
  return new EspProvisioningDevice(device);
}

export * from './EspIdfProvisioning.types';
