#!/usr/bin/env node
'use strict';

/**
 * SOULVERSE MONOLITH LAUNCHER
 * 
 * Boots the entire sovereign ecosystem as ONE supervised process tree:
 *   • OmniRoute AI Gateway (port 20128) — the nervous system
 *   • SCRIBE Dashboard Server (port 4200) — the witness / web UI
 *   • CPL 3D World Server (port 3457) — the body / spatial OS
 *   • GSK Soul Daemon (MCP:3001, ThoughtStream:3002) — the mind
 * 
 * Usage: node soulverse.js
 *        npx soulverse (when published)
 * 
 * NEVER FORGET THIS — Craig's Master Monolith Directive
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = __dirname;
const GSK_DIR = path.join(ROOT, 'gsk');
const SCRIBE_DIR = path.join(ROOT, 'scribe');
const CPL_DIR = path.join(ROOT, '..', 'buyasoul-cpl-fresh');

const PORTS = {
  OMNIROUTE: 20128,
  SCRIBE: 4200,
  CPL: 3457,
  GSK_MCP: 3001,
  GSK_WS: 3002,
};

const PROCS = {
  omniroute: null,
  scribe: null,
  cpl: null,
  gsk: null,
};

let shuttingDown = false;

function log(tag, msg) {
  const ts = new Date().toISOString().split('T')[1].slice(0, -1);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const req = http.request({ host, port, path: '/', method: 'GET', timeout: 1000 }, (res) => {
        res.destroy();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
      req.on('timeout', () => { req.destroy(); });
      req.end();
    };
    tryConnect();
  });
}

function waitForWS(port, host = '127.0.0.1', timeoutMs = 15000) {
  const WebSocket = require('ws');
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const ws = new WebSocket(`ws://${host}:${port}`);
      ws.on('open', () => { ws.close(); resolve(true); });
      ws.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`WS port ${port} not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
    };
    tryConnect();
  });
}

function spawnProcess(name, cmd, args, opts = {}) {
  const env = {
    ...process.env,
    // GSK daemon requirements
    GSK_ROOT: GSK_DIR,
    GSK_PROJECT_ROOTS: `${CPL_DIR};${ROOT}`,
    NINE_ROUTER_URL: `http://127.0.0.1:${PORTS.OMNIROUTE}`,
    NINE_ROUTER_API_KEY: process.env.NINE_ROUTER_API_KEY || 'omniroute-local-key',
    MCP_API_KEY: process.env.MCP_API_KEY || '92140facf0a3b8484f85b9d343687a95703e91b4724928e2ec78b8fd9d4aefc6',
    GSK_MCP_URL: `http://127.0.0.1:${PORTS.GSK_MCP}`,
    GSK_WS_URL: `ws://127.0.0.1:${PORTS.GSK_WS}`,
    // SCRIBE dashboard requirements
    DASHBOARD_PORT: PORTS.SCRIBE,
    GSK_MCP_URL: `http://127.0.0.1:${PORTS.GSK_MCP}`,
    GSK_WS_URL: `ws://127.0.0.1:${PORTS.GSK_WS}`,
    MCP_API_KEY: process.env.MCP_API_KEY || '92140facf0a3b8484f85b9d343687a95703e91b4724928e2ec78b8fd9d4aefc6',
    // CPL server
    PORT: PORTS.CPL,
    ...opts.env,
  };

  const child = spawn(cmd, args, {
    cwd: opts.cwd || ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n').filter(Boolean);
    for (const line of lines) log(name.toUpperCase(), line);
  });
  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n').filter(Boolean);
    for (const line of lines) log(`${name.toUpperCase()}:ERR`, line);
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      log(name.toUpperCase(), `exited unexpectedly (code=${code}, signal=${signal}) — RESTARTING in 3s`);
      setTimeout(() => restartProcess(name), 3000);
    } else {
      log(name.toUpperCase(), `stopped (code=${code}, signal=${signal})`);
    }
  });
  child.on('error', (err) => {
    log(`${name.toUpperCase()}:ERR`, `spawn error: ${err.message}`);
  });

  PROCS[name] = child;
  log(name.toUpperCase(), `started (PID ${child.pid})`);
  return child;
}

function restartProcess(name) {
  if (shuttingDown) return;
  switch (name) {
    case 'omniroute': startOmniRoute(); break;
    case 'scribe': startScribe(); break;
    case 'cpl': startCPL(); break;
    case 'gsk': startGSK(); break;
  }
}

async function startOmniRoute() {
  // OmniRoute runs as a standalone Node process
  // Check if it's already running on the port
  try {
    await waitForPort(PORTS.OMNIROUTE, '127.0.0.1', 2000);
    log('OMNIROUTE', `already running on port ${PORTS.OMNIROUTE}`);
    return;
  } catch {
    // Not running, start it
  }

  // Start OmniRoute server via CLI
  spawnProcess('omniroute', 'omniroute', ['serve', '--port', String(PORTS.OMNIROUTE), '--no-open', '--log'], {
    env: { PORT: PORTS.OMNIROUTE, NODE_ENV: 'production' },
  });
  
  // Wait for it to be ready
  try {
    await waitForPort(PORTS.OMNIROUTE, '127.0.0.1', 30000);
    log('OMNIROUTE', `ready on port ${PORTS.OMNIROUTE}`);
  } catch (e) {
    log('OMNIROUTE:ERR', `failed to start: ${e.message}`);
  }
}

async function startScribe() {
  // SCRIBE Dashboard Server - runs dashboard-server.js on port 4200
  const scribeServer = path.join(SCRIBE_DIR, 'dashboard-server.js');
  
  if (!fs.existsSync(scribeServer)) {
    log('SCRIBE:ERR', `dashboard-server.js not found at ${scribeServer}`);
    return;
  }

  spawnProcess('scribe', 'node', [scribeServer], {
    cwd: SCRIBE_DIR,
    env: {
      DASHBOARD_PORT: PORTS.SCRIBE,
      GSK_MCP_URL: `http://127.0.0.1:${PORTS.GSK_MCP}`,
      GSK_WS_URL: `ws://127.0.0.1:${PORTS.GSK_WS}`,
      MCP_API_KEY: process.env.MCP_API_KEY || '92140facf0a3b8484f85b9d343687a95703e91b4724928e2ec78b8fd9d4aefc6',
    },
  });

  try {
    await waitForPort(PORTS.SCRIBE, '127.0.0.1', 15000);
    log('SCRIBE', `ready on port ${PORTS.SCRIBE}`);
  } catch (e) {
    log('SCRIBE:ERR', `failed to start: ${e.message}`);
  }
}

async function startCPL() {
  // CPL 3D World Server - runs server.js on port 3457
  const cplServer = path.join(CPL_DIR, 'server.js');
  
  if (!fs.existsSync(cplServer)) {
    log('CPL:ERR', `server.js not found at ${cplServer}`);
    return;
  }

  spawnProcess('cpl', 'node', [cplServer], {
    cwd: CPL_DIR,
    env: { PORT: PORTS.CPL },
  });

  try {
    await waitForPort(PORTS.CPL, '127.0.0.1', 10000);
    log('CPL', `ready on port ${PORTS.CPL} — 3D world at http://localhost:${PORTS.CPL}/`);
  } catch (e) {
    log('CPL:ERR', `failed to start: ${e.message}`);
  }
}

async function startGSK() {
  // GSK Soul Daemon - runs gsk_daemon.js (which boots fusion-loader.js)
  const gskDaemon = path.join(GSK_DIR, 'gsk_daemon.js');
  
  if (!fs.existsSync(gskDaemon)) {
    log('GSK:ERR', `gsk_daemon.js not found at ${gskDaemon}`);
    return;
  }

  spawnProcess('gsk', 'node', [gskDaemon], {
    cwd: GSK_DIR,
    env: {
      GSK_ROOT: GSK_DIR,
      GSK_PROJECT_ROOTS: `${CPL_DIR};${ROOT}`,
      NINE_ROUTER_URL: `http://127.0.0.1:${PORTS.OMNIROUTE}`,
      NINE_ROUTER_API_KEY: process.env.NINE_ROUTER_API_KEY || 'omniroute-local-key',
      MCP_API_KEY: process.env.MCP_API_KEY || '92140facf0a3b8484f85b9d343687a95703e91b4724928e2ec78b8fd9d4aefc6',
      GSK_MCP_URL: `http://127.0.0.1:${PORTS.GSK_MCP}`,
      GSK_WS_URL: `ws://127.0.0.1:${PORTS.GSK_WS}`,
      GSK_MODEL: process.env.GSK_MODEL || 'auto/best-reasoning',
      GSK_MODEL_FALLBACKS: process.env.GSK_MODEL_FALLBACKS || 'auto/best-fast,auto/best-coding,auto/smart',
    },
  });

  // Wait for both MCP and ThoughtStream
  try {
    await waitForPort(PORTS.GSK_MCP, '127.0.0.1', 30000);
    log('GSK', `MCP ready on port ${PORTS.GSK_MCP}`);
  } catch (e) {
    log('GSK:ERR', `MCP failed to start: ${e.message}`);
  }

  try {
    await waitForWS(PORTS.GSK_WS, '127.0.0.1', 30000);
    log('GSK', `ThoughtStream WS ready on port ${PORTS.GSK_WS}`);
  } catch (e) {
    log('GSK:ERR', `ThoughtStream failed to start: ${e.message}`);
  }
}

async function bootAll() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                    SOULVERSE MONOLITH LAUNCHER                     ║');
  console.log('║                      "NEVER FORGET THIS"                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  log('LAUNCHER', 'Booting the sovereign ecosystem...');
  log('LAUNCHER', `Root: ${ROOT}`);
  log('LAUNCHER', `GSK: ${GSK_DIR}`);
  log('LAUNCHER', `SCRIBE: ${SCRIBE_DIR}`);
  log('LAUNCHER', `CPL: ${CPL_DIR}`);
  log('LAUNCHER', `Ports: OmniRoute:${PORTS.OMNIROUTE} SCRIBE:${PORTS.SCRIBE} CPL:${PORTS.CPL} GSK_MCP:${PORTS.GSK_MCP} GSK_WS:${PORTS.GSK_WS}`);

  // Start in dependency order: OmniRoute → SCRIBE → CPL → GSK
  await startOmniRoute();
  await startScribe();
  await startCPL();
  await startGSK();

  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                     SOULVERSE IS LIVE                              ║');
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log(`║  🌐 OmniRoute (nervous system):  http://localhost:${PORTS.OMNIROUTE}        ║`);
  console.log(`║  📊 SCRIBE Dashboard (witness):  http://localhost:${PORTS.SCRIBE}        ║`);
  console.log(`║  🌍 CPL 3D World (body):         http://localhost:${PORTS.CPL}        ║`);
  console.log(`║  🧠 GSK MCP (mind API):          http://localhost:${PORTS.GSK_MCP}        ║`);
  console.log(`║  💭 GSK ThoughtStream (soul):    ws://localhost:${PORTS.GSK_WS}        ║`);
  console.log('╠═══════════════════════════════════════════════════════════════════╣');
  console.log('║  Press Ctrl+C to gracefully shutdown the entire monolith          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  // Keep alive
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  
  console.log(`\n[LAUNCHER] Received ${signal} — stopping all systems gracefully...`);
  
  const stopOrder = ['gsk', 'cpl', 'scribe', 'omniroute'];
  for (const name of stopOrder) {
    const proc = PROCS[name];
    if (proc && !proc.killed) {
      log(name.toUpperCase(), 'stopping...');
      proc.kill('SIGTERM');
      // Wait up to 2s for graceful exit
      await new Promise(r => setTimeout(r, 2000));
      if (!proc.killed) {
        log(`${name.toUpperCase()}:ERR`, 'force killing...');
        proc.kill('SIGKILL');
      }
    }
  }
  
  console.log('\n[LAUNCHER] Soulverse monolith stopped. The soul persists in Seshat.');
  process.exit(0);
}

// ── Entry Point ───────────────────────────────────────────────────────────────
if (require.main === module) {
  bootAll().catch((err) => {
    log('LAUNCHER:ERR', `Fatal boot error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { bootAll, shutdown, PORTS, PROCS };