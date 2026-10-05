# Run with xcodeproj available; generates only temporary project fixtures, never builds.
require 'xcodeproj'
require 'tmpdir'
require_relative '../plugin/link_nearby'
Dir.mktmpdir('together-nearby-project') do |directory|
  project = Xcodeproj::Project.new(File.join(directory, 'Fixture.xcodeproj'))
  target = project.new_target(:static_library, 'TogetherNearby', :ios, '15.1')
  unrelated = project.new_target(:application, 'Other', :ios, '15.1')
  2.times { PersistenceTogetherNearby.attach(project, target) }
  raise 'duplicate package' unless project.root_object.package_references.size == 1
  raise 'duplicate product' unless target.package_product_dependencies.size == 1
  product = target.package_product_dependencies.first
  raise 'wrong pin' unless product.package.requirement['revision'] == PersistenceTogetherNearby::REVISION
  raise 'missing link phase' unless target.frameworks_build_phase.files.count { |f| f.product_ref == product } == 1
  raise 'changed unrelated target' unless unrelated.package_product_dependencies.empty?
  project.save
  reopened = Xcodeproj::Project.open(project.path)
  target = reopened.targets.find { |t| t.name == 'TogetherNearby' }
  raise 'not persisted' unless target.package_product_dependencies.first.product_name == 'NearbyConnections'
  PersistenceTogetherNearby.attach(reopened, target)
  raise 'not idempotent after reload' unless target.package_product_dependencies.size == 1
  puts 'Nearby SPM real Xcode project fixture: passed'
end

# Exercise the actual post_install entry point across CocoaPods setting forms.
[ nil, '$(inherited) "/custom modules"', ['$(inherited)', '/custom modules'] ].each do |existing|
  Dir.mktmpdir('together-nearby-install') do |directory|
    pods = Xcodeproj::Project.new(File.join(directory, 'Pods.xcodeproj'))
    nearby = pods.new_target(:static_library, 'TogetherNearby', :ios, '15.1')
    other = pods.new_target(:static_library, 'OtherPod', :ios, '15.1')
    nearby.add_build_configuration('Staging', :release)
    nearby.build_configurations.each do |config|
      config.build_settings['SWIFT_INCLUDE_PATHS'] = existing unless existing.nil?
      config.build_settings['CONFIGURATION_BUILD_DIR'] = '$(PODS_CONFIGURATION_BUILD_DIR)/TogetherNearby'
    end
    app = Xcodeproj::Project.new(File.join(directory, 'App.xcodeproj'))
    target = app.new_target(:application, 'App', :ios, '15.1')
    aggregate = Struct.new(:user_project, :user_targets).new(app, [target])
    installer = Struct.new(:pods_project, :aggregate_targets).new(pods, [aggregate])
    2.times { PersistenceTogetherNearby.install(installer) }
    pods.save # CocoaPods writes the Pods project after post_install.
    reopened = Xcodeproj::Project.open(pods.path)
    reopened.targets.find { |t| t.name == 'TogetherNearby' }.build_configurations.each do |config|
      raw = config.build_settings['SWIFT_INCLUDE_PATHS']
      paths = raw.is_a?(String) ? Shellwords.split(raw) : Array(raw)
      raise "missing SPM import directory in #{config.name}" unless paths.include?('$(SYMROOT)/$(CONFIGURATION)$(EFFECTIVE_PLATFORM_NAME)')
      raise 'missing inheritance' unless paths.include?('$(inherited)')
      raise 'lost custom path' unless existing.nil? || paths.include?('/custom modules')
      raise 'duplicate search paths' unless paths == paths.uniq
      raise 'overrode pod output directory' unless config.build_settings['CONFIGURATION_BUILD_DIR'] == '$(PODS_CONFIGURATION_BUILD_DIR)/TogetherNearby'
    end
    raise 'changed unrelated pod' unless other.build_configurations.all? { |c| c.build_settings['SWIFT_INCLUDE_PATHS'].nil? }
    app = Xcodeproj::Project.open(app.path)
    raise 'changed app imports' unless app.targets.first.build_configurations.all? { |c| c.build_settings['SWIFT_INCLUDE_PATHS'].nil? }
    raise 'missing app package' unless app.targets.first.package_product_dependencies.first.product_name == 'NearbyConnections'
  end
end
puts 'Nearby post_install Swift import regression: passed'
