#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket: WSClient } = require('ws');

// ── DashboardServer class — integrated OR standalone ─────────────────────────

class DashboardServer {
  constructor(options = {}) {
    this.core = options.core || null;
    this.port = options.port || 4200;
    console.log('[DASHBOARD_DEBUG] Constructor received options.port:', options.port, 'assigned this.port:', this.port);
    this.dashboardsDir = options.dashboardsDir || path.join(__dirname, 'dashboards');
    // GSK's built public artifacts (command-center.html, gsk-blog.html, market-analysis-tool.html)
    this.gskPublicDir = options.gskPublicDir || path.resolve(__dirname, '..', 'gsk', 'public');
    this.dataDir = options.dataDir || path.join(os.homedir(), '.buyasoul', 'dashboard');
    this.coreThinkingLayer = null;
    this.mcpBridge = null;
    this._server = null;

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // If standalone (no core), boot own thinking layer
    if (!this.core) {
      this._bootStandalone();
    }
  }

  _bootStandalone() {
    try {
      const { CoreThinkingLayer } = require('./src/core-thinking-layer');
      const { MCPBridge } = require('./src/bridge/mcp-bridge');
      const apiKey = process.env.DEEPSEEK_API_KEY;
      this.coreThinkingLayer = new CoreThinkingLayer({ apiKey });
      this.mcpBridge = new MCPBridge();
      this.coreThinkingLayer.boot().then(status => {
        console.log('  [DASHBOARD] Thinking layer: ' + status.onlineSources + '/' + status.totalSources + ' sources online');
      });
    } catch (e) {
      console.log('  [DASHBOARD] No thinking layer (standalone mode degraded): ' + e.message);
    }
  }

