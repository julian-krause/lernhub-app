#!/bin/bash
# Baut ~/Applications/Lernhub.app aus dem heruntergeladenen Electron (ohne electron-builder):
#   Electron.app kopieren → Info.plist umbenennen (Name, Bundle-ID, Symbol, Mikrofon-Text) → App-Code nach
#   Contents/Resources/app → ad-hoc signieren → in ~/Applications installieren.
# Nach einem Neubau fragt macOS evtl. noch einmal nach Mikrofon und Schlüsselbund (neue Signatur).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/build/Lernhub.app"
DEST="$HOME/Applications/Lernhub.app"
ICON="$DIR/build/icon"
P="$OUT/Contents/Info.plist"
VERSION=$(node -p "require('$DIR/package.json').version")

# Symbol: SVG → PNG (Quick Look) → iconset → icns
if [ ! -f "$ICON/lernhub.icns" ] || [ "$ICON/lernhub.svg" -nt "$ICON/lernhub.icns" ]; then
  (cd "$ICON" && qlmanage -t -s 1024 -o . lernhub.svg >/dev/null 2>&1)
  rm -rf "$ICON/lernhub.iconset"; mkdir -p "$ICON/lernhub.iconset"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ICON/lernhub.svg.png" --out "$ICON/lernhub.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$ICON/lernhub.svg.png" --out "$ICON/lernhub.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICON/lernhub.iconset" -o "$ICON/lernhub.icns"
fi

rm -rf "$OUT"
cp -R "$DIR/node_modules/electron/dist/Electron.app" "$OUT"
rm -f "$OUT/Contents/Resources/default_app.asar"
mkdir -p "$OUT/Contents/Resources/app"
cp "$DIR/package.json" "$OUT/Contents/Resources/app/"
cp -R "$DIR/src" "$OUT/Contents/Resources/app/src"
cp "$ICON/lernhub.icns" "$OUT/Contents/Resources/lernhub.icns"

plutil -replace CFBundleIdentifier -string "local.lernhub.app" "$P"
plutil -replace CFBundleName -string "Lernhub" "$P"
plutil -replace CFBundleDisplayName -string "Lernhub" "$P"
plutil -replace CFBundleIconFile -string "lernhub.icns" "$P"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$P"
plutil -replace CFBundleVersion -string "$VERSION" "$P"
plutil -replace LSApplicationCategoryType -string "public.app-category.education" "$P"
plutil -replace NSMicrophoneUsageDescription -string "Lernhub hört zu, wenn du diktierst oder in der Sprechstunde mit dem Tutor sprichst." "$P"
plutil -remove NSCameraUsageDescription "$P" 2>/dev/null || true
plutil -replace NSHumanReadableCopyright -string "Lernhub · kurs-tutor" "$P"

codesign --force --deep --sign - "$OUT" 2>/dev/null
if [ "${1:-}" = "--nur-bauen" ]; then echo "Gebaut: $OUT ($VERSION), nicht installiert"; exit 0; fi
if [ "${1:-}" = "--wenn-beendet" ]; then           # erst installieren, wenn die laufende App beendet ist
  while pgrep -f "$DEST/Contents/MacOS/Electron" >/dev/null; do sleep 5; done
fi
rm -rf "$DEST"
mkdir -p "$HOME/Applications"
cp -R "$OUT" "$DEST"
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "$DEST"
echo "Installiert: $DEST ($VERSION)"
