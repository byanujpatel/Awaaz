#!/usr/bin/env bash
# Demo helper: show what the Logos node actually stores for Awaaz rooms —
# hashed topic names and encrypted bytes, nothing readable.
curl -s "localhost:8645/store/v3/messages?includeData=true&pageSize=100&pubsubTopic=%2Fwaku%2F2%2Frs%2F66%2F0" | python3 -c '
import base64, json, sys
msgs = [m["message"] for m in json.load(sys.stdin).get("messages", [])
        if m["message"]["contentTopic"].startswith("/awaaz/1/room-")]
print(f"{len(msgs)} room messages on this Logos node:\n")
for m in msgs[-8:]:
    raw = base64.b64decode(m["payload"])
    topic = m["contentTopic"]
    print(f"{topic}  {len(raw):4d} bytes  {raw[:24].hex()}…")
'
