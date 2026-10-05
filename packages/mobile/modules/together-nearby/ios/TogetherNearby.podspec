Pod::Spec.new do |s|
  s.name = 'TogetherNearby'
  s.version = '0.1.0'
  s.summary = 'Bounded untrusted Nearby transport for Together'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Evans Software Solutions Limited'
  s.homepage = 'https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => s.homepage }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreBluetooth'
  s.swift_version = '5.9'
  s.source_files = '**/*.swift'
  # withTogetherNearby links the pinned NearbyConnections SPM product to this Pods target.
end
