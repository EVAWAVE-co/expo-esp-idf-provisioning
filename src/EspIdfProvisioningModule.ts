import { NativeModule, requireNativeModule } from 'expo-modules-core';

import type {
  EspDeviceInfo,
  EspIdfProvisioningModuleEvents,
  EspWifiNetwork,
} from './EspIdfProvisioning.types';

declare class EspIdfProvisioningModule extends NativeModule<EspIdfProvisioningModuleEvents> {
  searchDevices(prefix: string, security: number, timeoutMs: number): Promise<EspDeviceInfo[]>;
  stopSearch(): void;
  createDevice(name: string, security: number): Promise<EspDeviceInfo>;
  connect(
    name: string,
    proofOfPossession: string | null,
    username: string | null,
    timeoutMs: number
  ): Promise<void>;
  scanWifi(name: string, timeoutMs: number): Promise<EspWifiNetwork[]>;
  sendData(
    name: string,
    endpoint: string,
    data: string,
    encoding: 'utf8' | 'base64',
    timeoutMs: number
  ): Promise<string>;
  provision(name: string, ssid: string, passphrase: string, timeoutMs: number): Promise<void>;
  cancel(name: string): void;
  disconnect(name: string): void;
  dispose(name: string): void;
}

export default requireNativeModule<EspIdfProvisioningModule>('EspIdfProvisioning');
