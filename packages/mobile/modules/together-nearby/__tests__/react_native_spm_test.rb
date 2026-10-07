# Uses the installed CocoaPods/Xcodeproj and React Native SPM implementation.
# Temporary project files only: no pod install, dependency resolution, or build.
require 'cocoapods'
require 'tmpdir'
require 'shellwords'
require_relative '../../../node_modules/react-native/scripts/react_native_pods'

URL = 'https://github.com/google/nearby.git'.freeze
REVISION = '8b96295426de02266e59efb7b28d6846704c8c97'.freeze
PRODUCT = 'NearbyConnections'.freeze
SPM_IMPORT = '${SYMROOT}/${CONFIGURATION}${EFFECTIVE_PLATFORM_NAME}/'.freeze
PODSPEC = File.expand_path('../ios/TogetherNearby.podspec', __dir__)

# Each fixture represents a new CocoaPods process. Use the real registration
# manager, not a replacement DSL or a stub that merely records podspec text.
def reset_manager
  Object.send(:remove_const, :SPM)
  Object.const_set(:SPM, SPMManager.new)
end

def assert(condition, message)
  raise message unless condition
end

def package(project, url = URL)
  ref = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
  ref.repositoryURL = url
  ref.requirement = { 'kind' => 'revision', 'revision' => REVISION }
  project.root_object.package_references << ref
  ref
end

def product(project, target, package_ref, name = PRODUCT)
  ref = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  ref.package = package_ref
  ref.product_name = name
  target.package_product_dependencies << ref
  file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  file.product_ref = ref
  target.frameworks_build_phase.files << file
  ref
end

def fixture
  Dir.mktmpdir('together-nearby-rn-spm') do |directory|
    pods = Pod::Project.new(File.join(directory, 'Pods.xcodeproj'))
    nearby = pods.new_target(:static_library, 'TogetherNearby', :ios, '15.1')
    other = pods.new_target(:static_library, 'OtherPod', :ios, '15.1')
    nearby.add_build_configuration('Staging', :release)
    app = Xcodeproj::Project.new(File.join(directory, 'App.xcodeproj'))
    target = app.new_target(:application, 'App', :ios, '15.1')
    aggregate = Struct.new(:user_project, :user_targets).new(app, [target])
    installer = Struct.new(:pods_project, :aggregate_targets).new(pods, [aggregate])
    yield installer, nearby, other, target
  end
end

# Reproduce the old interaction: a custom Pods-project registration is removed
# by React Native's real post-install SPM phase when not registered with its DSL.
reset_manager
fixture do |installer, nearby, _, _|
  legacy = package(installer.pods_project)
  product(installer.pods_project, nearby, legacy)
  SPM.apply_on_post_install(installer)
  assert(installer.pods_project.root_object.package_references.empty?,
         'fixture did not reproduce RN removing an unregistered remote package')
end

[nil, ['$(inherited)', '"/custom modules"']].each do |existing_paths|
  reset_manager
  spec = Pod::Specification.from_file(PODSPEC)
  assert(spec.name == 'TogetherNearby', 'wrong podspec evaluated')
  # Other dependencies must also be registered through RN. Its manager owns
  # remote package references in Pods; unrelated app packages are independent.
  other_spec = Pod::Specification.new { |s| s.name = 'OtherPod' }
  spm_dependency(other_spec, url: 'https://example.invalid/other.git',
                 requirement: { kind: 'exactVersion', version: '1.2.3' },
                 products: ['OtherProduct'])
  fixture do |installer, nearby, other, app_target|
    app = installer.aggregate_targets.first.user_project
    unrelated = package(app, 'https://example.invalid/app-only.git')
    unrelated_product = product(app, app_target, unrelated, 'AppOnly')
    nearby.build_configurations.each do |config|
      config.build_settings['SWIFT_INCLUDE_PATHS'] = existing_paths.dup if existing_paths
      config.build_settings['CONFIGURATION_BUILD_DIR'] = '$(PODS_CONFIGURATION_BUILD_DIR)/TogetherNearby'
    end
    # This is the same phase called by react_native_post_install. The full
    # hook is intentionally not run: it performs unrelated generated work.
    SPM.apply_on_post_install(installer)
    assert(app_target.package_product_dependencies == [unrelated_product], 'changed unrelated app products')
    assert(app.root_object.package_references == [unrelated], 'changed unrelated app packages')
    assert(app_target.frameworks_build_phase.files.count { |f| f.product_ref == unrelated_product } == 1,
           'changed unrelated app linkage')
    installer.pods_project.save
    app.save
    reopened = Xcodeproj::Project.open(installer.pods_project.path)
    refs = reopened.root_object.package_references
    registered = refs.select { |ref| ref.repositoryURL == URL }
    assert(registered.size == 1, 'RN registration missing or duplicated after persistence')
    assert(registered.first.requirement == { 'kind' => 'revision', 'revision' => REVISION }, 'wrong Nearby pin')
    target = reopened.targets.find { |t| t.name == 'TogetherNearby' }
    active_products = target.package_product_dependencies.select { |p| p.package&.uuid == registered.first.uuid }
    assert(active_products.map(&:product_name) == [PRODUCT], 'RN did not link Nearby product to its pod')
    target.build_configurations.each do |config|
      raw = config.build_settings['SWIFT_INCLUDE_PATHS']
      paths = raw.is_a?(String) ? Shellwords.split(raw) : Array(raw)
      assert(paths.include?(SPM_IMPORT), "missing RN import directory in #{config.name}")
      assert(paths.include?('$(inherited)'), 'missing inherited imports')
      assert(!existing_paths || paths.include?('/custom modules'), 'lost custom imports')
      assert(paths.count(SPM_IMPORT) == 1, 'duplicate RN import directory')
      assert(config.build_settings['CONFIGURATION_BUILD_DIR'] == '$(PODS_CONFIGURATION_BUILD_DIR)/TogetherNearby',
             'changed CocoaPods output directory')
    end
    other_target = reopened.targets.find { |t| t.name == 'OtherPod' }
    assert(other_target.package_product_dependencies.any? { |p| p.product_name == 'OtherProduct' && refs.include?(p.package) },
           'lost another RN-registered dependency')
    persisted_app = Xcodeproj::Project.open(app.path)
    assert(persisted_app.targets.first.package_product_dependencies.map(&:product_name) == ['AppOnly'],
           'unexpected app registration persisted')
    assert(persisted_app.targets.first.build_configurations.all? { |c| c.build_settings['SWIFT_INCLUDE_PATHS'].nil? },
           'added pod import workaround to app target')
  end
end
puts 'Nearby real RN SPM registration and persisted import regressions: passed'

# A standalone podspec evaluation without the RN DSL must explain the ordering
# requirement rather than silently shipping a module without its dependency.
require 'open3'
require 'rbconfig'
output, status = Open3.capture2e(RbConfig.ruby, '-e',
  "require 'cocoapods'; Pod::Specification.from_file(ARGV.fetch(0))", PODSPEC)
assert(!status.success? && output.include?('TogetherNearby requires React Native spm_dependency'),
       'missing RN registration helper did not fail closed with an actionable error')
puts 'Nearby missing RN registration helper regression: passed'