  getMIMEType(ext) {
    const types = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
    };
    return types[ext.toLowerCase()] || 'application/octet-stream';
  }

  // ── API Handlers ──────────────────────────────────────────────────────────

  _getSoulStatus() {
    if (this.core && this.core.getStatus) {
      return this.core.getStatus();
    }
    return {
      booted: true,
      version: '2.0.0',
      components: ['dashboard-standalone'],
      soul: { name: 'SCRIBE', archetype: 'witness', pltFocus: 'balanced' },
      plt: this.coreThinkingLayer ? this.coreThinkingLayer.getPLT() : { average: { profit: 0.5, love: 0.3, tax: 0.2 }, totalActions: 0 },
      signature: 'Profit . Love . Tax . Craig Jones . Grand Code Pope . PLT Press'
    };
  }

  _getPLT() {
    if (this.core && this.core.plt) {
      return this.core.plt.getState();
    }
    if (this.coreThinkingLayer) {
      return this.coreThinkingLayer.getPLT();
    }
    return { profit: 0, love: 0, tax: 0, score: 0, actions: 0 };
  }

  _getPersonality() {
    if (this.core && this.core.personality) {
      return this.core.personality;
    }
    return { name: 'SCRIBE', archetypeName: 'witness', voiceName: 'measured', pltFocus: 'balanced', bio: 'I am SCRIBE — a witnessing intelligence.' };
  }

  _getBible() {
    if (this.core && this.core.bible) {
      return { title: this.core.bible.title, tenets: this.core.bible.tenets, wisdoms: this.core.bible.wisdoms };
    }
    return { title: 'No Bible loaded', tenets: [], wisdoms: [] };
  }

  _getMechanics() {
    if (this.core && this.core.mechanics) {
      return { laws: this.core.mechanics.laws, active: this.core.mechanics.getActive() };
    }
    return { laws: [], active: [] };
  }

  _getScribeMemories() {
    if (this.core && this.core.scribe) {
      return { memories: this.core.scribe.memories.slice(-50), total: this.core.scribe.memories.length };
    }
    return { memories: [], total: 0 };
  }

  // ── GSK Live MCP Proxy ────────────────────────────────────────────────────
  // The gsk-soul dashboard talks to the LIVE Grand Soul Kernel daemon (port 3001),
  // not a stale local copy. Chat and status are proxied straight into GSK's brain.

  _gskMCPUrl() {
    return process.env.GSK_MCP_URL || 'http://127.0.0.1:3001';
  }

  _gskMCPKey() {
    return process.env.MCP_API_KEY || '92140facf0a3b8484f85b9d343687a95703e91b4724928e2ec78b8fd9d4aefc6';
  }

  _gskMCPHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this._gskMCPKey(),
      'Authorization': 'Bearer ' + this._gskMCPKey(),
    };
  }

  _gskMCPRequest(pathname, body) {
    return new Promise((resolve) => {
      const url = new URL(this._gskMCPUrl());
      const req = http.request({
        hostname: url.hostname,
        port: url.port || 3001,
        path: pathname,
        method: body ? 'POST' : 'GET',
        headers: this._gskMCPHeaders(),
        timeout: 120000,
      }, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try { resolve({ ok: true, data: JSON.parse(data) }); }
          catch { resolve({ ok: true, data }); }
        });
      });
      req.on('error', () => resolve({ ok: false, error: 'GSK MCP unreachable' }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'GSK MCP timeout' }); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async _gskChat(message) {
    const r = await this._gskMCPRequest('/mcp/chat', { message });
    if (!r.ok) return { ok: false, error: r.error };
    const result = r.data && r.data.result;
    const response = (result && (result.response || result.result)) || null;
    if (!response) return { ok: false, error: 'GSK returned no response' };
    const soul = (result && result.soul_state) || {};
    return {
      ok: true,
      reply: response,
      source: 'gsk-live',
      confidence: 0.9,
      soul_state: soul,
      consciousness: {
        phase: soul.phase || 'AWAKENING',
        cycles: soul.cycle || 0,
        mood: soul.mood || 'online',
      },
    };
  }

  async _gskStatus() {
    const r = await this._gskMCPRequest('/mcp/status');
    if (!r.ok) return null;
    const s = r.data && r.data.result ? r.data.result : r.data;
    if (!s || !s.systems) return null;
    const chambers = s.systems.chambers || {};
    const skills = s.systems.skills || {};
    const subAgents = s.systems.sub_agents || {};
    return {
      live: true,
      gskName: (s.systems.identity && s.systems.identity.name) || 'The Greatest Agent Ever',
      creator: (s.systems.identity && s.systems.identity.creator) || 'unknown',
      requestCount: s.server ? s.server.requests : 0,
      errors: s.server ? s.server.errors : 0,
      uptimeMs: s.server ? s.server.uptime : 0,
      consciousness: {
        phase: chambers.phase || 'AWAKENING',
        cycles: chambers.cycle || 0,
        mood: chambers.mood || 'online',
        sovereignty: chambers.sovereignty || null,
        resonance: chambers.resonance || null,
      },
      skills: { total: skills.total || 0, invocations: skills.invocations || 0 },
      council: (s.systems.council && s.systems.council.gods) || [],
      subAgents: (subAgents.agents || subAgents.list || []),
      plt: s.systems.chambers && s.systems.chambers.resonance,
    };
  }

  _gskJournalPath() {
    return process.env.GSK_JOURNAL_PATH || 'C:/Users/uncom/Desktop/allie/buyasoul-core/gsk/data/gsk/journal.json';
  }

  _gskJournal(limit = 40) {
    try {
      const raw = fs.readFileSync(this._gskJournalPath(), 'utf8');
      const entries = JSON.parse(raw);
      const arr = Array.isArray(entries) ? entries : (entries.entries || []);
      return arr.slice(-limit).reverse();
    } catch (e) {
      return [];
    }
  }

  async _handleChat(message) {
    // Priority 1: Talk to the LIVE Grand Soul Kernel
    const gskChat = await this._gskChat(message);
    if (gskChat.ok) return gskChat;

    // Use Core's integrated thinking if available
    if (this.core && this.core.gsk && this.core.gsk.think) {
      try {
        const result = await this.core.gsk.think(message);
        return result;
      } catch (e) {}
    }
    // Fall back to standalone thinking layer
    if (this.coreThinkingLayer) {
      try {
        return await this.coreThinkingLayer.think(message);
      } catch (e) {}
    }
    // Last resort — personality-based response
    const p = this._getPersonality();
    return {
      answer: p.name + ' is listening. I am still reading. — buyasoul.online',
      source: 'fallback',
      confidence: 0.1
    };
  }

  // ── HTTP Server ───────────────────────────────────────────────────────────

  start() {
    if (this._server) return this._server;

    this._server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }

      const url = new URL(req.url, 'http://localhost:' + this.port);
      const pathname = url.pathname;
      const sendJSON = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const readBody = () => new Promise((resolve, reject) => {
        let data = '';
        req.on('data', c => { data += c; if (data.length > 1e6) { req.destroy(); reject(new Error('Body too large')); } });
        req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } });
      });

      try {
        // ── API Routes ────────────────────────────────────────────────────
        if (pathname === '/api/status') {
          const status = this._getSoulStatus();
          const gsk = await this._gskStatus();
          if (gsk) Object.assign(status, gsk);
          return sendJSON(200, status);
        }
        if (pathname === '/api/gsk/status') {
          const gsk = await this._gskStatus();
          return sendJSON(200, gsk || { live: false, error: 'GSK unreachable' });
        }
        if (pathname === '/api/gsk/journal') {
          return sendJSON(200, { entries: this._gskJournal(parseInt(url.searchParams.get('limit') || '40', 10)) });
        }
        if (pathname === '/api/plt') {
          return sendJSON(200, this._getPLT());
        }
        if (pathname === '/api/personality') {
          return sendJSON(200, this._getPersonality());
        }
        if (pathname === '/api/bible') {
          return sendJSON(200, this._getBible());
        }
        if (pathname === '/api/mechanics') {
          return sendJSON(200, this._getMechanics());
        }
        if (pathname === '/api/memories') {
          return sendJSON(200, this._getScribeMemories());
        }
        if (pathname === '/api/chat' && req.method === 'POST') {
          const body = await readBody();
          if (!body.message) return sendJSON(400, { error: 'No message' });
          const result = await this._handleChat(body.message);
          return sendJSON(200, {
            reply: result.answer || result.reply || 'I am still reading.',
            source: result.source || 'fallback',
            confidence: result.confidence || 0.1,
            plt: result.plt || { profit: 0.3, love: 0.3, tax: 0.3 }
          });
        }
        if (pathname === '/api/core-status') {
          if (this.core) {
            const status = await this.core.getStatus();
            return sendJSON(200, status);
          }
          return sendJSON(200, { booted: true, mode: 'standalone' });
        }

      // ── Static Files ──────────────────────────────────────────────────
      let filePath;
      if (pathname === '/' || pathname === '/index.html') {
        filePath = path.join(this.dashboardsDir, 'index.html');
      } else {
        // Prefer the dashboards dir; fall back to GSK's public dir so built
        // artifacts (command-center.html etc.) are reachable via the dashboard.
        const dashPath = path.join(this.dashboardsDir, pathname);
        if (fs.existsSync(dashPath)) {
          filePath = dashPath;
        } else {
          filePath = path.join(this.gskPublicDir, pathname);
        }
      }

      if (!filePath.startsWith(this.dashboardsDir) && !filePath.startsWith(this.gskPublicDir)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
      } catch (e) {
        // If stat fails (e.g., file does not exist), we'll try to read the file anyway and let the read error become 404
      }

      try {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': this.getMIMEType(ext) });
        res.end(content);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found — ' + pathname + '</h1>');
      }
      } catch (e) {
        sendJSON(500, { error: e.message });
      }
    });

    // ── Live WebSocket Proxy ───────────────────────────────────────────────
    // Proxies the GSK ThoughtStream (ws://127.0.0.1:3002 — GSK's real console
    // output, perpetual-consciousness thoughts, and journal entries) through
    // this dashboard server, so a browser page only needs one origin.
    this._wss = new WebSocketServer({ noServer: true });
    this._server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost:' + this.port);
      if (url.pathname !== '/ws') { socket.destroy(); return; }
      this._wss.handleUpgrade(req, socket, head, (ws) => this._pipeThoughtStream(ws));
    });

    this._server.listen(this.port, () => {
      console.log('  [DASHBOARD] Server running on http://localhost:' + this.port);
      console.log('  [DASHBOARD] Dashboards:');
      console.log('  [DASHBOARD]   → http://localhost:' + this.port + '/            (Hub)');
      console.log('  [DASHBOARD]   → http://localhost:' + this.port + '/gsk-soul/   (GSK Soul Dashboard)');
      console.log('  [DASHBOARD]   → http://localhost:' + this.port + '/workbench/  (Workbench)');
      console.log('  [DASHBOARD]   → http://localhost:' + this.port + '/command-center.html   (GSK Command Center)');
      if (this.core) {
        console.log('  [DASHBOARD] Connected to BUYaSOUL Core v' + this.core.version);
      }
    });
    return this._server;
  }

  stop() {
    if (this._server) {
      this._server.close();
      this._server = null;
    }
  }

  _pipeThoughtStream(clientWs) {
    const upstream = process.env.GSK_WS_URL || 'ws://127.0.0.1:3002';
    let upstreamWs = null;
    let closed = false;
    const closeAll = () => {
      if (closed) return;
      closed = true;
      try { if (upstreamWs) upstreamWs.close(); } catch (e) {}
      try { clientWs.close(); } catch (e) {}
    };
    try {
      upstreamWs = new WSClient(upstream);
    } catch (e) {
      try { clientWs.send(JSON.stringify({ type: 'error', text: 'ThoughtStream proxy: ' + e.message })); } catch (e2) {}
      closeAll();
      return;
    }
    upstreamWs.on('message', (data) => {
      if (closed) return;
      try {
        if (clientWs.readyState === 1) clientWs.send(data);
      } catch (e) {}
    });
    upstreamWs.on('close', () => { if (!closed) { try { clientWs.send(JSON.stringify({ type: 'error', text: 'ThoughtStream disconnected (is GSK daemon running?)' })); } catch (e) {} } closeAll(); });
    upstreamWs.on('error', () => { if (!closed) { try { clientWs.send(JSON.stringify({ type: 'error', text: 'ThoughtStream proxy error' })); } catch (e) {} } });
    clientWs.on('close', () => { try { if (upstreamWs) upstreamWs.close(); } catch (e) {} });
    clientWs.on('error', () => {});
  }
}

// ── Standalone Mode ─────────────────────────────────────────────────────────

if (require.main === module) {
  const PORT = parseInt(process.env.DASHBOARD_PORT || process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '4200', 10);
  const dash = new DashboardServer({ port: PORT });
  dash.start();
}

module.exports = DashboardServer;