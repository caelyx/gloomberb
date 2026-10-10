#!/usr/bin/env bash
set -euo pipefail

# Build an unsigned Gloomberb.app for Apple Silicon from this checkout,
# including any uncommitted changes, with no update feed
# (GLOOMBERB_DESKTOP_LOCAL in electrobun.config.ts).
#
#   scripts/build-macos-local.sh            # leaves artifacts/local/Gloomberb.app
#   scripts/build-macos-local.sh --install  # also replaces /Applications/Gloomberb.app

usage() { echo "usage: $0 [--install]" >&2; }

install=false
if [ $# -gt 1 ]; then usage; exit 2; fi
case "${1:-}" in
  "") ;;
  --install) install=true ;;
  -h|--help) usage; exit 0 ;;
  *) usage; exit 2 ;;
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

dest="/Applications/Gloomberb.app"

# Checked before the build as well as after it, so a problem shows up now
# rather than after several minutes of building.
check_can_install() {
  # Covers the desktop app and the gloomberb terminal command it bundles.
  if pgrep -qf "$dest/Contents/"; then
    echo "Quit Gloomberb (and any gloomberb terminal sessions), then run this again." >&2
    exit 1
  fi
  if [ ! -w /Applications ] || { [ -e "$dest" ] && [ ! -w "$dest" ]; }; then
    echo "Cannot write to $dest. Run without --install and copy the app there yourself." >&2
    exit 1
  fi
}

if $install; then check_can_install; fi

cd "$(dirname "$0")/.."

wanted_bun="$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)"
if [ -n "$wanted_bun" ] && [ "$(bun --version)" != "$wanted_bun" ]; then
  echo "Warning: this repo expects Bun $wanted_bun, you have $(bun --version). If the build fails, try: bun upgrade" >&2
fi

tarball="artifacts/stable-macos-arm64-Gloomberb.app.tar.zst"
rm -f "$tarball"
bun install --frozen-lockfile
GLOOMBERB_DESKTOP_LOCAL=1 bun run desktop:release

out="artifacts/local"
app="$out/Gloomberb.app"
rm -rf "$out"
mkdir -p "$out"
zstd -q -d -o "$out/Gloomberb.app.tar" "$tarball"
tar -xf "$out/Gloomberb.app.tar" -C "$out"
rm "$out/Gloomberb.app.tar"

# Apple Silicon refuses to run unsigned code; an ad-hoc signature is enough.
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
"$app/Contents/Resources/gloomberb" help >/dev/null

built="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then built="$built plus uncommitted changes"; fi

if $install; then
  check_can_install
  # Copy first, so a failed copy leaves the installed app untouched.
  staging="/Applications/.Gloomberb.app.new"
  rm -rf "$staging"
  ditto "$app" "$staging"
  rm -rf "$dest"
  mv "$staging" "$dest"
  echo "Installed $dest (built from $built)"
else
  echo "Built $app (from $built)"
fi
