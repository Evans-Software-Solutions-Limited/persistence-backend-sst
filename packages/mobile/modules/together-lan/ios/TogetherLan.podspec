Pod::Spec.new do |s|
  s.name = 'TogetherLan'
  s.version = '0.1.0'
  s.summary = 'Bounded local-network byte transport for Persistence Together'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Evans Software Solutions Limited'
  s.homepage = 'https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => s.homepage }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Network'
  s.swift_version = '5.9'
  s.source_files = '**/*.swift'
end
