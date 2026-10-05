# Called only by the owner-run CocoaPods post_install. Does not invoke a build.
require 'shellwords'

module PersistenceTogetherNearby
  URL = 'https://github.com/google/nearby.git'.freeze
  REVISION = '8b96295426de02266e59efb7b28d6846704c8c97'.freeze
  PRODUCT = 'NearbyConnections'.freeze
  SWIFT_PRODUCTS = '$(SYMROOT)/$(CONFIGURATION)$(EFFECTIVE_PLATFORM_NAME)'.freeze

  def self.attach(project, target)
    objects = Xcodeproj::Project::Object
    package = project.root_object.package_references.find { |item| item.repositoryURL == URL }
    unless package
      package = project.new(objects::XCRemoteSwiftPackageReference)
      package.repositoryURL = URL
      project.root_object.package_references << package
    end
    package.requirement = { 'kind' => 'revision', 'revision' => REVISION }
    product = target.package_product_dependencies.find { |item| item.product_name == PRODUCT && item.package == package }
    unless product
      product = project.new(objects::XCSwiftPackageProductDependency)
      product.product_name = PRODUCT
      product.package = package
      target.package_product_dependencies << product
    end
    unless target.frameworks_build_phase.files.any? { |item| item.product_ref == product }
      file = project.new(objects::PBXBuildFile)
      file.product_ref = product
      target.frameworks_build_phase.files << file
    end
  end

  # CocoaPods puts each pod in its own CONFIGURATION_BUILD_DIR, whereas SPM
  # emits Swift modules in the shared configuration/platform products directory.
  # Package linkage alone therefore does not make `import NearbyConnections` work.
  def self.configure_swift_imports(target)
    target.build_configurations.each do |config|
      existing = config.build_settings['SWIFT_INCLUDE_PATHS']
      paths = if existing.is_a?(String)
        Shellwords.split(existing)
      else
        Array(existing).map { |path| path.start_with?('"') ? Shellwords.split(path).first : path }
      end
      # Xcodeproj serializes this setting as a space-separated string. Quote each
      # entry so custom paths (and expanded build directories) can contain spaces.
      config.build_settings['SWIFT_INCLUDE_PATHS'] = (['$(inherited)'] + paths + [SWIFT_PRODUCTS]).uniq.map do |path|
        '"' + path.gsub('\\', '\\\\').gsub('"', '\\"') + '"'
      end.join(' ')
    end
  end

  def self.install(installer)
    pod_target = installer.pods_project.targets.find { |target| target.name == 'TogetherNearby' }
    raise 'TogetherNearby pod target missing; check Expo local-module autolinking' unless pod_target
    attach(installer.pods_project, pod_target)
    configure_swift_imports(pod_target)
    installer.aggregate_targets.each do |aggregate|
      aggregate.user_targets.each do |target|
        next unless target.product_type == 'com.apple.product-type.application'
        attach(aggregate.user_project, target)
      end
      aggregate.user_project.save
    end
  end
end
