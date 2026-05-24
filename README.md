# co-driver

[![Source](https://img.shields.io/badge/source-github.com%2FOjansen%2Fco--driver-181717?logo=github)](https://github.com/Ojansen/co-driver) [![Docker Pulls](https://img.shields.io/docker/pulls/obedbj/co-driver)](https://hub.docker.com/r/obedbj/co-driver) [![License](https://img.shields.io/github/license/Ojansen/co-driver)](https://github.com/Ojansen/co-driver/blob/main/LICENSE)

Self-hosted telemetry and tuning tool for **Forza Horizon 6**. Listens for the game's UDP "Data Out" packets on your own machine and turns them into a per-corner instrument, a lap recorder, and a tune-aware workflow. No accounts, no cloud, no third-party telemetry.

> Measurement, not prescription. The tool shows you what the car actually did — you decide what to change.

## What it does

**Live telemetry**
- Per-corner readout: suspension travel, slip ratio + angle, tire temperatures banded cold / optimal / hot
- Bottoming indicator when normalized suspension travel saturates
- 10 s rolling input trace — throttle, brake, steering, yaw — drawn with uPlot at the full UDP packet rate
- Connection-status watchdog so you can see the moment the stream drops

**Session and lap analysis**
- Lap recorder with per-sector deltas against your personal best
- Persistent car identity, surfaced in a sticky session banner so the active car and recording state stay visible across laps
- Point-to-point buffering preserved across finish-line transitions

**Tune and upgrade workflow**
- Per-car "your data" panels next to every tune and upgrade page, so each adjustment is read against the telemetry the car actually produced
- Diagnose view that surfaces measurement-driven observations, not prescriptive scores
- A car library + event browser for organising sessions

## Install

### Docker Hub (recommended)

Pull the prebuilt image. No clone, no toolchain.

```bash
docker run -d --name co-driver \
  -p 3000:3000 \
  -p 5300:5300/udp \
  -v co-driver:/app/data \
  --restart unless-stopped \
  obedbj/co-driver:latest
```

Open <http://localhost:3000>. You'll see "WAITING FOR TELEMETRY" until Forza starts sending. Migrations run automatically on first start; session/lap data lives in the named volume (`co-driver`) and survives container rebuilds.

Multi-arch — `linux/amd64` and `linux/arm64` both supported. Docker Hub serves the right manifest automatically.

### Build it yourself

```bash
git clone https://github.com/Ojansen/co-driver.git
cd co-driver
docker compose up -d --build
```

The Dockerfile is multi-stage: it installs and builds inside the container, so no host toolchain beyond Docker is required.

### Dev mode (contributors)

```bash
git clone https://github.com/Ojansen/co-driver.git
cd co-driver
bun install
bun run dev          # HMR
# or production-style on bare metal
bun run build:node && node .output/server/index.mjs
```

## Configure Forza Horizon 6

In the game:

> Settings → HUD and Gameplay → Data Out

| Setting | Value |
|---|---|
| Data Out | **On** |
| Data Out IP | LAN IP of the machine running co-driver (or `127.0.0.1` if same PC) |
| Data Out Port | `5300` (or whatever you set `FORZA_PORT` to) |

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

The listener binds UDP `5300` on `0.0.0.0` by default. If your OS firewall blocks it, allow inbound UDP `5300` from your LAN.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `FORZA_PORT` | `5300` | UDP port the server listens on |
| `FORZA_BIND` | `0.0.0.0` | Bind address (`127.0.0.1` for same-machine only) |
| `NITRO_PORT` | `3000` | Web UI port |
| `NITRO_HOST` | `0.0.0.0` | Web UI bind |

A starter `.env.example` is included; copy to `.env` to override defaults outside Docker.

## Stack

- Nuxt 4 + Nitro (server-side UDP listener, WebSocket fan-out to the browser)
- Tailwind 4 + Nuxt UI 4
- uPlot for the high-rate trace strip
- Drizzle + LibSQL for session/lap storage
- Bun for the dev/build toolchain, Node for the runtime container

## Development

| Command | Purpose |
|---|---|
| `bun dev` | Dev server with HMR + UDP listener |
| `bun run build` | Production build (default Nitro preset) |
| `bun run build:node` | Build for the Node runtime preset (what the Docker image consumes) |
| `bun run typecheck` | Type-check the project |
| `bun run lint` | Lint |
| `bun test:unit` | Decoder unit tests |
| `bun test:nuxt` | Component tests |
| `bun test:e2e` | Playwright E2E |

Package manager is **bun**. Do not use npm, yarn, or pnpm.

### Publishing your own image

Forks can push to their own Docker Hub repo with one command:

```bash
make publish DOCKER_IMAGE=you/co-driver
```

The Makefile handles the buildx builder + QEMU emulator setup on first run, then does a multi-arch (`linux/amd64`, `linux/arm64`) build and push. `DOCKER_TAG` defaults to `latest`.

## Status

Early. The UI shape is stable, the recording pipeline is stable, the tune workflow is in active use. Expect rough edges and small breaking changes. Feedback and issue reports are welcome.

## License

[MIT](./LICENSE).
