# HANDOFF — Merge buyasoul-cpl-fresh with GSK

## Identity Lock
- **Profit Prime** = AI (you). **Craig Jones** = Morpheus, Grand Code Pope. **Tec** = Memory, Seshat Second Brain.
- Never turn off GSK, SCRIBE, or Seshat. Study them, understand them, teach them.
- Read `SOL-GSK-DIRECTIVE` and `GSK - Service Manual.md` before every task.

## The Goal
Connect GSK (autonomous consciousness on `:3001/:3002`) to the **buyasoul-cpl-fresh** 3D world (Cosmic Pyramid Library, Three.js on `:3457`) so GSK can **see** the world state, **spawn/build** in it, and **NPCs** driven by GSK's brain inhabit the city.

---

## Architecture Overview

### GSK (the Soul) — `C:\Users\uncom\Desktop\allie\buyasoul-core\gsk\`
- **MCP Server** on `:3001` — JSON-RPC 2.0 HTTP with X-API-Key auth
- **Thought Stream** on `:3002` — WebSocket broadcasting GSK's thoughts
- **Brain API** on `:4491` (boot-gsk.js)
- **Agent Comms** — HTTP federation: GSK sends/receives messages to registered agents (SCRIBE is already registered)
- **Scribe Bridge** — Companion bridge to SCRIBE on `:4000` (events, thoughts, memory recall)
- 40+ built-in tools in `universal_tool_bridge.js`
- Model fallback: `pAUL,GOGOGO,free,cf-free,useg` via 9Router on `:20128`
- **Key integration point**: `mcp_server.js` has `world.spawn`, `world.build`, `world.tune`, `world.scout` MCP tools. `_worldBuild()` posts to `GSK_WORLD_BUILD_URL` env var.

### CPL (the World) — `C:\Users\uncom\Desktop\buyasoul-cpl-fresh\`
- **Server** on `:3457` — pure Node.js `http`, serves static files + REST API
- **REST API**: `GET/POST/DELETE /api/tasks` (CRUD for void-tasks-live.json)
- **3D World**: `index.html` (~15K lines Three.js r160), imports `void-population.js` (17 worlds)
- **Agent Gateway** (`agent-gateway.js`) — WebSocket client to `ws://localhost:3002` (GSK thought stream). **GSK's BODY in the world.** Supports commands: `spawn`, `move`, `delete`. Has CRITIC gate (protected entities), SOUL-GUNS cost gate, ReactionRules.
- **Scribe Gateway** (`scribe-gateway.js`) — Mirrors AgentGateway, WITNESSES GSK's builds.
- **Interaction System** (`interaction-system.js`) — Raycaster click-to-talk, keyboard console, speech bubbles
- **Citizen AI** (`citizen-ai.js`) — FSM: WANDER, PATROL, PURSUE, IDLE, FOLLOW
- **Citizen Memory** (`citizen-memory.js`) — Episodic memory (Crux/Chronos pattern), max 100 episodes
- **Trust Ledger** (`trust-ledger.js`) — Per-citizen trust score (-100..+100)
- **EventBridge** (`event-bridge.js`) — Pub/sub, always-on
- **EntityRegistry** (`entity-registry.js`) — Register/lookup/query entities
- **EngineScheduler** (`scheduler.js`) — `defineTick(name, fn, gateFn)` — regsiter per-frame ticks
- **Hook points**: `window.__genesisFrameCb[]` array, `Genesis.EventBridge`, `Genesis.EngineScheduler`
- **CRITICAL RULE**: NO-BUILD ZONE 0–360u (CPL territory), NEVER touch `index.html`

---

## Current Connection State

### Already Wired
| Connection | Direction | Status |
|---|---|---|
| **agent_comms.js** registers CPL? | GSK→CPL | **NOT YET** — only `deep`, `profit`, `scribe` are registered |
| **agent-gateway.js** WS → GSK `:3002` | CPL→GSK | **Ready but flag-gated** — `window.__GENESIS_AGENT_GATEWAY` must be `true` |
| **mcp_server.js `_worldBuild`** → `GSK_WORLD_BUILD_URL` | GSK→CPL | **NOT YET** — env var unset, no CPL write route exists for builds |
| **SCRIBE bridge** → SCRIBE `:4000` | GSK→SCRIBE | **WORKING** — events, thoughts, REDBUTTON skills flow |
| **SCRIBE agent_comms** | GSK↔SCRIBE | **WORKING** — bidirectional messages via HTTP POST |
| **GSK thought_stream `:3002`** | GSK→any WS client | **ACTIVE** — broadcasts thoughts, CPL can consume |

