#!/usr/bin/env bash
# Install the 788T Wi-Fi bridge on Raspberry Pi OS (Bookworm/Trixie, NetworkManager).
#
#   sudo ./install.sh                   install/update the bridge only (safe over SSH)
#   sudo ./install.sh --hotspot PASS    also bring up a Wi-Fi hotspot (drops SSH over home Wi-Fi)
#
# Hotspot: NetworkManager connection "788T-AP", SSID "788T" (set HOTSPOT_SSID=... to
# change it), 5 GHz channel 36, address 10.42.0.1 (NetworkManager's shared default).
# Set the Pi's Wi-Fi country first (sudo raspi-config > Localisation > WLAN Country).
# If the Pi already has a FreqOut hotspot ("FreqOutAP"), that one is reused as-is and
# shared, so nothing about FreqOut changes.
#   788T controller:  http://10.42.0.1/
set -euo pipefail
cd "$(dirname "$0")"

apt-get update
apt-get install -y python3-aiohttp python3-serial

install -d /opt/788t-bridge/app
install -m 755 bridge.py /opt/788t-bridge/
rm -f /opt/788t-bridge/app/*
install -m 644 app/* /opt/788t-bridge/app/
install -m 644 788t-bridge.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable 788t-bridge
systemctl restart 788t-bridge
sleep 1
systemctl --no-pager --lines=3 status 788t-bridge || true
echo "Bridge installed. On the home network: http://$(hostname -I | awk '{print $1}')/"

if [[ "${1:-}" == "--hotspot" ]]; then
  SSID="${HOTSPOT_SSID:-788T}"
  CON="788T-AP"
  if nmcli -t -f NAME con show | grep -qx FreqOutAP; then
    CON="FreqOutAP"; SSID="FreqOut"
    echo "FreqOut hotspot (FreqOutAP) found; sharing it."
  elif nmcli -t -f NAME con show | grep -qx "$CON"; then
    echo "Hotspot $CON already exists; reusing it."
  else
    PSK="${2:?give a Wi-Fi password, at least 8 characters}"
    echo "Creating hotspot $CON (SSID $SSID, 5 GHz)."
    nmcli con add type wifi ifname wlan0 con-name "$CON" autoconnect yes ssid "$SSID" mode ap
    nmcli con modify "$CON" \
      802-11-wireless-security.key-mgmt wpa-psk \
      802-11-wireless-security.psk "$PSK" \
      ipv4.method shared \
      802-11-wireless.band a 802-11-wireless.channel 36 \
      connection.autoconnect-priority 100
  fi
  echo "Bringing the hotspot up. SSH over home Wi-Fi will drop now."
  echo "Join Wi-Fi '$SSID', then open http://10.42.0.1/"
  nmcli con up "$CON"
fi
