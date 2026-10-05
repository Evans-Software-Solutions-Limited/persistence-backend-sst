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
