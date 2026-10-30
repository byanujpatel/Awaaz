# cockroach

A React Native (Expo) chat app that runs a **Logos Delivery (Waku) node
embedded on-device**, rather than talking to a remote server. The node ships as
a prebuilt native library wired in through a custom config plugin —
[`plugins/withLogosDelivery.js`](plugins/withLogosDelivery.js) — using a
hand-written JNI bridge on Android and a local CocoaPod on iOS. Where the native
node is unavailable, the app falls back to the js-waku backend
(`src/lib/waku-chat.ts`).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

   The `logosdelivery` `.a`/`.so` binaries are too large for git, so they live as
   assets on the [`native-libs-v2`](https://github.com/hackyguru/logos-messaging-mobile/releases/tag/native-libs-v2)
   release. `npm install` fetches and checksum-verifies them into
   `native/logosdelivery/` via `postinstall`; it is a no-op once they are
   present. To refetch by hand:

   ```bash
   ./scripts/fetch-native-libs.sh --force
   ```

2. Build and run

   ```bash
   npm run ios       # or: npm run android
   ```

   This runs `expo prebuild` (regenerating `ios/` and `android/`, both
   gitignored) and compiles the app. **`npx expo start` on its own is not
   enough** — the embedded Logos Delivery node is a hand-written native module,
   so it cannot run in Expo Go. Once a build is installed, `npm start` will
   attach to it for JS-only changes.

Screens live in **`src/app`** using [file-based routing](https://docs.expo.dev/router/introduction);
the messaging logic is in `src/lib`.

### Supported targets

The prebuilt native libraries are arm64-only, which constrains where the app
can run:

| Target | Supported | Notes |
| --- | --- | --- |
| iOS Simulator (Apple Silicon) | yes | the `.a` files are built for `IOSSIMULATOR`, arm64, minos 18.0 |
| Physical iPhone | no | no device slice in the vendored `.a`; linking fails |
| Intel Mac | no | would need an x86_64 simulator slice |
| Android arm64 (device or Apple Silicon emulator) | yes | `APP_ABI := arm64-v8a` |
| Android x86_64 emulator | no | no x86_64 build of `liblogosdelivery` |

Rebuilding the libraries for other targets means rebuilding logos-delivery
itself; see `native/logosdelivery/jni` (ndk-build) for the Android JNI bridge.

You will also need the usual native toolchains: Xcode and CocoaPods for iOS,
and the Android SDK plus NDK for Android.

> [!WARNING]
> `npm run reset-project` is left over from the `create-expo-app` template and
> must **not** be run here. It moves `src/` and `scripts/` into `example/`
> (which is gitignored), wiping the app and breaking `npm install`, since
> `postinstall` depends on `scripts/fetch-native-libs.sh`.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
