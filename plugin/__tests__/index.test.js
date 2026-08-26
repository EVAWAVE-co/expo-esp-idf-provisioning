const plugin = require('..');

const { DEFAULT_PERMISSION, applyAndroidManifest, applyInfoPlist } = plugin._internal;

function permissions(manifest, name) {
  return (manifest['uses-permission'] || []).filter((item) => item.$['android:name'] === name);
}

it('adds the default iOS Bluetooth usage description', () => {
  expect(applyInfoPlist({}, DEFAULT_PERMISSION)).toEqual({
    NSBluetoothAlwaysUsageDescription: DEFAULT_PERMISSION,
  });
});

it('allows the iOS Bluetooth description to be disabled', () => {
  expect(applyInfoPlist({}, false)).toEqual({});
});

it('flags BLUETOOTH_SCAN as neverForLocation', () => {
  const manifest = applyAndroidManifest({}, true);

  expect(permissions(manifest, 'android.permission.BLUETOOTH_SCAN')[0].$).toEqual({
    'android:name': 'android.permission.BLUETOOTH_SCAN',
    'android:usesPermissionFlags': 'neverForLocation',
  });
});

it('flags a BLUETOOTH_SCAN entry the app already declares without duplicating it', () => {
  const manifest = {
    'uses-permission': [{ $: { 'android:name': 'android.permission.BLUETOOTH_SCAN' } }],
  };

  applyAndroidManifest(manifest, true);

  const scan = permissions(manifest, 'android.permission.BLUETOOTH_SCAN');
  expect(scan).toHaveLength(1);
  expect(scan[0].$['android:usesPermissionFlags']).toBe('neverForLocation');
});

it('leaves the manifest untouched when neverForLocation is disabled', () => {
  // The library manifest already declares the permissions, so opting out means
  // adding nothing rather than restating them without the flag.
  expect(applyAndroidManifest({}, false)).toEqual({});
});
