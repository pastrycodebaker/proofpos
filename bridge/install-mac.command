#!/bin/bash
# Mac mini: double-click once. Sets up the Proof POS print bridge to start by itself at login
# and restart within seconds if it ever stops. Run it again any time to update or repair.
cd "$(dirname "$0")"; DIR="$(pwd)"
NODE="$(command -v node || true)"
[ -z "$NODE" ] && [ -x /usr/local/bin/node ] && NODE=/usr/local/bin/node
[ -z "$NODE" ] && [ -x /opt/homebrew/bin/node ] && NODE=/opt/homebrew/bin/node
if [ -z "$NODE" ]; then echo "Install Node.js first from https://nodejs.org (the LTS version), then double-click this again."; read -p "Press Enter to close"; exit 1; fi
echo "Installing the bridge (a minute or two the first time)..."
PATH="$(dirname "$NODE"):$PATH" npm install --no-fund --no-audit || { read -p "Install failed. Press Enter to close"; exit 1; }
if [ ! -f config.json ]; then
  echo; echo "Sign in with the shop's Proof POS account (saved on this Mac only)."
  read -p "Email: " EM; read -s -p "Password: " PW; echo
  printf '{\n  "email": "%s",\n  "password": "%s"\n}\n' "$EM" "$PW" > config.json; chmod 600 config.json
fi
LABEL=com.flourandsalt.proofbridge; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"; mkdir -p "$HOME/Library/LaunchAgents" "$DIR/logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/bridge.mjs</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DIR/logs/bridge.log</string>
  <key>StandardErrorPath</key><string>$DIR/logs/bridge.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" && launchctl enable "gui/$(id -u)/$LABEL"
sleep 3; echo
if launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -q "state = running"; then echo "Done. The bridge is running and starts by itself whenever this Mac signs in."
else echo "Installed, but it isn't running yet. The last lines of the log:"; tail -n 15 "$DIR/logs/bridge.log" 2>/dev/null; fi
echo "Check it any time on the Printers page (the box turns green). Log file: $DIR/logs/bridge.log"
echo "To stop it for good: launchctl bootout gui/$(id -u)/$LABEL"
read -p "Press Enter to close"
