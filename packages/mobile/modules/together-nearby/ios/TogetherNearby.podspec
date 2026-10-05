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
  # Register with React Native's SPM manager. react_native_post_install owns
  # package references and the Swift import paths for CocoaPods targets.
  unless respond_to?(:spm_dependency, true)
    raise 'TogetherNearby requires React Native spm_dependency; load react_native_pods before Expo autolinking'
  end
  spm_dependency(s,
    url: 'https://github.com/google/nearby.git',
    requirement: { kind: 'revision', revision: '8b96295426de02266e59efb7b28d6846704c8c97' },
    products: ['NearbyConnections']
  )
end
