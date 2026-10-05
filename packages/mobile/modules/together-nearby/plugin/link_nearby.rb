# Called only by the owner-run CocoaPods post_install. Does not invoke a build.
module PersistenceTogetherNearby
  URL = 'https://github.com/google/nearby.git'.freeze
  REVISION = '8b96295426de02266e59efb7b28d6846704c8c97'.freeze
  PRODUCT = 'NearbyConnections'.freeze

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

  def self.install(installer)
    pod_target = installer.pods_project.targets.find { |target| target.name == 'TogetherNearby' }
    raise 'TogetherNearby pod target missing; check Expo local-module autolinking' unless pod_target
    attach(installer.pods_project, pod_target)
    installer.aggregate_targets.each do |aggregate|
      aggregate.user_targets.each do |target|
        next unless target.product_type == 'com.apple.product-type.application'
        attach(aggregate.user_project, target)
      end
      aggregate.user_project.save
    end
  end
end
