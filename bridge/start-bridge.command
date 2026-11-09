#!/bin/bash
# Mac: double-click to start the Proof POS print bridge. Leave this window open.
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Install Node.js first from https://nodejs.org (the LTS version), then double-click this again."; read -p "Press Enter to close"; exit 1; fi
[ -d node_modules ] || { echo "Setting up for the first time. This takes a minute or two..."; npm install --no-fund --no-audit; }
node bridge.mjs
read -p "The bridge stopped. Press Enter to close."
