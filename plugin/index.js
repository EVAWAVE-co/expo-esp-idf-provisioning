const { createRunOncePlugin, withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const pkg = require('../package.json');

const DEFAULT_PERMISSION =
  'Allow $(PRODUCT_NAME) to discover, connect to, and provision nearby ESP devices.';

const BLUETOOTH_SCAN = 'android.permission.BLUETOOTH_SCAN';

function applyInfoPlist(infoPlist, bluetoothPermission) {
  if (bluetoothPermission !== false) {
    infoPlist.NSBluetoothAlwaysUsageDescription = bluetoothPermission;
  }
  return infoPlist;
}

// The library manifest already declares every BLE permission, so the plugin only
// owns the one attribute an app may want to opt out of: `neverForLocation`.
function applyAndroidManifest(manifest, neverForLocation) {
  if (!neverForLocation) {
    return manifest;
  }

  const permissions = manifest['uses-permission'] || [];
  const existing = permissions.find((item) => item.$['android:name'] === BLUETOOTH_SCAN);
  if (existing) {
    existing.$['android:usesPermissionFlags'] = 'neverForLocation';
  } else {
    permissions.push({
      $: { 'android:name': BLUETOOTH_SCAN, 'android:usesPermissionFlags': 'neverForLocation' },
    });
  }
  manifest['uses-permission'] = permissions;
  return manifest;
}

function withEspIdfProvisioning(config, props = {}) {
  const bluetoothPermission =
    props.bluetoothPermission === undefined ? DEFAULT_PERMISSION : props.bluetoothPermission;
  const neverForLocation = props.neverForLocation ?? true;

  config = withInfoPlist(config, (result) => {
    result.modResults = applyInfoPlist(result.modResults, bluetoothPermission);
    return result;
  });

  return withAndroidManifest(config, (result) => {
    result.modResults.manifest = applyAndroidManifest(result.modResults.manifest, neverForLocation);
    return result;
  });
}

const plugin = createRunOncePlugin(withEspIdfProvisioning, pkg.name, pkg.version);

plugin._internal = {
  DEFAULT_PERMISSION,
  applyAndroidManifest,
  applyInfoPlist,
};

module.exports = plugin;
