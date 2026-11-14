#!/bin/sh
# Re-downloads the Dolby Atmos and Dolby Vision logos (from Wikimedia Commons) used in
# the popup's format badges into netflix-atmos/brand/. Dolby's trademarks; used only to
# identify the formats playing. Without them the popup falls back to its own badges.
set -e
cd "$(dirname "$0")/../netflix-atmos/brand"
UA="atmosphere-logo-fetch/1.0"
curl -fsSL -A "$UA" -o dolby-atmos.svg  "https://upload.wikimedia.org/wikipedia/commons/a/a8/Dolby_Atmos_%28logo%29.svg"
curl -fsSL -A "$UA" -o dolby-vision.svg "https://upload.wikimedia.org/wikipedia/commons/3/3f/Dolby_Vision_%28logo%29.svg"
# Sanity check: plain SVG, no scripts.
for f in dolby-atmos.svg dolby-vision.svg; do
  grep -q "<svg" "$f" || { echo "$f is not an SVG"; exit 1; }
  if grep -qi "<script" "$f"; then echo "$f contains a script; removing"; rm -f "$f"; exit 1; fi
done
echo "Saved brand logos to netflix-atmos/brand/"
