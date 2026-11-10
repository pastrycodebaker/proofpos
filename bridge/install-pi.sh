#!/bin/bash
# Sets up the Proof POS print bridge on a Raspberry Pi so it starts by itself and restarts if it stops.
set -e
cd "$(dirname "$0")"
DIR="$(pwd)"; ME="$(whoami)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Installing Node.js..."; curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
fi
echo "Installing the bridge..."; npm install --no-fund --no-audit
if [ ! -f config.json ]; then echo "Sign in with the shop account (saved on this Pi only)."; read -p "Email: " EM; read -s -p "Password: " PW; echo
  printf '{\n  "email": "%s",\n  "password": "%s"\n}\n' "$EM" "$PW" > config.json; chmod 600 config.json; fi
sed -e "s#/home/pi/proof-print-bridge#$DIR#" -e "s#User=pi#User=$ME#" proof-bridge.service | sudo tee /etc/systemd/system/proof-bridge.service >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable --now proof-bridge
echo; echo "Done. The bridge is running and will start by itself whenever the Pi turns on."
echo "Check it any time with: sudo systemctl status proof-bridge   (logs: journalctl -u proof-bridge -f)"
