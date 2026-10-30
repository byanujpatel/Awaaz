/**
 * iOS 27 asserts at launch unless the app adopts the UIScene life cycle.
 * Expo 57 ships ExpoAppSceneDelegate for this, but the generated AppDelegate
 * still starts React Native itself; this plugin switches it over:
 *  - AppDelegate conforms to ExpoReactNativeFactoryProvider and no longer
 *    creates the window (the scene delegate does),
 *  - Info.plist declares a scene manifest pointing at EXExpoAppSceneDelegate.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const WINDOW_BLOCK =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace(
        'class AppDelegate: ExpoAppDelegate {',
        'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'
      );
    }
    src = src.replace(WINDOW_BLOCK, '\n    // The scene delegate (EXExpoAppSceneDelegate) creates the window.\n');
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

module.exports = (config) => withSceneManifest(withSceneAppDelegate(config));