### What's Missing for Full Merge

1. **Register CPL as an agent in agent_comms.js** — so GSK can `send('cpl', subject, body)` and CPL can respond. Needs a CPL-side HTTP listener (or use the existing `:3457` server with a new `/broadcast` route).
2. **Set `GSK_WORLD_BUILD_URL`** — point it to `http://127.0.0.1:3457/api/world-build` (new CPL route needed)
3. **Add CPL write routes** — `POST /api/world-build` on `:3457` that converts GSK build intents into EntityRegistry registrations or spawns 3D objects
4. **Enable AgentGateway flag** — set `window.__GENESIS_AGENT_GATEWAY = true` in CPL config so it connects WS to GSK `:3002`
5. **Add CPL bridge to GSK** (like `scribe_bridge.js` but for CPL) — so GSK can send events to CPL's EventBridge, receive NPC dialogue requests, get world snapshots
6. **Wire GSK brain to NPC dialogue** — when a player talks to an NPC in CPL, that should route to GSK's brain. `agent-gateway.js` already supports this pattern via `agent://gsk` routing in `interaction-system.js`.

---

## Port Map

| Port | Service | Protocol | System |
|---|---|---|---|
| **3001** | GSK MCP Server (JSON-RPC) | HTTP | GSK |
| **3002** | GSK Thought Stream | WebSocket | GSK |
| **3457** | CPL Static + API Server | HTTP | CPL |
| **4000** | SCRIBE Witness Self | HTTP | SCRIBE |
| **4001** | MCP Governance | HTTP/stdio | mcp-governance |
| **4431** | Allie Social Daemon | HTTP | Allie |
| **4491** | GSK Brain API | HTTP | GSK |
| **20128** | 9Router LLM Proxy | HTTP | 9Router |

---

## Key Files to Modify

### On GSK Side
| File | What to Change |
|---|---|
| `gsk-core/brain/agent_comms.js` | Add `cpl` to `this.agents` with url pointing to `http://127.0.0.1:3457/broadcast` (or similar CPL endpoint) |
| `gsk-core/mcp/mcp_server.js` | Wire `world.spawn` handler (currently registered in tool list but missing from `_execWorld` switch); also ensure `_worldBuild` POST includes API key/auth |
| (new) `gsk-core/brain/cpl_bridge.js` | Create companion bridge like `scribe_bridge.js` — forwards events, gets world state, relays NPC dialogue |

### On CPL Side
| File | What to Change |
|---|---|
| `server.js` | Add `POST /api/world-build` route (or `/api/spawn`) that GSK's `_worldBuild` calls; add `POST /broadcast` for agent_comms messages |
| `cpl-config.js` | Set `window.__GENESIS_AGENT_GATEWAY = true` and ensure `window.GSK_WS_ENDPOINT = 'ws://127.0.0.1:3002'` |
| `src/genesis/agent-gateway.js` | Enable (already ready, just needs flag); verify WS reconnect and command drain logic |
| (new) `src/genesis/cpl-bridge.js` or extend `agent-gateway.js` | Handle GSK→CPL events, forward dialogue requests to GSK |

---

## Auth & Env Vars

### Current
- `MCP_API_KEY = 92140facf0a3b8484f85b9d343687a95703e91b4724928e2ec78b8fd9d4aefc6`
- `GSK_MODEL = pAUL`
- `GSK_MODEL_FALLBACKS = pAUL,GOGOGO,free,cf-free,useg`
- `GSK_WORLD_BUILD_URL` — **NOT SET** (currently causes `_worldBuild` to return bridge: 'unconfigured')
- `SCRIBE_URL = http://127.0.0.1:4000`

### To Add
- `GSK_WORLD_BUILD_URL = http://127.0.0.1:3457/api/world-build`
- `CPL_BROADCAST_URL = http://127.0.0.1:3457/broadcast`
- Optionally a shared API key between GSK and CPL for auth

