import { registerWebModule, NativeModule } from 'expo-modules-core';

import { EspIdfProvisioningModuleEvents } from './EspIdfProvisioning.types';

function unsupported(operation: string): never {
  throw new Error(
    `${operation}() is not available on web. @evawave/expo-esp-idf-provisioning requires a native ` +
      `Bluetooth LE transport and only supports iOS and Android.`
  );
}

// Every method throws instead of being absent, so web callers get an actionable
// message rather than "undefined is not a function".
class EspIdfProvisioningModule extends NativeModule<EspIdfProvisioningModuleEvents> {
  searchDevices(): never {
    unsupported('searchDevices');
  }
  stopSearch(): never {
    unsupported('stopSearch');
  }
  createDevice(): never {
    unsupported('createDevice');
  }
  connect(): never {
    unsupported('connect');
  }
  scanWifi(): never {
    unsupported('scanWifi');
  }
  sendData(): never {
    unsupported('sendData');
  }
  provision(): never {
    unsupported('provision');
  }
  cancel(): never {
    unsupported('cancel');
  }
  disconnect(): never {
    unsupported('disconnect');
  }
  dispose(): never {
    unsupported('dispose');
  }
}

export default registerWebModule(EspIdfProvisioningModule, 'EspIdfProvisioning');
