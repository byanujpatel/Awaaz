# Awaaz

Anonymous voice speak-up rooms on Logos Messaging. Speak about a problem; a
community hub turns it into text, an on-device AI strips names and personal
details, and the post is encrypted and shared over the Logos network. No
accounts, no company server.

```
awaaz/   Expo (React Native) app, with an embedded Logos Delivery node
         (fork of hackyguru/logos-messaging-mobile)
hub/     Mac hub: nwaku nodes (Docker) + speech/anonymity service (Parakeet + Qwen on MLX)
```

- [RUNNING.md](RUNNING.md): how to start the hub and run the app
- [DEMO.md](DEMO.md): demo script

Hub setup: `cd hub && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && ./start.sh`
