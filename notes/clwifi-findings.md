# What Sound Devices' CL-WiFi app sends to the 788T (captured 2026-11-27)

How it was done: the CL-WIFI box was on the 788T's C.Link In port (Connection Mode = CL-WIFI). The old iPad
(iOS 9.3.5) ran the CL-WiFi app, on the box's open ad-hoc network "CL-WIFI" (channel 3; box 172.20.50.1, iPad
172.20.50.2). The Mac recorded it with Wireless Diagnostics → Sniffer (
4 minutes, about 13,500 packets). Nothing was sent to the recorder by us; this only listened.

**Only 0x55 is new.** 0x51, 0x52 and 0x54 turned out to be in Joe's page already (written as decimal 81, 82, 84).

**The CL-WIFI box is a transparent bridge:** TCP port **5100** carries raw C.Link packets, the same framing
the web controller uses (`A5 00 len cmd data ck ck` out, `A5 FE …` back).

## Commands the app used

| Cmd | Dec | Use | Known before? |
|---|---|---|---|
| 0x13 | 19 | Timecode (polled ~7/s). The reply has no F1 code (12 data bytes) | yes |
| 0x3E | 62 | Meters, group 1 = tracks (polled) | yes |
| **0x55** | **85** | **Change report** (polled ~1/s), see below | **no** |
| 0x12 | 18 | Transport state | yes |
| 0x11 | 17 | Transport: 02 = Record, 00 = Stop | yes |
| 0x38 / 0x39 | 56 / 57 | Take list / read take parameters | yes |
| 0x3A | 58 | Set take parameter (scene, take, notes) | yes |
| 0x3B | 59 | False take | yes |
| 0x0A / 0x0B | 10 / 11 | Settings get/set: 124 = track arming, 8, 234, 0 | yes |
| 0x52 | 82 | Read input routing: `[input 0–7]` → F1 + 32-bit track bitmap (bit 0 = L, 1 = R, 2 = A … 9 = H) | yes (Joe's Inputs tab) |
| 0x51 | 81 | Set input routing: `[input][bitmap, 4 bytes LE]` → F0 ack, then F1 echo of the new bitmap | yes (Joe's Inputs tab) |
| 0x54 | 84 | Read input pre/post routing: `[input]` → bitmap of routed tracks fed pre-fader (input 1 → `03` = L,R). 0x53 (83) sets it | yes (Joe's Inputs tab) |

Routing example: factory routing read input n → L, R and track n (`07`, `0B`, `13`, `23`, `43`, `83`, `0301`,
`0302`). Changes made in the app: input 3 → `33` (L,R,C,D), input 4 → `63`, input 5 → `1C3`.

## 0x55 change report (8 data bytes after F1)

| Bytes | Seen | Meaning (likely) |
|---|---|---|
| `01 00 00 00 00 00 00 00` | idle | nothing changed |
| byte 1 = `02` | after Record start/stop, false take | take list changed |
| byte 1 = `01`, bytes 2–5 = take handle | after each scene/take/notes write (handle 0x55 / 0x50) | that take was edited |
| byte 6 = `02` | after arming a track (setting 124) | settings / arming changed |
| byte 6 = `01` | after Stop | some other setting or track change |
| byte 7 (bitmap) | `01` after input routing changes; `04` after output routing changes (seen from our app on a real 788T) | routing changed: 1 = input, 4 = output |

The app polls it and only re-reads what changed. The same could let our app notice front-panel changes
(take edits, arming, routing) without polling everything.

## Not seen

No command for media status or free space, battery or voltage, rewind or fast-forward, or cueing a take.
Tapping takes in the app's Take List only read their details. Sound Devices' own remote didn't use any such
command, so the 788T most likely doesn't offer them over C.Link.
