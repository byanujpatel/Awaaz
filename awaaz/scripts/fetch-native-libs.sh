#!/usr/bin/env bash
# Downloads the prebuilt native libraries (.a/.so) from the GitHub release and
# restores them into native/logosdelivery/.
#
# Runs automatically via `npm install` (postinstall). It is a no-op when the
# libraries are already present, so repeat installs cost nothing. Pass --force
# to re-download regardless.
set -euo pipefail

TAG="native-libs-v2"
BASE="https://github.com/hackyguru/logos-messaging-mobile/releases/download/$TAG"
IOS_SHA256="52fff8cf006705e867c0af8944280340e78782d71cb9013039f51e7084a52cf0"
ANDROID_SHA256="8317a27fdf4def17fbccafff9dc90cc39de6bd25a875fd211cf99534f968c5be"

# The files withLogosDelivery.js and LogosMessaging.podspec actually consume.
REQUIRED=(
  native/logosdelivery/arm64-v8a/libc++_shared.so
  native/logosdelivery/arm64-v8a/librln.so
  native/logosdelivery/arm64-v8a/liblogosdelivery.so
  native/logosdelivery/arm64-v8a/liblogos_messaging_jni.so
  native/logosdelivery/ios/liblogosdelivery.a
  native/logosdelivery/ios/librln.a
)

cd "$(dirname "$0")/.."

if [ "${1:-}" != "--force" ]; then
  missing=0
  for f in "${REQUIRED[@]}"; do
    [ -s "$f" ] || missing=1
  done
  if [ "$missing" = 0 ]; then
    echo "Native libraries already present — skipping download (use --force to refetch)."
    exit 0
  fi
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Progress bar interactively; quiet under `npm install` and CI.
if [ -t 1 ]; then progress="-#"; else progress="-s"; fi

fetch_archive() { # $1=platform  $2=expected sha256
  local name="native-libs-$1.tar.gz" want=$2
  local out="$work/$name"
  echo "Fetching $name ..."
  # --retry-all-errors + -C - so a dropped connection resumes rather than restarts.
  curl -fL $progress --retry 8 --retry-all-errors --retry-delay 5 -C - \
    -o "$out" "$BASE/$name"

  local got
  got=$(shasum -a 256 "$out" | cut -d' ' -f1)
  if [ "$got" != "$want" ]; then
    echo "error: checksum mismatch for $name (got $got, want $want)" >&2
    exit 1
  fi
  tar xzf "$out"
}

fetch_archive ios "$IOS_SHA256"
fetch_archive android "$ANDROID_SHA256"

for f in "${REQUIRED[@]}"; do
  if [ ! -s "$f" ]; then
    echo "error: $f still missing after download" >&2
    exit 1
  fi
done

echo "Native libraries restored under native/logosdelivery/."
