#!/usr/bin/env bash
set -euo pipefail

# Build an unsigned Gloomberb.app for Apple Silicon from this checkout, with no
# update feed (GLOOMBERB_DESKTOP_LOCAL in electrobun.config.ts).
#
#   scripts/build-macos-local.sh            # leaves artifacts/local/Gloomberb.app
#   scripts/build-macos-local.sh --install  # also replaces /Applications/Gloomberb.app

install=false
case "${1:-}" in
  "") ;;
  --install) install=true ;;
  *) echo "usage: $0 [--install]" >&2; exit 2 ;;
esac

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "This builds the Apple Silicon desktop app and must run on an Apple Silicon Mac." >&2
  exit 1
fi
for tool in bun zstd; do
  if ! command -v "$tool" >/dev/null; then
    echo "$tool is not installed (brew install $tool)." >&2
    exit 1
  fi
done

cd "$(dirname "$0")/.."

bun install --frozen-lockfile
GLOOMBERB_DESKTOP_LOCAL=1 bun run desktop:release

out="artifacts/local"
app="$out/Gloomberb.app"
rm -rf "$out"
mkdir -p "$out"
zstd -q -d -o "$out/Gloomberb.app.tar" artifacts/stable-macos-arm64-Gloomberb.app.tar.zst
tar -xf "$out/Gloomberb.app.tar" -C "$out"
rm "$out/Gloomberb.app.tar"

# Apple Silicon refuses to run unsigned code; an ad-hoc signature is enough.
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
"$app/Contents/Resources/gloomberb" help >/dev/null

if $install; then
  if pgrep -xq Gloomberb; then
    echo "Quit Gloomberb, then run this again with --install." >&2
    exit 1
  fi
  rm -rf /Applications/Gloomberb.app
  ditto "$app" /Applications/Gloomberb.app
  echo "Installed /Applications/Gloomberb.app"
else
  echo "Built $app"
fi
