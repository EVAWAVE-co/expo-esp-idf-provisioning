Pod::Spec.new do |s|
  s.name           = 'EspIdfProvisioning'
  s.version        = '0.1.0'
  s.summary        = 'Expo module for ESP-IDF Unified Provisioning'
  s.description    = 'Bluetooth LE provisioning for ESP-IDF devices in Expo apps.'
  s.author         = 'EVAWAVE Co.'
  s.homepage       = 'https://github.com/EVAWAVE-co/expo-esp-idf-provisioning'
  s.platforms      = {
    :ios => '16.4',
  }
  s.source         = {
    :git => 'https://github.com/EVAWAVE-co/expo-esp-idf-provisioning.git',
    :tag => s.version.to_s,
  }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'ESPProvision', '~> 3.0.3'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