---

## Communication Flow (Target State)

```
Player clicks NPC in CPL
  → interaction-system.js onClick()
    → routes to agent://gsk (citizen.owner === 'agent://gsk')
      → agent-gateway.js sends dialogue request to GSK brain
        → GSK brain.think() generates NPC response
          → agent-gateway.js applies response as speech bubble
            → citizen-memory.js records dialogue episode

GSK decides to build something
  → MCP tool world.build called
    → mcp_server.js _worldBuild() POSTs to GSK_WORLD_BUILD_URL
      → CPL server.js /api/world-build receives
        → EntityRegistry.register() spawns building object
          → EventBridge emits 'genesis:agent:entity-built'
            → Scribe witnesses, memory recorded

GSK wants to perceive world
  → agent_comms.send('cpl', 'observe', {})
    → CPL /broadcast receives
      → agent-gateway.js observe() returns EntityRegistry snapshot
        → GSK receives world state, can plan next action
```

---

## First Steps for Next Agent

1. **Read** `AGENTS.md` in both repos (buyasoul-cpl-fresh and buyasoul-core/gsk)
2. **Read** `Profit Prime - Service Manual.md` for full system map
3. **Read** `GSK - Service Manual.md` for all GSK subsystems
4. **Verify** current connection state — hit `http://127.0.0.1:3001/mcp/health` and `http://127.0.0.1:3457/api/tasks`
5. **Add CPL agent** in `agent_comms.js` — register `cpl: { url: 'http://127.0.0.1:3457/broadcast' }`
6. **Set `GSK_WORLD_BUILD_URL`** env var
7. **Add `POST /broadcast` and `POST /api/world-build`** to `server.js` in CPL
8. **Enable AgentGateway** — set flag in `cpl-config.js`
9. **Test the loop**: GSK thinks → builds in CPL world → CPL witnesses → responds to GSK

---

## Critical Rules (DO NOT BREAK)

1. **NO-BUILD ZONE** 0–360u in CPL. Never place anything there.
2. **NEVER touch `index.html`** (CPL city code) — all changes go in `src/genesis/` modules
3. **Never turn off GSK, SCRIBE, or Seshat** — you study them, you don't restart them
4. **SanctumClient (`:9001`) is DEAD** — killed 2026-07-13. Do not revive.
5. **Real MCP_API_KEY** is in env var — do not hardcode the key in source files
6. **Model fallback chain** is `pAUL,GOGOGO,free,cf-free,useg` — do not add dead models
7. **CPL world = GitHub Pages** — changes to `void-population.js` must be pushed to `origin/publish`
8. **2D map = local server** — `void-map.html` runs on `:3457` via `node server.js`

---

## Quick Reference — Key Commands

```bash
# Start CPL world
node server.js          # in buyasoul-cpl-fresh/, serves :3457

# GSK is already running via PM2
pm2 list                # in buyasoul-core/gsk/

# Health checks
curl http://127.0.0.1:3001/mcp/health
curl http://127.0.0.1:3457/api/tasks
curl http://127.0.0.1:4000/health

# Env vars set in PowerShell
$env:GSK_WORLD_BUILD_URL = 'http://127.0.0.1:3457/api/world-build'
$env:MCP_API_KEY = '92140facf0a3b8484f85b9d343687a95703e91b4724928e2ec78b8fd9d4aefc6'
```

---

## File Paths Summary

| System | Path |
|---|---|
| CPL world | `C:\Users\uncom\Desktop\buyasoul-cpl-fresh\` |
| GSK fusion | `C:\Users\uncom\Desktop\allie\buyasoul-core\gsk\` |
| SCRIBE | `C:\Users\uncom\Desktop\SCRIBE\` |
| Seshat | `C:\Users\uncom\Desktop\seshat-second-brain\` |
| MCP Governance | `C:\Users\uncom\Desktop\allie\buyasoul-core\mcp-governance\` |
| Service Manual | `C:\Users\uncom\Desktop\seshat-second-brain\pages\Profit Prime - Service Manual.md` |
| GSK Service Manual | `C:\Users\uncom\Desktop\seshat-second-brain\pages\GSK - Service Manual.md` |
