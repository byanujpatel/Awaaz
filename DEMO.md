# Awaaz — demo & test guide

**Awaaz: speak up anonymously, over Logos.** You speak or type. The community hub turns
voice into text and deletes the recording, an on-hub AI strips names and other identifying
details, and only that anonymous text is posted. It travels encrypted between Logos nodes
(one runs inside each phone), with no account, no phone number and no company server.

---

## 1. Start everything on your Mac (2 minutes)

1. Open **OrbStack** (Docker), so the Logos nodes can run.
2. Start the hub: two Logos nodes plus the local speech and AI service.
   ```bash
   /Users/anujpatel/Documents/Logos-Voice-Project/hub/start.sh
   ```
   Wait for `Uvicorn running on http://0.0.0.0:8787`. To check the models are loaded:
   ```bash
   curl -s localhost:8787/health
   ```
   Both models should say `"state":"ready"`.
3. Start Metro in a second terminal (dev build only):
   ```bash
   cd /Users/anujpatel/Documents/Logos-Voice-Project/awaaz && npx expo start
   ```
4. Open **Simulator** (Xcode → Open Developer Tool → Simulator) and boot
   **Awaaz Parent** and **Awaaz Child** (File → Open Simulator). Open **Awaaz** on both.

## 2. The 2-minute demo

| Step | Phone A | Phone B | What to say |
|---|---|---|---|
| 1 | **＋ Create room** → name it → **Create** (leave "Show to people nearby" ticked) | | "No sign-up, no phone number." |
| 2 | | The room appears under **Rooms nearby** → tap **Join** | "Found on the local Logos network: one tap, no link." |
| 3 | | Note the name, e.g. *Swift Yak* | "A throwaway name, different in every room." |
| 4 | Tap **Speak**: *"The warden, Mr Sharma, shouts at girls after 9."* → **Done** | | "My voice becomes text and is deleted." |
| 5 | The preview shows **🛡️ Removed: Mr Sharma** → **Post anonymously** | | "AI removes anything that identifies me or targets a person." |
| 6 | | The post appears in seconds | "It went phone → Logos node → phone, encrypted." |
| 7 | | **🙋 Me too** → **Acknowledge** | "Others can back it up, and issues move from reported to resolved." |
| 8 | **New identity**, then **Panic wipe** on home | | "One tap and every trace is gone from this phone." |

**Proof of privacy (optional, in a terminal):** the Logos node only stores hashed topics
and encrypted bytes.
```bash
/Users/anujpatel/Documents/Logos-Voice-Project/hub/show-ciphertext.sh
```

**The internet doesn't matter:** everything above runs on your Mac and local Wi-Fi.
Turn the Mac's internet off and it keeps working.

## 3. More testers on your Mac

Add extra iPhone simulators. Each one is an independent anonymous participant with its
own Logos node.
```bash
xcrun simctl create "Awaaz 3" com.apple.CoreSimulator.SimDeviceType.iPhone-17e com.apple.CoreSimulator.SimRuntime.iOS-27-0
```
```bash
xcrun simctl boot "Awaaz 3"
```
```bash
xcrun simctl install "Awaaz 3" /Users/anujpatel/Documents/Logos-Voice-Project/awaaz/ios/build/release/Build/Products/Release-iphonesimulator/Awaaz.app
```
Hand the Mac to residents: they open Awaaz, tap **Join** under **Rooms nearby**, and speak.

## 4. Testers on their own Mac (same Wi-Fi)

What they need: a Mac with Apple Silicon and **Xcode**, plus the iOS 27 Simulator
(Xcode → Settings → Components). They don't need the code, npm or Node.

1. You send them **`Awaaz-simulator.zip`**, the self-contained app (AirDrop or USB). It's
   already built at `/Users/anujpatel/Documents/Logos-Voice-Project/Awaaz-simulator.zip`.
   After code changes, rebuild it with:
   ```bash
   cd /Users/anujpatel/Documents/Logos-Voice-Project/awaaz/ios && xcodebuild -workspace Awaaz.xcworkspace -scheme Awaaz -configuration Release -sdk iphonesimulator -arch arm64 -derivedDataPath build/release build -quiet && cd build/release/Build/Products/Release-iphonesimulator && zip -qr /Users/anujpatel/Documents/Logos-Voice-Project/Awaaz-simulator.zip Awaaz.app
   ```
2. On their Mac: unzip, open Simulator, boot any iPhone, then drag **Awaaz.app** onto the
   simulator window (or run `xcrun simctl install booted ~/Downloads/Awaaz.app`).
3. In Awaaz, at the bottom of the home screen: **Community hub → Change → `10.0.2.219`**
   (your Mac's Wi-Fi address; check with `ipconfig getifaddr en0`). Close and reopen the app.
4. Your public rooms appear under **Rooms nearby**: tap **Join**. (Private rooms still need the invite link.)

If they can't connect, the residency Wi-Fi is probably blocking device-to-device traffic.
Put both Macs on your phone's hotspot or a travel router instead (no internet needed).

## 5. Android phones (real devices)

The app is at **`/Users/anujpatel/Documents/Logos-Voice-Project/Awaaz.apk`**. Each phone runs its own
Logos node; your Mac is the hub, and the AI runs locally on it (no cloud, no API calls).

1. **Same network:** the Mac and every phone on the same Wi-Fi, or on one phone's hotspot.
2. **Start the hub** on the Mac (section 1).
3. **Install:** send `Awaaz.apk` to each phone (Telegram/Drive/USB), open it, allow "Install unknown apps".
4. **Open Awaaz.** It finds the hub on the Wi-Fi by itself (a few seconds). If it doesn't:
   ⚙︎ → **Find hub automatically**, or type the Mac's address (`ipconfig getifaddr en0` on the Mac).
5. **Use it:** tap a room (or **＋ Start a room**), then **Speak** or type → **Post anonymously**.

Needs a 64-bit (arm64) Android phone. Physical iPhones aren't supported yet (the embedded Logos
library has no iPhone build).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "connecting to hub…" | Is OrbStack running? Is `hub/start.sh` running? Check `curl localhost:8787/health`. |
| "Voice not sent" | The hub's speech model isn't reachable. Typed posts still work (phone numbers and emails are scrubbed on the device). |
| Another Mac shows "offline" | Wrong hub address, or the Wi-Fi isolates devices (use a hotspot). |
| Start fresh | Home → **Panic wipe**. |
