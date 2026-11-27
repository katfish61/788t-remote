# 788T Remote

A touch-screen remote for the **Sound Devices 788T**, in the style of SD Remote. It runs in a browser, so there's
nothing to install from an app store:

- **Android tablet over USB:** plug the tablet into the 788T and use it as a wired remote (Chrome, WebUSB).
- **Any phone or tablet over Wi-Fi** (iPad, iPhone, Android) through a **Raspberry Pi** plugged into the 788T,
  which makes its own Wi-Fi hotspot.

Built on **Joe Origlieri's 788T Web Controller v18** (posted as jawharp on JWSoundGroup), whose page talks to the
788T over C.Link. Joe's page is included unchanged in `original/`; `build.py` adds the tablet layout, the USB and
Wi-Fi links, and the features below on top of it.

> Not a Sound Devices product, and not affiliated with them. Free to use. Use it between takes with care, and
> keep the 788T's own controls in reach.

## Features
- **SD Remote-style layout:** top bar with Current / Next take (scene, take and notes edited in place),
  timecode, sample rate / bit depth / fps and A. Time; horizontal L/R meters; a transport column (Record, False take,
  Stop, Play, Slate up, Tone) that stays on screen on every tab.
- **Channel strips:** name (edit in place), meter, ARM, MUTE, and tap the letter box for the **fat channel**.
- **Fat channel** per track, following your input routing: source Mic / Line / AES, 48V, low cut (40–320 Hz,
  6/12 dB), phase, limiter, delay, iso pre/post, mute, pan, and the 788T's parametric EQ with a live response
  curve. (Pan and the parametric EQ only act with a CL-9 attached; the low cut works without one.)
- **Routing** grid: inputs 1–8 to tracks L, R, A–H, X1, X2, pre/post per route.
- **Outputs:** six output strips with meters, level, source and mute; a **fat output** to pick sources (any mix of
  inputs, or of tracks, or of headphone L/R, as the 788T allows).
- **Front-panel changes show up by themselves** (the 788T's change report: take edits, arming, routing).
- **Playback timecode** shows the playing file's TC (correct for older takes too).
- **Sound Report:** read the takes from the 788T (or WAV headers from a card reader) and **share a PDF, a CSV or
  both** (A4 landscape PDF made in the app; episode/scene/slate columns; daily-folder blocks).
- Files list, recording settings (Record Media fixed: it's setting 74), timecode, headphone modes, system.
- One app for USB and Wi-Fi (switch next to Connect); it works offline once installed.

## Install: Android tablet, USB
1. Open **https://katfish61.github.io/788t-remote/** in **Chrome** on the tablet, then ⋮ → **Install app**.
2. On the 788T, set **Connection Mode** to **USB/WaveAgent**.
3. Connect the tablet to the 788T's square **USB-B** port (USB-C to USB-B cable).
4. Open the app, set the switch next to Connect to **USB**, tap **Connect**, and allow the USB device.

It's served over https, so no Chrome flags are needed.

## Install: Raspberry Pi Wi-Fi bridge (any phone or tablet)
You need a Raspberry Pi 4 (or 5) with Raspberry Pi OS (Bookworm or later) and a USB-A to USB-B cable to the 788T.

1. Copy the `pi/` folder to the Pi, e.g. `scp -r pi pi@raspberrypi.local:~/788t-bridge`.
2. On the Pi:
   ```
   sudo raspi-config        # Localisation > WLAN Country (needed for 5 GHz)
   cd ~/788t-bridge
   sudo ./install.sh --hotspot <wifi-password>
   ```
   This installs the bridge (starts at boot) and creates a 5 GHz hotspot **"788T"** (set `HOTSPOT_SSID=...` to
   rename it). Over SSH on home Wi-Fi, the connection drops when the hotspot comes up; that's expected.
3. Plug the Pi into the 788T's **USB-B** port; on the 788T set **Connection Mode** to **USB/WaveAgent**.
4. On the phone or tablet, join the **788T** Wi-Fi and open **http://10.42.0.1/**, then **Connect**.
   Add it to the home screen (Safari: Share → Add to Home Screen; Chrome: ⋮ → Install app).

Only one device controls the 788T at a time; a new connection takes over. iPad and iPhone need iOS 14.5 or later.
On Android, add `http://10.42.0.1` to `chrome://flags` → *Insecure origins treated as secure* if you also want
USB and offline use from the Pi-installed app.

Updating the Pi later: copy the new `pi/` folder over and run `bash ~/788t-bridge/deploy.sh` (app files need no
restart; the bridge restarts only when `bridge.py` changed).

## Building from source
```
python3 build.py      # -> dist/tablet-app/ (the app), dist/788T_Controller_tablet.html, pi/app/
```
`web/` holds the additions (transport shim, tablet layout, sound report, service worker); `pi/` the bridge
(Python, aiohttp + pyserial). `build.py` patches Joe's page in place (a list of small, checked text patches), so
it fails loudly if a future version of the original changes.

## What the 788T doesn't allow over C.Link
Found by testing on a real 788T and by listening to Sound Devices' own CL-WiFi app (see
`notes/clwifi-findings.md`):
- No fader or trim levels, no rewind / fast-forward, no "cue this take", no battery / voltage or drive space.
- Every meter request returns the **track** meters, so input and output levels are shown through the tracks
  they feed.
- Pan, the parametric EQ and output mute only take effect with a CL-9.
- Output names, rec/stop/play auto-mute and linking don't exist on the 788T; output delay (outputs 1–2) is in its
  menu only.

## Credits and licence
- **Joe Origlieri**: the 788T Web Controller (`original/`), the C.Link library and protocol work it's all built
  on. His note in the page: *"Feel free to modify this and use it however you want, I have no rights to any of
  it."* His credit stays on the app's System page.
- **Keith Tunney**: tablet / WebUSB layer, Raspberry Pi Wi-Fi bridge, SD Remote-style layout, fat channel and
  outputs, Sound Report. These additions are under the MIT licence (`LICENSE`).
- C.Link, the 788T, CL-8, CL-9, CL-WIFI and SD Remote are Sound Devices products and names.
