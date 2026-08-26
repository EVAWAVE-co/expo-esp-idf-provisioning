import {
  EspProvisioningDevice,
  EspSecurity,
  isEspProvisioningError,
  searchDevices,
} from '@evawave/expo-esp-idf-provisioning';
import { useEffect, useState } from 'react';
import {
  Button,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

async function requestBluetoothPermissions() {
  if (Platform.OS !== 'android') return;

  const permissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const results = await PermissionsAndroid.requestMultiple(permissions);
  const denied = permissions.some(
    (permission) => results[permission] !== PermissionsAndroid.RESULTS.GRANTED
  );
  if (denied) {
    throw new Error('Bluetooth permissions are required to scan for ESP devices.');
  }
}

function messageFor(error: unknown): string {
  if (isEspProvisioningError(error)) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [devices, setDevices] = useState<EspProvisioningDevice[]>([]);
  const [selected, setSelected] = useState<EspProvisioningDevice>();
  const [message, setMessage] = useState('Ready');
  const [devicePrefix, setDevicePrefix] = useState('PROV_');
  const [proofOfPossession, setProofOfPossession] = useState('');
  const [ssid, setSsid] = useState('');
  const [passphrase, setPassphrase] = useState('');

  useEffect(() => {
    if (!selected) return;

    const connection = selected.addListener('connectionStateChanged', ({ state }) => {
      setMessage(`Connection: ${state}`);
    });
    const progress = selected.addListener('provisioningProgress', ({ progress: step }) => {
      setMessage(`Provisioning: ${step}`);
    });
    return () => {
      connection.remove();
      progress.remove();
    };
  }, [selected]);

  const scan = async () => {
    try {
      setMessage('Scanning…');
      await requestBluetoothPermissions();
      const result = await searchDevices({
        prefix: devicePrefix,
        security: EspSecurity.Security1,
      });
      setDevices(result);
      setSelected(result[0]);
      setMessage(`Found ${result.length} device(s)`);
    } catch (error) {
      setMessage(messageFor(error));
    }
  };

  const connect = async () => {
    if (!selected) return;
    try {
      await selected.connect({ proofOfPossession: proofOfPossession || undefined });
    } catch (error) {
      setMessage(messageFor(error));
    }
  };

  const scanWifi = async () => {
    if (!selected) return;
    try {
      setMessage('Scanning Wi-Fi…');
      const networks = await selected.scanWifi();
      setSsid(networks[0]?.ssid ?? '');
      setMessage(`Found ${networks.length} Wi-Fi network(s)`);
    } catch (error) {
      setMessage(messageFor(error));
    }
  };

  const provision = async () => {
    if (!selected) return;
    try {
      await selected.provision({ ssid, passphrase, timeoutMs: 30_000 });
    } catch (error) {
      setMessage(messageFor(error));
    }
  };

  const dispose = () => {
    selected?.dispose();
    setSelected(undefined);
    setDevices([]);
    setMessage('Device disposed');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>ESP-IDF Provisioning</Text>
        <TextInput
          autoCapitalize="characters"
          onChangeText={setDevicePrefix}
          placeholder="Advertised device prefix"
          style={styles.input}
          value={devicePrefix}
        />
        <Button title="Scan for devices" onPress={scan} />
        <Text selectable>{message}</Text>

        {devices.map((device) => (
          <Button
            key={device.name}
            title={device.name === selected?.name ? `Selected: ${device.name}` : device.name}
            onPress={() => setSelected(device)}
          />
        ))}

        {selected ? (
          <View style={styles.card}>
            <Text style={styles.heading}>{selected.name}</Text>
            <TextInput
              autoCapitalize="none"
              onChangeText={setProofOfPossession}
              placeholder="Proof of possession (optional for no_pop)"
              secureTextEntry
              style={styles.input}
              value={proofOfPossession}
            />
            <Button title="Connect" onPress={connect} />
            <Button title="Scan Wi-Fi" onPress={scanWifi} />
            <TextInput
              autoCapitalize="none"
              onChangeText={setSsid}
              placeholder="Wi-Fi SSID"
              style={styles.input}
              value={ssid}
            />
            <TextInput
              autoCapitalize="none"
              onChangeText={setPassphrase}
              placeholder="Wi-Fi passphrase"
              secureTextEntry
              style={styles.input}
              value={passphrase}
            />
            <Button title="Provision" onPress={provision} />
            <Button title="Dispose device" onPress={dispose} color="#a12622" />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f8' },
  content: { gap: 16, padding: 24 },
  title: { fontSize: 28, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  card: { gap: 12, borderRadius: 12, backgroundColor: '#fff', padding: 16 },
  input: { borderWidth: 1, borderColor: '#c9ccd1', borderRadius: 8, padding: 12 },
});
