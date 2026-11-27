#!/bin/bash
# Install an update copied into ~/788t-bridge (run on the Pi by the Mac's push script).
# App files are served fresh on every request, so they never need a restart. The bridge
# service is only restarted when bridge.py itself changed, and not while a device is
# connected unless FORCE=1 (a restart drops that device's connection).
# Usage: deploy.sh [string that must appear in the installed index.html]
set -e
cd ~/788t-bridge
CHECK="${1:-788T Remote}"
sudo -n rm -f /opt/788t-bridge/app/*
sudo -n install -m 644 app/* /opt/788t-bridge/app/
old=$(sha256sum /opt/788t-bridge/bridge.py | cut -c1-64)
new=$(sha256sum bridge.py | cut -c1-64)
if [ "$old" != "$new" ]; then
  if curl -s localhost/status | grep -q '"client_connected": true' && [ "${FORCE:-0}" != 1 ]; then
    echo "BRIDGE CHANGED BUT A DEVICE IS CONNECTED: restart deferred (run again with FORCE=1)"
  else
    sudo -n install -m 755 bridge.py /opt/788t-bridge/
    sudo -n systemctl restart 788t-bridge
    sleep 2
    echo "bridge restarted"
  fi
else
  echo "app files only, no restart"
fi
systemctl is-active 788t-bridge
grep -c -F "$CHECK" /opt/788t-bridge/app/index.html
