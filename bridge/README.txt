Proof POS print bridge
======================
Sends kitchen tickets, drink stickers and receipts from Proof POS to your network printers.
It must run on a computer on the same network as the printers, and stay on during service.

To test on a laptop:
1. Install Node.js (the LTS version) from https://nodejs.org
2. Unzip this folder somewhere you'll find it again.
3. Mac: double-click start-bridge.command (if it's blocked, right-click it > Open).
   Windows: double-click start-bridge.bat
4. Sign in with the shop account when it asks. It remembers it on this computer (config.json).
5. Leave the window open. In Proof POS > Printers, the bridge shows as "Running".

To sign in with a different account, delete config.json and start again.
