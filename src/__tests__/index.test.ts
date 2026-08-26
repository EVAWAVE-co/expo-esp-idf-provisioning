jest.mock('../EspIdfProvisioningModule', () => ({
  searchDevices: jest.fn(),
  stopSearch: jest.fn(),
  createDevice: jest.fn(),
  connect: jest.fn(),
  scanWifi: jest.fn(),
  sendData: jest.fn(),
  provision: jest.fn(),
  cancel: jest.fn(),
  disconnect: jest.fn(),
  dispose: jest.fn(),
  addListener: jest.fn(),
}));

const mockNativeModule = jest.requireMock('../EspIdfProvisioningModule');
const {
  createDevice,
  EspProvisioningErrorCode,
  EspSecurity,
  isEspProvisioningError,
  searchDevices,
  stopSearch,
} = require('../index');

beforeEach(() => {
  jest.clearAllMocks();
});

it('maps discovered native devices to the public device API', async () => {
  mockNativeModule.searchDevices.mockResolvedValue([
    { name: 'PROV_1234', transport: 'ble', security: EspSecurity.Security1 },
  ]);

  const [device] = await searchDevices({ prefix: 'PROV_' });

  expect(mockNativeModule.searchDevices).toHaveBeenCalledWith(
    'PROV_',
    EspSecurity.Security1,
    10_000
  );
  expect(device.name).toBe('PROV_1234');

  await device.connect();
  expect(mockNativeModule.connect).toHaveBeenCalledWith('PROV_1234', null, null, 20_000);
});

it('applies per-device security credentials when connecting a discovered device', async () => {
  mockNativeModule.searchDevices.mockResolvedValue([
    { name: 'PROV_SECURE', transport: 'ble', security: EspSecurity.Security2 },
  ]);

  const [device] = await searchDevices({
    prefix: 'PROV_',
    security: EspSecurity.Security2,
  });

  await device.connect({
    proofOfPossession: 'device-specific-secret',
    username: 'device-specific-user',
    timeoutMs: 15_000,
  });

  expect(mockNativeModule.connect).toHaveBeenCalledWith(
    'PROV_SECURE',
    'device-specific-secret',
    'device-specific-user',
    15_000
  );
});

it('rejects missing Security 2 proof of possession before calling native code', async () => {
  mockNativeModule.searchDevices.mockResolvedValue([
    { name: 'PROV_SECURE', transport: 'ble', security: EspSecurity.Security2 },
  ]);
  const [device] = await searchDevices({
    prefix: 'PROV_',
    security: EspSecurity.Security2,
  });

  await expect(device.connect({ username: 'user' })).rejects.toMatchObject({
    code: 'ERR_ESP_PROVISIONING_CREDENTIALS_REQUIRED',
    message: 'Security 2 requires proofOfPossession.',
  });
  expect(mockNativeModule.connect).not.toHaveBeenCalled();
});

it('rejects missing Security 2 username before calling native code', async () => {
  mockNativeModule.searchDevices.mockResolvedValue([
    { name: 'PROV_SECURE', transport: 'ble', security: EspSecurity.Security2 },
  ]);
  const [device] = await searchDevices({
    prefix: 'PROV_',
    security: EspSecurity.Security2,
  });

  await expect(device.connect({ proofOfPossession: 'secret' })).rejects.toMatchObject({
    code: 'ERR_ESP_PROVISIONING_CREDENTIALS_REQUIRED',
    message: 'Security 2 requires username.',
  });
  expect(mockNativeModule.connect).not.toHaveBeenCalled();
});

it('prepares a known device without coupling credentials to discovery', async () => {
  mockNativeModule.createDevice.mockResolvedValue({
    name: 'PROV_5678',
    transport: 'ble',
    security: EspSecurity.Security2,
  });

  await createDevice({
    name: 'PROV_5678',
    security: EspSecurity.Security2,
  });

  expect(mockNativeModule.createDevice).toHaveBeenCalledWith('PROV_5678', EspSecurity.Security2);
});

it('uses safe defaults when preparing a device', async () => {
  mockNativeModule.createDevice.mockResolvedValue({
    name: 'PROV_DEFAULT',
    transport: 'ble',
    security: EspSecurity.Security1,
  });

  await createDevice({ name: 'PROV_DEFAULT' });

  expect(mockNativeModule.createDevice).toHaveBeenCalledWith('PROV_DEFAULT', EspSecurity.Security1);
});

it('forwards every device operation with its timeout and encoding', async () => {
  mockNativeModule.createDevice.mockResolvedValue({
    name: 'PROV_API',
    transport: 'ble',
    security: EspSecurity.Security1,
  });
  mockNativeModule.scanWifi.mockResolvedValue([]);
  mockNativeModule.sendData.mockResolvedValue('response');

  const device = await createDevice({ name: 'PROV_API' });

  await device.scanWifi({ timeoutMs: 1_001 });
  await device.sendData('text-endpoint', 'hello', { timeoutMs: 1_002 });
  await device.sendDataBase64('binary-endpoint', 'AQID', { timeoutMs: 1_003 });
  await device.provision({ ssid: 'network', passphrase: 'secret', timeoutMs: 1_004 });
  device.cancel();
  device.disconnect();
  device.dispose();

  expect(mockNativeModule.scanWifi).toHaveBeenCalledWith('PROV_API', 1_001);
  expect(mockNativeModule.sendData).toHaveBeenNthCalledWith(
    1,
    'PROV_API',
    'text-endpoint',
    'hello',
    'utf8',
    1_002
  );
  expect(mockNativeModule.sendData).toHaveBeenNthCalledWith(
    2,
    'PROV_API',
    'binary-endpoint',
    'AQID',
    'base64',
    1_003
  );
  expect(mockNativeModule.provision).toHaveBeenCalledWith('PROV_API', 'network', 'secret', 1_004);
  expect(mockNativeModule.cancel).toHaveBeenCalledWith('PROV_API');
  expect(mockNativeModule.disconnect).toHaveBeenCalledWith('PROV_API');
  expect(mockNativeModule.dispose).toHaveBeenCalledWith('PROV_API');
});

it('filters native events to the matching device', async () => {
  const remove = jest.fn();
  mockNativeModule.createDevice.mockResolvedValue({
    name: 'PROV_EVENTS',
    transport: 'ble',
    security: EspSecurity.Security1,
  });
  mockNativeModule.addListener.mockReturnValue({ remove });
  const device = await createDevice({ name: 'PROV_EVENTS' });
  const listener = jest.fn();

  const subscription = device.addListener('connectionStateChanged', listener);
  const nativeListener = mockNativeModule.addListener.mock.calls[0][1];
  nativeListener({ deviceName: 'PROV_OTHER', state: 'connected' });
  nativeListener({ deviceName: 'PROV_EVENTS', state: 'connected' });
  subscription.remove();

  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({ deviceName: 'PROV_EVENTS', state: 'connected' });
  expect(remove).toHaveBeenCalledTimes(1);
});

it('stops an active device search', () => {
  stopSearch();

  expect(mockNativeModule.stopSearch).toHaveBeenCalledTimes(1);
});

it('identifies only errors carrying a public provisioning error code', () => {
  const error = Object.assign(new Error('timed out'), {
    code: EspProvisioningErrorCode.Timeout,
  });

  expect(isEspProvisioningError(error)).toBe(true);
  expect(isEspProvisioningError(new Error('ordinary error'))).toBe(false);
  expect(isEspProvisioningError({ code: EspProvisioningErrorCode.Timeout })).toBe(false);
});
