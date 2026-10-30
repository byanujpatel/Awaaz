# Awaaz — running the MVP locally

```
Logos-Voice-Project/
  awaaz/   Expo app (fork of hackyguru/logos-messaging-mobile), family mode
  hub/     Mac hub: nwaku (Docker) + speech service (Parakeet + Qwen on MLX)
```

## 1. Start the hub (Mac)

```bash
/Users/anujpatel/Documents/Logos-Voice-Project/hub/start.sh
```

This starts:
- `awaaz-nwaku`: Relay + Store + LightPush + Filter, WebSocket on :8000, cluster 66
- `awaaz-relay2`: a second relay, so LightPush has a mesh peer to forward to
- the speech service on :8787 (`/hub-info`, `/transcribe`, `/structure`)

## 2. Run the app on two iPhone simulators

Xcode's command-line tools point at CommandLineTools, so prefix commands with
`DEVELOPER_DIR` (or run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` once).

```bash
cd /Users/anujpatel/Documents/Logos-Voice-Project/awaaz && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npx expo run:ios
```

Then boot a second simulator from Simulator → File → Open Simulator, and
install the same build on it. Metro serves both.

## 3. Try it

1. Simulator A: "I am the parent" → Create a new family → Copy code → Done.
2. Simulator B: "I am the son / daughter" → Join with a family code → Paste → Join.
3. Parent: tap **🎙 Tap and speak**, talk, then tap **Send** (auto-sends at 20 s).
   Parakeet transcribes it and Qwen picks tags, so saying "I'm not feeling well"
   raises the red flag by itself. Or tap the smaller **✓ I'm OK** for a silent check-in.
4. Child: sees the status card, timeline, ▶ Play, the transcript, and auto tags marked ✨.
   Model status: `curl localhost:8787/health` (shows "ready" per model); the parent
   screen shows a "🎙 Speech ready" chip.
   Use −/+ to move the check-in deadline before "now" to see **Missed check-in**.
5. Offline queue: `docker stop awaaz-nwaku`, send from the parent (shows
   "queued"), then `docker start awaaz-nwaku`. It goes out on reconnect.
