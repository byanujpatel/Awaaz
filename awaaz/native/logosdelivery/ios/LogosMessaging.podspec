Pod::Spec.new do |s|
  s.name         = "LogosMessaging"
  s.version      = "0.1.0"
  s.summary      = "Embedded Logos Delivery (Waku) node for React Native iOS"
  s.description  = "iOS port of the LogosMessaging module: embeds liblogosdelivery (Nim) as a static library, mirroring the Android JNI module's JS API."
  s.homepage     = "https://github.com/logos-messaging/logos-delivery"
  s.license      = { :type => "MIT" }
  s.author       = { "cockroach" => "kumaragurut7@gmail.com" }
  # The vendored .a is built with -mios-version-min=18.0, but the pod matches
  # the app's lower deployment target so CocoaPods will resolve it; the app
  # only actually runs on iOS 18+ (simulator runtime is far newer).
  s.platform     = :ios, "15.1"
  s.source       = { :path => "." }
  s.source_files = "*.{h,c,mm}"
  s.vendored_libraries = "liblogosdelivery.a", "librln.a"
  s.libraries    = "c++"
  s.frameworks   = "Foundation"
  s.dependency "React-Core"
end
