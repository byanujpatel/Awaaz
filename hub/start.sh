#!/usr/bin/env bash
# Starts the Awaaz hub: two nwaku nodes (Docker/OrbStack) + speech service.
#
# awaaz-nwaku  Relay + Store + LightPush + Filter, WebSocket :8000 for phones
# awaaz-relay2 a second relay, so LightPush has a mesh peer to forward to
#              (a lone nwaku rejects LightPush with "no peers to relay")
#
# Both sit on a private network at fixed IPs with fixed node keys and list
# each other as static nodes, so either can restart and the mesh re-forms.
set -euo pipefail
cd "$(dirname "$0")"

NET=awaaz-net
HUB_IP=172.31.66.10
RELAY_IP=172.31.66.11
COMMON=(--relay=true --cluster-id=66 --shard=0 --num-shards-in-network=1
  --max-msg-size=512KiB --tcp-port=60000 --nat=none --log-level=INFO)

[ -f nodekey ] || openssl rand -hex 32 > nodekey
[ -f relay2.key ] || openssl rand -hex 32 > relay2.key
mkdir -p nwaku-data

# Peer IDs are derived from the keys, so ask a throwaway container for them.
peer_id() {
  local cid id=""
  cid=$(docker run -d wakuorg/nwaku:latest --nodekey="$1" --cluster-id=66 --rest=false 2>/dev/null)
  for _ in $(seq 1 30); do
    id=$(docker logs "$cid" 2>&1 | grep -m1 -oE '16Uiu2[A-Za-z0-9]{40,}' || true)
    [ -n "$id" ] && break
    sleep 1
  done
  docker rm -f "$cid" >/dev/null
  echo "$id"
}
[ -f nodekey.peer ] || peer_id "$(cat nodekey)" > nodekey.peer
[ -f relay2.peer ] || peer_id "$(cat relay2.key)" > relay2.peer
HUB_PEER=$(cat nodekey.peer)
RELAY_PEER=$(cat relay2.peer)

docker network inspect $NET >/dev/null 2>&1 \
  || docker network create --subnet 172.31.66.0/24 $NET >/dev/null

if ! docker ps --format '{{.Names}}' | grep -qx awaaz-nwaku; then
  docker rm -f awaaz-nwaku >/dev/null 2>&1 || true
  docker run -d --name awaaz-nwaku --restart unless-stopped \
    --network $NET --ip $HUB_IP \
    -p 60000:60000 -p 8000:8000 -p 8645:8645 \
    -v "$PWD/nwaku-data:/data" wakuorg/nwaku:latest "${COMMON[@]}" \
    --store=true --store-message-db-url=sqlite:///data/store.sqlite3 \
    --store-message-retention-policy=time:604800 \
    --lightpush=true --filter=true --peer-exchange=true \
    --websocket-support=true --websocket-port=8000 \
    --nodekey="$(cat nodekey)" --rest=true --rest-address=0.0.0.0 --rest-port=8645 \
    --rest-admin=true --staticnode="/ip4/$RELAY_IP/tcp/60000/p2p/$RELAY_PEER" >/dev/null
  echo "nwaku started"
fi

if ! docker ps --format '{{.Names}}' | grep -qx awaaz-relay2; then
  docker rm -f awaaz-relay2 >/dev/null 2>&1 || true
  docker run -d --name awaaz-relay2 --restart unless-stopped \
    --network $NET --ip $RELAY_IP wakuorg/nwaku:latest "${COMMON[@]}" \
    --nodekey="$(cat relay2.key)" \
    --staticnode="/ip4/$HUB_IP/tcp/60000/p2p/$HUB_PEER" >/dev/null
  echo "relay2 started"
fi

# Works with no internet: once both models are in the local cache, never ask
# Hugging Face for updates (that lookup would hang or fail when offline).
HF_CACHE="${HF_HOME:-$HOME/.cache/huggingface}/hub"
if [ -d "$HF_CACHE/models--mlx-community--parakeet-tdt-0.6b-v2" ] && [ -d "$HF_CACHE/models--mlx-community--Qwen3.5-4B-4bit" ]; then
  export HF_HUB_OFFLINE=1
fi
export HF_HUB_DISABLE_TELEMETRY=1

echo "Hub ready. Phones find it automatically; address on this Wi-Fi: $(ipconfig getifaddr en0 2>/dev/null || echo unknown)"

PYTHONUNBUFFERED=1 exec .venv/bin/uvicorn server:app --host 0.0.0.0 --port 8787
