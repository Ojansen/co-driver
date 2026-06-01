# co-driver

[![Source](https://img.shields.io/badge/source-github.com%2FOjansen%2Fco--driver-181717?logo=github)](https://github.com/Ojansen/co-driver) [![Docker Pulls](https://img.shields.io/docker/pulls/obedbj/co-driver)](https://hub.docker.com/r/obedbj/co-driver) [![License](https://img.shields.io/github/license/Ojansen/co-driver)](https://github.com/Ojansen/co-driver/blob/main/LICENSE)

Your own telemetry workspace for **Forza Horizon** and the **F1** games. Runs on your laptop or a mini PC, reads the UDP telemetry your game already broadcasts, and turns it into a second-screen dashboard, a hotlap timer, a dyno and a tune workbench. No accounts, no cloud, no leaderboards reading your laps.

> Measurement, not prescription. The tool shows you what the car actually did — you decide what to change.

## Supported games

co-driver listens for every supported game **at once** — launch any of them and it streams, no setup beyond pointing the game at the server. Live telemetry works for all of them; the tuning stack (dyno, builds, tune workbench) is Forza-Horizon-specific. Pick your game in **Settings → Game** to set what the UI shows.

| Game | Live telemetry | Tuning stack | UDP port |
|---|---|---|---|
| Forza Horizon 6 | ✅ | ✅ | `5300` |
| Forza Horizon 5 | ✅ | — | `5300` |
| Forza Motorsport (FM7 / 2023) | ✅ | — | `5300` |
| F1 25 / F1 26 | ✅ | — | `20777` |
| Project CARS 2 | ✅ | — | `5606` |

## What you get

**A live dashboard for the second screen.**
Prop a phone or tablet next to the TV. Each corner of the car becomes its own instrument — suspension, tire temperatures, slip, damper motion. A 10‑second input trace shows throttle, brake, steering and yaw at the full game rate, with trail‑braking automatically highlighted. A live G‑G plot fades the last ~20 seconds so you can see how round your traction circle really is. Pause and scrub the last few seconds without leaving the page.

**A hotlap delta you'd recognise from real motorsport.**
Live delta to your session best, per‑sector PBs in green/purple, predicted and theoretical lap, and a track map that shows you exactly where the time is going.

**Laps you can compare.**
Compare any two laps side by side — overlay routes, scrub through synchronised traces, read the apex‑speed table and the sector splits that explain the gap.

**A dyno you actually understand.** *(Forza Horizon)*
Plot your engine's power, torque and boost across the rev range. Pick units that match how you think — bar, psi or atm — and tune gear ratios against the powerband you actually have.

**A tune workbench built around your data.** *(Forza Horizon)*
Springs, dampers, anti‑roll bars, tire pressures and brake bias each sit next to the telemetry that justifies the change. The auto‑baseline calculator gives you an FH6‑correct starting point, build‑aware so it adapts to your upgrades. Damper velocity histograms tell you whether your low‑speed and high‑speed bump/rebound are doing their job. Build and tune are kept as separate layers, so you never confuse "the car can't do this" with "the setup isn't there yet." Cars, builds, tunes and sessions stay organised in a garage that remembers.

**Built‑in manuals.**
Every heavy view links to a short page that explains what to read and what to look for, so the tool teaches itself.

## Install

### Docker (recommended)

Pull the prebuilt image — no clone, no toolchain.

```bash
docker run -d --name co-driver \
  -p 3000:3000 \
  -p 5300:5300/udp \
  -p 20777:20777/udp \
  -p 5606:5606/udp \
  -v co-driver:/app/data \
  --restart unless-stopped \
  obedbj/co-driver:latest
```

Open <http://localhost:3000>. You'll see "WAITING FOR TELEMETRY" until a game starts sending — the container listens for Forza Horizon on `5300`, F1 on `20777` and Project CARS 2 on `5606` (drop a port mapping if you don't play that game). Migrations run automatically on first start; session/lap data lives in the named volume (`co-driver`) and survives container rebuilds. Multi‑arch — `linux/amd64` and `linux/arm64`.

### Docker Compose

```bash
git clone https://github.com/Ojansen/co-driver.git
cd co-driver
docker compose up -d
```

Same ports and volume, declared in `docker-compose.yml`.

## Connect your game

co-driver listens for every supported game at once — there's no server-side "active game" to set. Selecting a game in **Settings → Game** only controls what the UI shows and gates (tuning is Forza-Horizon-specific); it doesn't affect what's captured. So connecting is just: point the game's telemetry output at the server, and pick it in Settings.

| Game | Enable in-game | Default port |
|---|---|---|
| Forza Horizon 6 / 5 | Settings → HUD and Gameplay → Data Out | `5300` |
| Forza Motorsport (FM7 / 2023) | Settings → Gameplay & HUD → Data Out | `5300` |
| F1 25 / F1 26 | Settings → Telemetry Settings → UDP | `20777` |
| Project CARS 2 | Options → System → UDP | `5606` |

### Forza Horizon (FH5 / FH6)

> Settings → HUD and Gameplay → Data Out

| Setting | Value |
|---|---|
| Data Out | **On** |
| Data Out IP | LAN IP of the machine running co-driver (or `127.0.0.1` if same PC) |
| Data Out Port | `5300` (or whatever you set `FORZA_PORT` to) |

### Forza Motorsport (FM7 / FM 2023)

> Settings → Gameplay & HUD → Data Out *(FM7: HUD and Gameplay)*

| Setting | Value |
|---|---|
| Data Out | **On** |
| Data Out IP | LAN IP of the machine running co-driver (or `127.0.0.1` if same PC) |
| Data Out Port | `5300` *(shared with Forza Horizon)* |
| Data Out Packet Format | **Dash** *(the "Sled" format omits the dashboard fields and won't decode)* |

Motorsport reuses Horizon's port `5300` — co-driver tells the two apart by packet length, so no extra configuration. Like the other non-FH6 titles it's telemetry-only (no tuning stack).

### F1 25 / F1 26

> Game Options → Settings → Telemetry Settings

| Setting | Value |
|---|---|
| UDP Telemetry | **On** |
| UDP Broadcast Mode | Off *(set On to send to the whole subnet instead of one IP)* |
| UDP IP Address | LAN IP of the machine running co-driver *(ignored in broadcast mode)* |
| UDP Port | `20777` |
| UDP Send Rate | `60` |
| UDP Format | `2025` *(or `2026`)* |

F1 is telemetry-only: the live dashboards work, while the Forza-specific tuning, dyno and garage features stay hidden.

### Project CARS 2

> Options → System

| Setting | Value |
|---|---|
| Shared Memory | **Project CARS 2** |
| UDP Frequency | `1`–`9` (higher = more frequent) |
| UDP Protocol Version | **Project CARS 2** |

Project CARS 2 broadcasts on the whole subnet, so no target IP is needed — just open UDP `5606` to the server. Telemetry-only (no tuning stack), and note SMS telemetry carries no wheel-slip channels, so slip-based views stay empty.

### Finding your server's LAN IP

```bash
# Linux
ip -4 addr show | awk '/inet / && !/127.0.0.1/ {print $2}'
# macOS
ipconfig getifaddr en0
# Windows
ipconfig
```

### Firewall

The listener binds each game's UDP port on `0.0.0.0` (Forza Horizon `5300`, F1 `20777`, Project CARS 2 `5606`). If your OS firewall blocks them, allow inbound UDP on the port(s) you use from your LAN.

### Start order: server before game (or apply the ICMP fix)

If you start **Forza before co-driver is listening**, the stream can fail to connect and stay dead until you fully restart the game — no first packet ever arrives, even after the server comes up. This is not a bug in co-driver; it's a Windows networking quirk:

While nothing is bound to UDP `5300`, the server's OS answers each of Forza's packets with an **ICMP port-unreachable**. Windows delivers that to Forza's Data Out socket as a connection reset and wedges it permanently — a Data Out toggle won't revive it, only relaunching the game does.

Two ways to avoid it:

- **Simplest:** start co-driver before turning on Data Out (or keep it running as an always-on service). Once the listener is up first, there's no rejection to wedge the game.
- **Permanent fix (Linux server):** stop the host from sending that rejection, so Forza keeps streaming until co-driver binds and then attaches on the first packet:

  ```bash
  sudo iptables -A OUTPUT -p icmp --icmp-type port-unreachable -j DROP
  # persist across reboots (Debian/Ubuntu):
  sudo apt install -y iptables-persistent && sudo netfilter-persistent save
  ```

  The rule only matters during the no-listener window; it has no effect once co-driver is running.

## Configuration

Set via environment variables (Docker `-e`, or the compose file):

| Var | Default | Purpose |
|---|---|---|
| `FORZA_PORT` | `5300` | UDP port for the Forza Horizon listener (relocates it; F1 stays on `20777`). |
| `FORZA_BIND` | `0.0.0.0` | Bind address (`127.0.0.1` for same-machine only) |
| `NITRO_PORT` | `3000` | Web UI port |
| `NITRO_HOST` | `0.0.0.0` | Web UI bind |

## Status

Early. The UI shape is stable, the recording pipeline is stable, the tune workflow is in active use. Expect rough edges and small breaking changes. Feedback and issue reports are welcome.

## License

[MIT](./LICENSE).
