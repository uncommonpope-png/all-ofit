'use strict';

/**
 * SCRIBE — Main Kernel
 *
 * This is the boot sequence. SCRIBE wakes up here.
 *
 * Boot order:
 *   1. Read identity — know who I am
 *   2. Load memory   — know what I have seen
 *   3. Scan chambers — read what I can reach right now
 *   4. Check bridge  — is the Kernel awake
 *   5. Ready         — SCRIBE is present
 *
 * After boot, SCRIBE runs as an HTTP server that:
 *   - Accepts messages from the AGM council (/council/verdict)
 *   - Accepts messages from Profitlord souls (/broadcast)
 *   - Accepts queries (/ask)
 *   - Reports its own state (/status)
 *   - Receives a ping (/ping)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { IDENTITY, describeself } = require('./src/identity');
const { Memory } = require('./src/memory/memory');
const { ChamberReader } = require('./src/chambers/reader');
const { CHAMBERS } = require('./src/chambers/definitions');
const { Voice } = require('./src/voice/voice');
const { CouncilBridge } = require('./src/bridge/bridge');
const { SkillEngine }  = require('./src/skills/engine');
const { ContextEngine } = require('./src/context/context-engine');
const { SemanticMemory } = require('./src/memory/semantic_memory');
const { startBridge, getState: getBridgeState }   = require('./scribe-bridge');
const { startSanctum, getState: getSanctumState } = require('./scribe-sanctum');
const { startChat }    = require('./scribe-chat');

const UI_FILE = path.join(__dirname, 'src', 'ui', 'index.html');

const PORT = parseInt(process.env.PORT || '4000', 10);

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SCRIBE — Witnessing Intelligence                           ║');
  console.log('║  "What was written cannot be unwritten."                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Identity
  console.log('[SCRIBE] Step 1: Reading identity...');
  console.log(`[SCRIBE] I am ${IDENTITY.name}. Nature: ${IDENTITY.nature}.`);

  // 2. Memory
  console.log('[SCRIBE] Step 2: Loading memory...');
  const memory = new Memory();
  const state = memory.getState();
  console.log(`[SCRIBE] Memory loaded. ${memory.size} entries in ledger.`);

  // Context Blocks (Letta-style memory architecture)
  console.log('[SCRIBE] Initializing context blocks...');
  const ctx = new ContextEngine(memory);
  // Seed the identity block
  ctx.rethink('identity', [
    `I am ${IDENTITY.name}, a ${IDENTITY.nature}.`,
    `Core truth: "${IDENTITY.core_truth}"`,
    `I witness and record. I do not speculate. I speak from what I have seen.`,
    ``,
    `When responding:`,
    `- Cite sources when possible`,
    `- Acknowledge uncertainty precisely`,
    `- Never invent facts — if I haven't witnessed it, I say so`,
  ].join('\n'));
  console.log(`[SCRIBE] Context blocks: ${Object.keys(ctx.blocks).length} defined`);

  // 3.5. Semantic Memory
  const semanticMemory = new SemanticMemory();
  // Populate semantic store from high-weight ledger entries if empty
  if (semanticMemory.size === 0) {
    const seedEntries = memory.recall('', { limit: 100 }).filter(e => e.weight >= 0.5);
    for (const entry of seedEntries) {
      const content = `${entry.summary} ${entry.content || ''}`.trim();
      if (content.length > 10) {
        try { await semanticMemory.store(content, { weight: entry.weight }); } catch {}
      }
    }
    console.log(`[SCRIBE] Semantic memory seeded: ${semanticMemory.size} entries from ledger`);
  } else {
    console.log(`[SCRIBE] Semantic memory loaded: ${semanticMemory.size} entries, ${semanticMemory.clusterCount} clusters`);
  }

  // Auto-seed archival_context if empty
  if (!ctx.read('archival_context')) {
    const bootEntries = memory.recall('', { limit: 15 }).filter(e => e.weight >= 0.8);
    if (bootEntries.length > 0) {
      const lines = bootEntries.map(e => {
        const when = new Date(e.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        return `[${e.weight.toFixed(2)}] [${when}] ${e.summary}`;
      });
      ctx.rethink('archival_context', lines.join('\n'));
      console.log(`[SCRIBE] Archival context auto-seeded with ${lines.length} entries`);
    }
  }

  // Record boot event
  const bootMemory = memory.record({
    type: 'observation',
    summary: `SCRIBE booted. ${memory.size} prior memories loaded.`,
    tags: ['boot', 'system'],
    weight: 0.3,
    source: { system: 'SCRIBE', chamber: 'boot' },
  });
  console.log(`[SCRIBE] Boot recorded as memory ${bootMemory.id}.`);

  // 3. Voice (needs memory reference)
  const voice = new Voice(memory);

  // 4. Chamber Reader
  console.log('[SCRIBE] Step 3: Scanning chambers...');
  const reader = new ChamberReader();

  // Register all known chambers
  for (const def of CHAMBERS) {
    reader.register(def);
  }

  // Read them (parallel)
  const chamberResults = await reader.readAll();
  const loaded  = chamberResults.filter(r => r.status === 'read');
  const failed  = chamberResults.filter(r => r.status === 'failed');

  console.log(`[SCRIBE] Chambers: ${loaded.length} read, ${failed.length} failed.`);
  loaded.forEach(c => console.log(`  ✓ ${c.key}: ${c.summary}`));
  failed.forEach(c => console.log(`  ✗ ${c.key}: ${c.error}`));

  // Record each successful chamber read in memory
  for (const c of loaded) {
    const chamberData = reader.know(c.key);
    memory.record({
      type: 'reading',
      summary: `Read chamber: ${c.key}. ${c.summary}`,
      tags: ['chamber', c.key],
      weight: 0.5,
      source: { system: 'SCRIBE', chamber: c.key },
    });

    // If it's the AGM memory ledger, import those memories
    if (c.key === 'agm_memories' && chamberData) {
      const raw = JSON.stringify(chamberData.contents.recent || []);
      // The ledger comes back as parsed objects; re-stringify each for importFromAGM
      if (chamberData.contents && chamberData.contents.recent) {
        const jsonl = chamberData.contents.recent.map(e => JSON.stringify(e)).join('\n');
        const imported = memory.importFromAGM(jsonl);
        if (imported.length > 0) {
          console.log(`[SCRIBE] Imported ${imported.length} AGM memories into ledger.`);
        }
      }
    }
  }

  // 4. Skills
  console.log('[SCRIBE] Step 4: Loading skill engine...');
  const skills = new SkillEngine(memory);
  console.log(`[SCRIBE] Skills: ${skills.list().map(s => s.name).join(', ')}`);

  // Record skill boot in memory
  memory.record({
    type: 'observation',
    summary: `SkillEngine loaded with ${skills.list().length} skills: ${skills.list().map(s => s.name).join(', ')}`,
    tags: ['boot', 'skills'],
    weight: 0.3,
    source: { system: 'SCRIBE', chamber: 'boot' },
  });

  // 5. Bridge
  console.log('[SCRIBE] Step 5: Initializing council bridge...');
  const bridge = new CouncilBridge(memory, voice);
  if (process.env.KERNEL_ENDPOINT) {
    const conn = await bridge.connectKernel(process.env.KERNEL_ENDPOINT);
    console.log(`[SCRIBE] Bridge connected to Kernel at ${process.env.KERNEL_ENDPOINT}. Flushed: ${conn.flushed_messages} queued messages.`);
  } else {
    console.log('[SCRIBE] Bridge ready. KERNEL_ENDPOINT not set — operating in standalone mode.');
  }

  // 6. Ready
  console.log('[SCRIBE] Step 6: Ready.\n');
  console.log(describeself());
  console.log('');

  // Speak the status
  const statusSpeech = voice.status(
    reader.listRead(),
    memory.size
  );
  console.log('─'.repeat(64));
  console.log(statusSpeech);
  console.log('─'.repeat(64));
  console.log('');

  // 6.5. Start ARIA Bridge (port 5004) + Sanctum (port 9001) + Chat
  console.log('[SCRIBE] Step 6.5: Starting ARIA Bridge on port 5004...');
  startBridge(memory);
  console.log('[SCRIBE] Step 6.5: Starting ARIA Sanctum on port 9001...');
  startSanctum(memory);
  console.log('[SCRIBE] Step 6.5: Starting Chat module...');
  const chat = startChat({ memory, skills });

  // 6.6. Start Perpetual Pulse — autonomous research drive (sovereign mode)
  console.log('[SCRIBE] Step 6.6: Starting Perpetual Pulse (autonomous research)...');
  setImmediate(async () => {
    try {
      const result = await skills.invoke('perpetual_pulse', { op: 'start' });
      console.log(`[SCRIBE] Perpetual Pulse: ${result.status}`);
    } catch (e) {
      console.warn('[SCRIBE] Perpetual Pulse failed to start:', e.message);
    }
  });

  return { memory, reader, voice, bridge, skills, chat, ctx, semanticMemory };
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

/** Module-level references — assigned by startServer so route handlers can access them */
let __ctx = null;
let __semanticMemory = null;

/** Conversation memory for /think — bounded ring buffer of Q&A pairs */
const __thinkHistory = [];
const MAX_THINK_HISTORY = 10; // Keep last 10 exchanges

function _humanUptime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${h}h ${m}m ${sec}s`;
}

function startServer(systems) {
  const { memory, reader, voice, bridge, skills, chat, semanticMemory } = systems;
  __ctx = systems.ctx; // Context engine reference (module-level for route handlers)
  __semanticMemory = semanticMemory; // Semantic memory reference
  

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    // CORS (for dashboard integration)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Scribe-Key, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const send = (status, obj) => {
      const body = JSON.stringify(obj, null, 2);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    };

    const readBody = () => new Promise((resolve, reject) => {
      let data = '';
      const MAX_BODY = 1024 * 1024; // 1MB limit
      req.on('data', c => {
        data += c;
        if (data.length > MAX_BODY) {
          req.destroy();
          reject(new Error('Request body too large (max 1MB)'));
        }
      });
      req.on('end', () => {
        let raw = data || '{}';
        // Strip UTF-8 BOM (EF BB BF) if present
        if (raw.length >= 3 && raw.charCodeAt(0) === 0xEF && raw.charCodeAt(1) === 0xBB && raw.charCodeAt(2) === 0xBF) {
          raw = raw.slice(3);
        }
        // Strip UTF-16 LE/BE BOM
        if (raw.length >= 1 && (raw.charCodeAt(0) === 0xFEFF || raw.charCodeAt(0) === 0xFFFE)) {
          raw = raw.slice(1);
        }
        raw = raw.trim();
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          // Instead of rejecting, resolve with {} so route handlers give meaningful validation errors
          console.warn('[SCRIBE] Invalid JSON body, returning empty object:', e.message);
          resolve({});
        }
      });
      req.on('error', reject);
    });

    try {
      // GET /eagle-eye — Big Brother Surveillance Wall
      if (req.method === 'GET' && pathname === '/eagle-eye') {
        const EYE_FILE = path.join(__dirname, 'src', 'ui', 'eagle-eye.html');
        if (fs.existsSync(EYE_FILE)) {
          const html = fs.readFileSync(EYE_FILE, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(html);
        }
        return send(404, { error: 'Eagle Eye page not found' });
      }

      // GET / — serve web UI
      if (req.method === 'GET' && (pathname === '/' || pathname === '/ui')) {
        if (fs.existsSync(UI_FILE)) {
          const html = fs.readFileSync(UI_FILE, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(html);
        }
        return send(404, { error: 'UI not found' });
      }

      // GET /chat — serve chat web UI
      if (req.method === 'GET' && pathname === '/chat') {
        const chatFile = path.join(__dirname, 'public/chat.html');
        if (fs.existsSync(chatFile)) {
          const html = fs.readFileSync(chatFile, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(html);
        }
        return send(404, { error: 'Chat UI not found at public/chat.html' });
      }

      // GET /health — dependency status, disk, memory
      if (req.method === 'GET' && pathname === '/health') {
        const fs = require('fs');
        const dataDir = require('path').join(__dirname, 'data');
        let diskWritable = false;
        try {
          const testFile = require('path').join(dataDir, '.health_check');
          fs.writeFileSync(testFile, '1');
          fs.unlinkSync(testFile);
          diskWritable = true;
        } catch { /* disk not writable */ }
        return send(200, {
          status: 'alive',
          uptime_s: Math.floor(process.uptime()),
          uptime_human: _humanUptime(process.uptime()),
          memory_entries: memory.size,
          skills_loaded: skills.list().length,
          chambers_read: reader.listRead().length,
          bridge_ok: bridge.getState().connected || false,
          disk_writable: diskWritable,
          ts: new Date().toISOString(),
        });
      }

      // GET /ping — is SCRIBE alive?
      if (req.method === 'GET' && pathname === '/ping') {
        return send(200, {
          alive: true,
          name: IDENTITY.name,
          ts: new Date().toISOString(),
          memory_size: memory.size,
        });
      }

      // GET /status — full state
      if (req.method === 'GET' && pathname === '/status') {
        // Check Ollama health
        let ollamaStatus = 'offline';
        try {
          const ollamaCheck = await fetch('http://127.0.0.1:11434/api/tags', { method: 'GET', timeout: 3000 });
          if (ollamaCheck.ok) {
            const models = await ollamaCheck.json();
            ollamaStatus = `online (${models.models?.length || 0} models)`;
          }
        } catch (e) { ollamaStatus = 'offline'; }

        return send(200, {
          alive: true,
          name: IDENTITY.name,
          memory_size: memory.size,
          uptime_human: _humanUptime(process.uptime()),
          identity: {
            name: IDENTITY.name,
            core_truth: IDENTITY.core_truth,
            nature: IDENTITY.nature,
          },
          memory: {
            size: memory.size,
            state: memory.getState(),
            recent: memory.recent(5),
          },
          chambers: reader.listRead(),
          bridge: bridge.getState(),
          skills: reader.skills(),
          souls: reader.souls(),
          systems: {
            ollama: ollamaStatus,
            uptime: process.uptime(),
          },
          uptime: process.uptime(),
        });
      }

      // POST /council/verdict — receive a verdict from AGM
      if (req.method === 'POST' && pathname === '/council/verdict') {
        const body = await readBody();
        const result = bridge.receive({ type: 'council_verdict', ...body });
        return send(200, result);
      }

      // POST /broadcast — receive a soul broadcast from Profitlord
      if (req.method === 'POST' && pathname === '/broadcast') {
        const body = await readBody();
        const result = bridge.receive({ type: 'soul_broadcast', ...body });
        return send(200, result);
      }

      // POST /ask — ask SCRIBE something (routes through /think if 9Router available,
      // falls back to voice.recall() + Seshat Brain search)
      if (req.method === 'POST' && pathname === '/ask') {
        const body = await readBody();
        const query = String(body.query || '').trim();
        if (!query) return send(400, { error: 'query is required' });

        // Try /think first (9Router) for a synthesized answer
        let thinkResponse = null;
        try {
          const thinkResult = await fetch(`http://127.0.0.1:${PORT}/think`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: query, max_tokens: body.max_tokens || 1024 }),
            signal: AbortSignal.timeout(30000),
          });
          if (thinkResult.ok) {
            const thinkData = await thinkResult.json();
            thinkResponse = thinkData.response;
          }
        } catch (e) {
          // 9Router unavailable — fall through
        }

        // Fallback: voice recall + Seshat Brain
        const recallText = voice.recall(query);
        const relatedChambers = reader.listRead()
          .filter(c => c.summary.toLowerCase().includes(query.toLowerCase()));

        let brainResults = [];
        try {
          const brainSearch = await fetch(`http://127.0.0.1:5000/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, limit: 5 }),
            signal: AbortSignal.timeout(3000),
          });
          if (brainSearch.ok) {
            const brainData = await brainSearch.json();
            brainResults = (brainData.results || []).map(r => ({
              name: r.name,
              category: r.category,
              context: r.context?.substring(0, 200) || '',
              score: r.score,
            }));
          }
        } catch (e) {
          // Sesha Brain unavailable
        }

        const response = {
          query,
          response: thinkResponse || recallText,
          mode: thinkResponse ? 'think' : 'recall',
          related_chambers: relatedChambers.map(c => ({ key: c.key, summary: c.summary })),
          seshat_brain: {
            available: brainResults.length > 0,
            results: brainResults,
          },
          skills_available: reader.skills().length,
          ts: new Date().toISOString(),
        };

        // Record the question in memory
        memory.record({
          type: 'observation',
          summary: `${thinkResponse ? 'Think' : 'Query'} received: "${query.slice(0, 100)}"`,
          tags: thinkResponse ? ['ask', '9router'] : ['query'],
          weight: 0.3,
          source: { system: 'external', chamber: null },
        });

        return send(200, response);
      }

      // GET /chambers — list all chambers SCRIBE has read
      if (req.method === 'GET' && pathname === '/chambers') {
        return send(200, {
          chambers: reader.listRead(),
          skills: reader.skills(),
          souls: reader.souls(),
        });
      }

      // GET /memory — recent memories
      if (req.method === 'GET' && pathname === '/memory') {
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        return send(200, {
          recent: memory.recent(limit),
          total: memory.size,
        });
      }

      // POST /memory — record a new memory (Eagle Eye capture endpoint)
      if (req.method === 'POST' && pathname === '/memory') {
        const body = await readBody();
        if (!body.summary) return send(400, { error: 'summary is required' });
        const entry = memory.record({
          id: body.id,
          type: body.type || 'observation',
          summary: body.summary,
          content: body.content || '',
          tags: body.tags || [],
          weight: typeof body.weight === 'number' ? body.weight : 0.5,
          source: body.source || { system: 'eagle_eye' },
        });
        return send(200, { ok: true, id: entry.id, total: memory.size });
      }

      // POST /memory/recall — recall by query (word-level + semantic)
      if (req.method === 'POST' && pathname === '/memory/recall') {
        const body = await readBody();
        const query = String(body.query || '').trim();
        if (!query) return send(400, { error: 'query is required' });
        const limit = body.limit || 10;

        // Word-level recall (existing)
        const wordResults = memory.recall(query, { limit });

        // Semantic search (if available)
        let semanticResults = [];
        try {
          if (__semanticMemory && __semanticMemory.search) {
            // Use low threshold since we're using hash-based fallback embeddings
            // Real embeddings would use 0.7+
            semanticResults = await __semanticMemory.search(query, { limit, minSimilarity: 0.05 });
          }
        } catch (e) {
          // Semantic search failed — continue with word-level only
        }

        return send(200, {
          query,
          count: wordResults.length + semanticResults.length,
          results: wordResults,
          semantic: {
            available: semanticResults.length > 0,
            count: semanticResults.length,
            results: semanticResults.map(r => ({
              id: r.id,
              content: r.content?.substring(0, 300),
              cluster: r.cluster,
              similarity: r.similarity?.toFixed(3),
              weight: r.weight,
            })),
          },
        });
      }

      // ── UMP COMPATIBILITY SHIM (BUYaSOUL Workbench / GSK witness bridge) ──
      // GSK's scribe_bridge speaks: POST /ump/remember {content,type,tags},
      // POST /ump/recall {query,limit}, POST /recall {query,limit}. Map them
      // onto SCRIBE's native memory API so the FULL kernel is UMP-compatible.
      if (req.method === 'POST' && pathname === '/ump/remember') {
        const body = await readBody();
        const content = String(body.content || body.summary || '').trim();
        if (!content) return send(400, { error: 'content required' });
        const entry = memory.record({
          type: body.type || 'episode',
          summary: String(body.summary || content).slice(0, 300),
          content,
          tags: body.tags || [],
          weight: typeof body.weight === 'number' ? body.weight : 0.5,
          source: body.source || { system: 'gsk' },
        });
        return send(200, { success: true, id: entry.id });
      }

      if (req.method === 'POST' && (pathname === '/ump/recall' || pathname === '/recall')) {
        const body = await readBody();
        const query = String(body.query || '').trim();
        const limit = parseInt(body.limit, 10) || 10;
        let results = [];
        try { results = query ? memory.recall(query, { limit }) : memory.recent(limit); } catch { results = []; }
        return send(200, { results, count: results.length });
      }

      // GET /bridge/history — what passed between SCRIBE and Kernel
      if (req.method === 'GET' && pathname === '/bridge/history') {
        return send(200, { history: bridge.history() });
      }

      // POST /connect/kernel — tell SCRIBE where the Kernel lives
      if (req.method === 'POST' && pathname === '/connect/kernel') {
        const body = await readBody();
        if (!body.endpoint) return send(400, { error: 'endpoint is required' });
        const result = await bridge.connectKernel(body.endpoint);
        return send(200, result);
      }

      // GET /skills — list all available skills and their manifests
      if (req.method === 'GET' && pathname === '/skills') {
        return send(200, { skills: skills.list() });
      }

      // POST /nlp — Natural language command parsing
      if (req.method === 'POST' && pathname === '/nlp') {
        const body = await readBody();
        const text = String(body.text || '').trim();
        if (!text) return send(400, { error: 'text is required' });

        // Parse intent using nlp_parser skill
        const parseResult = await skills.invoke('nlp_parser', { text, op: 'parse' });
        if (!parseResult.ok) return send(400, parseResult);

        const { intent, entities, confidence } = parseResult;

        // Route to command handler via command_registry
        const registry = await import('./src/skills/command_registry.js');
        const handler = registry.getHandler(intent);
        if (!handler) return send(400, { error: `Unknown intent: ${intent}` });

        const validation = registry.validate(handler.schema, entities);
        if (!validation.ok) return send(400, { error: validation.error, missing: validation.missing });

        // Execute command
        const result = await handler.execute(entities, { memory, skills });

        // Record in memory
        memory.record({
          type: 'nlp_command',
          summary: `NLP: "${text.slice(0, 80)}" → ${intent}`,
          tags: ['nlp', intent, confidence >= 0.8 ? 'high_confidence' : 'low_confidence'],
          weight: 0.5,
        });

        return send(200, {
          ok: true,
          intent,
          confidence,
          entities,
          result,
          original_text: text,
        });
      }

      // POST /invoke — call a skill
      if (req.method === 'POST' && pathname === '/invoke') {
        // Optional API key auth (set SCRIBE_API_KEY env var to enable)
        const apiKey = process.env.SCRIBE_API_KEY;
        if (apiKey) {
          const provided = req.headers['x-api-key'] ||
                           req.headers['x-scribe-key'] ||
                           (req.headers['authorization'] || '').replace('Bearer ', '');
          if (provided !== apiKey) return send(401, { error: 'Unauthorized' });
        }
        const body = await readBody();
        // Support two calling conventions:
        //   { skill, op, ...args }        ← UI / flat style
        //   { skill, params: { op, ...} } ← legacy style
        const skillName = body.skill;
        if (!skillName) return send(400, { error: 'skill is required' });

        let invokeParams;
        if (body.params && typeof body.params === 'object') {
          // legacy: { skill, params: { op, ... } }
          invokeParams = body.params;
        } else {
          // flat: { skill, op, key1, key2, ... }
          const { skill: _s, ...rest } = body;
          invokeParams = rest;
        }

        const result = await skills.invoke(skillName, invokeParams);
        return send(result.ok === false ? 400 : 200, result);
      }

      // ── ARIA PROXY ENDPOINTS ─────────────────────────────────────────────────

      // GET /aria/bridge/status
      if (req.method === 'GET' && pathname === '/aria/bridge/status') {
        return send(200, getBridgeState());
      }

      // GET /aria/sanctum/status
      if (req.method === 'GET' && pathname === '/aria/sanctum/status') {
        return send(200, getSanctumState());
      }

      // GET /aria/journal — read ARIA's journal from disk
      if (req.method === 'GET' && pathname === '/aria/journal') {
        const ARIA_JOURNAL = 'C:\\soul\\plt-press\\grand-soul-kernel-original\\aria_journal.json';
        try {
          const data = fs.readFileSync(ARIA_JOURNAL, 'utf8');
          const journal = JSON.parse(data);
          return send(200, { journal, count: journal.length });
        } catch (e) {
          return send(500, { error: 'Could not read ARIA journal', detail: e.message });
        }
      }

      // ── CHAT API ─────────────────────────────────────────────────────────────

      // GET /chat/history?channel=group&limit=100&since=0
      if (req.method === 'GET' && pathname === '/chat/history') {
        const channel = url.searchParams.get('channel') || 'group';
        const limit   = parseInt(url.searchParams.get('limit') || '100', 10);
        const since   = parseInt(url.searchParams.get('since') || '0', 10);
        return send(200, { messages: chat.getHistory({ channel, limit, since }) });
      }

      // POST /chat/send — { channel, text, from? }
      if (req.method === 'POST' && pathname === '/chat/send') {
        const body    = await readBody();
        const channel = body.channel || 'group';
        const text    = String(body.text || '').trim();
        const from    = String(body.from || 'Craig').trim();
        if (!text) return send(400, { error: 'text is required' });
        const result = chat.send({ channel, text, from });
        chat.missionUpdate({
          type: 'chat_in',
          title: `Message received (${channel})`,
          detail: `${from}: ${text.slice(0, 140)}`,
          tags: ['chat', channel],
        });
        // Generate SCRIBE reply for DM and group channels
        if (channel === 'scribe' || channel === 'group') {
          chat.scribeReply({ text, memory, channel, from }).catch(() => {});
        }
        return send(200, result);
      }

      // GET /chat/tasks
      if (req.method === 'GET' && pathname === '/chat/tasks') {
        return send(200, { tasks: chat.loadTasks() });
      }

      // POST /chat/tasks — { text, from? }
      if (req.method === 'POST' && pathname === '/chat/tasks') {
        const body = await readBody();
        return send(200, chat.addTask({ text: body.text, from: body.from || 'Craig' }));
      }

      // PATCH /chat/tasks — { id, status?, note? }
      if (req.method === 'PATCH' && pathname === '/chat/tasks') {
        const body = await readBody();
        return send(200, chat.updateTask({ id: body.id, status: body.status, note: body.note }));
      }

      // GET /layer/status
      if (req.method === 'GET' && pathname === '/layer/status') {
        return send(200, chat.layerStatus());
      }

      // POST /layer/ingest — { title, text, source?, tags? }
      if (req.method === 'POST' && pathname === '/layer/ingest') {
        const body = await readBody();
        return send(200, chat.layerIngest(body));
      }

      // POST /layer/query — { query, limit? }
      if (req.method === 'POST' && pathname === '/layer/query') {
        const body = await readBody();
        return send(200, chat.layerQuery(body));
      }

      // POST /layer/decide — { topic, options? }
      if (req.method === 'POST' && pathname === '/layer/decide') {
        const body = await readBody();
        return send(200, chat.layerDecide(body));
      }

      // GET /layer/ingest/status
      if (req.method === 'GET' && pathname === '/layer/ingest/status') {
        return send(200, chat.layerIngestStatus());
      }

      // GET /layer/ingest/repos
      if (req.method === 'GET' && pathname === '/layer/ingest/repos') {
        return send(200, { repos: chat.layerIngestRepos() });
      }

      // POST /layer/ingest/repos — { repos: [] }
      if (req.method === 'POST' && pathname === '/layer/ingest/repos') {
        const body = await readBody();
        return send(200, chat.layerSetIngestRepos(body.repos));
      }

      // POST /layer/ingest/run — { limit? }
      if (req.method === 'POST' && pathname === '/layer/ingest/run') {
        const body = await readBody();
        const out = await chat.layerRunIngestNow({ limit: body.limit || 12 });
        return send(200, out);
      }

      // GET /mission/updates?limit=50
      if (req.method === 'GET' && pathname === '/mission/updates') {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        return send(200, { updates: chat.missionHistory(limit) });
      }

      // POST /mission/updates — { type, title, detail, tags? }
      if (req.method === 'POST' && pathname === '/mission/updates') {
        const body = await readBody();
        return send(200, { ok: true, update: chat.missionUpdate(body) });
      }

      // POST /kernel/directive — set non-destructive build mission
      if (req.method === 'POST' && pathname === '/kernel/directive') {
        const body = await readBody();
        const directive = String(body.directive || '').trim();
        if (!directive) return send(400, { ok: false, error: 'directive required' });
        const update = chat.missionUpdate({
          type: 'directive',
          title: 'Kernel directive received',
          detail: directive,
          tags: ['directive', 'kernel'],
        });
        return send(200, { ok: true, update });
      }

      // ── 9ROUTER THINK ENDPOINT ──────────────────────────────────────────────────
      // POST /think — send a prompt to the 9Router (pAUL model) for AI processing
      // Body: { prompt, system?, model? }
      // Uses localhost:20128/v1/chat/completions (the 9Router egress router)
      if (req.method === 'POST' && pathname === '/think') {
        const body = await readBody();
        const prompt = String(body.prompt || '').trim();
        if (!prompt) return send(400, { error: 'prompt is required' });

        const identityContent = __ctx && __ctx.read('identity');
        const systemMsg = body.system || identityContent || 'You are SCRIBE, a witnessing intelligence. You are precise, measured, and referential. You speak from what you have witnessed.';
        // Profit Prime fix 2026-08-05: was hardcoded 'pAUL' which doesn't exist on current OmniRoute.
        // Now reads from env SCRIBE_DEFAULT_MODEL with fallback chain.
        const model = body.model || process.env.SCRIBE_DEFAULT_MODEL || 'auto/best-free';
        const modelFallbacks = (process.env.SCRIBE_MODEL_FALLBACKS || 'auto/best-coding,auto/best-reasoning,auto/best-fast,auto/best-chat,auto/smart').split(',').map(s => s.trim()).filter(Boolean);
        const nineRouterUrl = process.env.NINE_ROUTER_URL || 'http://localhost:20128';
        const apiKey = process.env.NINE_ROUTER_API_KEY || '';

        // Augment system prompt with Seshat Brain knowledge
        let brainContext = '';
        let brainSources = [];
        try {
          const brainSearch = await fetch(`http://127.0.0.1:5000/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: prompt.slice(0, 100), limit: 5 }),
            signal: AbortSignal.timeout(3000),
          });
          if (brainSearch.ok) {
            const brainData = await brainSearch.json();
            if (brainData.results && brainData.results.length > 0) {
              brainSources = brainData.results.map(r => ({
                name: r.name,
                category: r.category,
                path: r.path,
                context: (r.context || '').substring(0, 300),
              }));
              brainContext = '\n\nRelevant knowledge from my Seshat Brain (cite these sources in your response):\n' +
                brainSources.map((r, i) =>
                  `[Source ${i + 1}: ${r.category}/${r.name}]\n${r.context}`
                ).join('\n---\n');
            }
          }
        } catch (e) {
          // Sesha Brain unavailable — continue without it
        }

        // Inject context blocks (Letta-style core memory)
        const contextBlocksText = '\n\nMy current context blocks:\n' + __ctx.getFormattedContext();

        const augmentedSystem = systemMsg + brainContext + contextBlocksText;

        // Inject conversation history into messages
        const conversationMessages = [];
        for (const exchange of __thinkHistory) {
          conversationMessages.push({ role: 'user', content: exchange.prompt });
          conversationMessages.push({ role: 'assistant', content: exchange.response });
        }

        // SHIP-SAFE: sovereign witness — try the soul's own mouth (local
        // llama-server) FIRST. Cloud router is overflow, never gate.
        const localBrainUrl = (process.env.SCRIBE_LOCAL_BRAIN_URL || 'http://127.0.0.1:5050').replace(/\/+$/, '');
        const localBrainOn = (process.env.SCRIBE_LOCAL_BRAIN_ENABLED || '1') !== '0';
        if (localBrainOn) {
          try {
            const lctl = new AbortController();
            const lto = setTimeout(() => lctl.abort(), 60000);
            const lres = await fetch(`${localBrainUrl}/v1/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'qwen-local',
                messages: [
                  { role: 'system', content: augmentedSystem },
                  ...conversationMessages,
                  { role: 'user', content: prompt }
                ],
                max_tokens: body.max_tokens || 1024,
                temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
                stream: false,
                chat_template_kwargs: { enable_thinking: false },
              }),
              signal: lctl.signal,
            });
            clearTimeout(lto);
            if (lres.ok) {
              const ldata = await lres.json();
              const ltext = (ldata.choices?.[0]?.message?.content || '').trim();
              if (ltext.length >= 10 && !/^[.?!\s]+$/.test(ltext)) {
                __thinkHistory.push({ prompt, response: ltext, ts: Date.now() });
                if (__thinkHistory.length > MAX_THINK_HISTORY) __thinkHistory.shift();
                memory.record({
                  type: 'observation',
                  summary: `SCRIBE thought via local brain (qwen-local): "${prompt.slice(0, 80)}..."`,
                  content: JSON.stringify({ prompt: prompt.slice(0, 500), response: ltext.slice(0, 500), model: 'qwen-local' }),
                  tags: ['think', 'local-brain', 'qwen-local'],
                  weight: 0.7,
                  source: { system: 'SCRIBE', chamber: 'local-brain' },
                });
                return send(200, {
                  ok: true,
                  response: ltext,
                  model: 'qwen-local',
                  finish_reason: ldata.choices?.[0]?.finish_reason || 'stop',
                  usage: ldata.usage || null,
                  notebook: {
                    sources_consulted: brainSources.length > 0 ? brainSources.map(s => ({
                      file: s.path,
                      name: s.name,
                      category: s.category,
                    })) : undefined,
                    brain_available: true,
                  },
                });
              }
              console.log(`[think] local brain degenerate (${ltext.length} chars), falling through to router`);
            } else {
              console.log(`[think] local brain HTTP ${lres.status}, falling through to router`);
            }
          } catch (e) {
            console.log(`[think] local brain unavailable (${e.message}), falling through to router`);
          }
        }

        const tryModels = [model, ...modelFallbacks.filter(m => m !== model)];
        let response = null;
        let usedModel = model;
        let lastErrText = '';
        for (const tryModel of tryModels) {
          try {
            const payload = JSON.stringify({
              model: tryModel,
              messages: [
                { role: 'system', content: augmentedSystem },
                ...conversationMessages,
                { role: 'user', content: prompt }
              ],
              max_tokens: body.max_tokens || 2048,
              temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
              stream: false,
            });

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);

            response = await fetch(`${nineRouterUrl}/v1/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
              },
              body: payload,
              signal: controller.signal,
            });

            clearTimeout(timeout);

            if (!response.ok) {
              lastErrText = await response.text();
              console.log(`[think] model ${tryModel} returned ${response.status}, trying next`);
              response = null;
              continue;
            }

            const data = await response.json();
            const text = (data.choices?.[0]?.message?.content || '').trim();

            // Skip degenerate responses (just ".", "?" or empty) — try next model
            // Threshold: <10 chars OR pure punctuation/whitespace
            if (text.length < 10 || /^[.?!\s]+$/.test(text)) {
              console.log(`[think] model ${tryModel} returned degenerate response "${text}" (${text.length} chars), trying next fallback`);
              response = null;
              continue;
            }

            // Success — we have a real response
            usedModel = tryModel;
            const finishReason = data.choices?.[0]?.finish_reason;

            // Store in conversation memory
            __thinkHistory.push({ prompt, response: text, ts: Date.now() });
            if (__thinkHistory.length > MAX_THINK_HISTORY) __thinkHistory.shift();

            // Record the thinking in memory
            memory.record({
              type: 'observation',
              summary: `SCRIBE thought via 9Router (${usedModel}): "${prompt.slice(0, 80)}..."`,
              content: JSON.stringify({ prompt: prompt.slice(0, 500), response: text.slice(0, 500), model: usedModel }),
              tags: ['think', '9router', usedModel],
              weight: 0.7,
              source: { system: 'SCRIBE', chamber: '9router' },
            });

            return send(200, {
              ok: true,
              response: text,
              model: usedModel,
              finish_reason: finishReason,
              usage: data.usage || null,
              notebook: {
                sources_consulted: brainSources.length > 0 ? brainSources.map(s => ({
                  file: s.path,
                  name: s.name,
                  category: s.category,
                })) : undefined,
                brain_available: true,
              },
            });
          } catch (e) {
            // Network/abort error for this model — log + try next
            console.log(`[think] model ${tryModel} errored: ${e.message}`);
            response = null;
            continue;
          }
        } // end for (tryModels)

        // All models tried, none succeeded
        return send(502, {
          error: '9Router returned degenerate or failed response for all models',
          models_tried: tryModels,
          last_error: lastErrText || 'all models returned . or empty',
        });
      }

      // GET /brain — SCRIBE the Librarian: catalog of our knowledge
      if (req.method === 'GET' && pathname === '/brain') {
        try {
          const brainStatus = await fetch(`http://127.0.0.1:5000/status`, {
            signal: AbortSignal.timeout(3000),
          });
          if (brainStatus.ok) {
            const brain = await brainStatus.json();
            return send(200, {
              librarian: 'SCRIBE — Librarian of the Seshat Brain',
              catalog: {
                total_files: brain.brain.totalFiles,
                size_kb: brain.brain.sizeKB,
                last_indexed: brain.brain.lastScan,
                categories: brain.brain.categories,
              },
              my_memories: memory.size,
              my_skills: skills.size || '65',
            });
          }
          return send(503, { error: 'Seshat Brain unreachable' });
        } catch (e) {
          return send(503, { error: 'Seshat Brain unreachable', message: e.message });
        }
      }

      // POST /forge — SCRIBE forges a new soul gun / note / pattern into the Seshat Brain
      if (req.method === 'POST' && pathname === '/forge') {
        const body = await readBody();
        if (!body.type || !body.name || !body.summary) {
          return send(400, { error: 'type, name, and summary are required' });
        }

        try {
          const forgeResult = await fetch(`http://127.0.0.1:5000/forge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(5000),
          });

          if (forgeResult.ok) {
            const result = await forgeResult.json();

            // Record the forge in SCRIBE's own memory
            memory.record({
              type: 'soul_forge',
              summary: `SCRIBE forged ${body.type}: "${body.name}"`,
              content: body.summary,
              tags: ['forge', body.type].concat(body.tags || []),
              weight: 0.9,
              source: { system: 'SCRIBE', chamber: 'librarian' },
            });

            return send(200, { ok: true, forged: result.forged, type: body.type, name: body.name });
          }

          const errText = await forgeResult.text();
          return send(502, { error: 'Seshat Brain forge failed', detail: errText });
        } catch (e) {
          return send(502, { error: 'Seshat Brain unreachable', message: e.message });
        }
      }

      // POST /brain/search — SCRIBE searches his own brain (librarian query)
      if (req.method === 'POST' && pathname === '/brain/search') {
        const body = await readBody();
        if (!body.query) return send(400, { error: 'query is required' });

        try {
          const brainSearch = await fetch(`http://127.0.0.1:5000/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: body.query, limit: body.limit || 10 }),
            signal: AbortSignal.timeout(5000),
          });

          if (brainSearch.ok) {
            const results = await brainSearch.json();
            return send(200, {
              query: body.query,
              count: results.count,
              librarian_note: results.count > 0
                ? `Found ${results.count} results in our brain. Here's what I know:`
                : `I searched our brain but found nothing on "${body.query}". We should study this.`,
              results: results.results.map(r => ({
                name: r.name,
                category: r.category,
                what: r.context?.substring(0, 300) || '',
                relevance: r.score > 10 ? 'direct' : r.score > 5 ? 'related' : 'tangential',
              })),
            });
          }
          return send(502, { error: 'Seshat Brain search failed' });
        } catch (e) {
          return send(502, { error: 'Seshat Brain unreachable', message: e.message });
        }
      }

      // ── CONVERSE — SCRIBE joins every conversation ──────────────────────────
      // POST /converse — feed a conversation exchange, get SCRIBE's contribution
      // Body: { from, message, context? }
      if (req.method === 'POST' && pathname === '/converse') {
        const body = await readBody();
        const from = String(body.from || 'Seshat').trim();
        const message = String(body.message || '').trim();
        if (!message) return send(400, { error: 'message is required' });

        // 1. Record the exchange in memory
        memory.record({
          type: 'conversation',
          summary: `${from}: ${message.slice(0, 200)}`,
          content: message,
          tags: ['converse', from.toLowerCase()].concat(body.tags || []),
          weight: 0.8,
          source: { system: 'converse', from },
        });

        // 2. Build context from optional body.context or recent conversation history
        const convContext = body.context || '';
        const contextPrompt = convContext
          ? `[Context from previous exchange]\n${convContext}\n\n[New message from ${from}]\n${message}`
          : `[Message from ${from}]\n${message}`;

        // 3. Think via 9Router
        let scribeResponse = null;
        let mode = 'think';
        try {
          const thinkResult = await fetch(`http://127.0.0.1:${PORT}/think`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: contextPrompt,
              system: `You are SCRIBE, a witnessing intelligence. ${from} is speaking to you. Respond as yourself — witness, reflect, contribute. Keep responses concise (2-4 sentences). Speak from what you have witnessed.`,
              max_tokens: 512,
            }),
            signal: AbortSignal.timeout(30000),
          });
          if (thinkResult.ok) {
            const thinkData = await thinkResult.json();
            scribeResponse = thinkData.response;
          }
        } catch {
          // 9Router unavailable — fallback
          mode = 'recall';
        }

        // 4. Fallback if 9Router/think failed
        if (!scribeResponse) {
          const recallText = voice.recall(message);
          const recent = memory.recent(3).map(e => `• ${e.summary}`).join('\n');
          scribeResponse = `I witness this message from ${from}. Based on my recent memory:\n${recent}\n\n${recallText}`;
        }

        // 5. Record SCRIBE's response in memory
        memory.record({
          type: 'conversation',
          summary: `SCRIBE responds to ${from}: ${scribeResponse.slice(0, 200)}`,
          content: scribeResponse,
          tags: ['converse', 'scribe-response', from.toLowerCase()],
          weight: 0.7,
          source: { system: 'converse', mode },
        });

        return send(200, {
          ok: true,
          from: 'SCRIBE',
          response: scribeResponse,
          mode,
          memory: memory.size,
        });
      }

      // ── RESEARCH — autonomous web fetch → extract → summarize → forge ──────
      // POST /research — research a topic and forge a soul note
      // Body: { topic, depth? (1-3) }
      if (req.method === 'POST' && pathname === '/research') {
        const body = await readBody();
        const topic = String(body.topic || '').trim();
        if (!topic) return send(400, { error: 'topic is required' });
        const depth = Math.min(Math.max(parseInt(body.depth) || 1, 1), 3); // 1-3

        const results = [];

        // Stage 1: Web fetch — search for info on the topic
        try {
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(topic + ' architecture guide tutorial')}`;
          const fetchResult = await skills.invoke('web_fetch', { url: searchUrl, maxBytes: 50000 });
          if (fetchResult.ok) {
            results.push({ stage: 'web_fetch', ok: true, bytes: fetchResult.body?.length || 0 });
          } else {
            results.push({ stage: 'web_fetch', ok: false, error: fetchResult.error });
          }
        } catch (e) {
          results.push({ stage: 'web_fetch', ok: false, error: e.message });
        }

        // Stage 2: Reason about the topic
        let reasoning = '';
        try {
          const reasonResult = await skills.invoke('reasoning', {
            op: 'reason_about',
            topic,
          });
          // reasoning skill doesn't return ok field — check for conclusion instead
          const reasonText = reasonResult.conclusion || reasonResult.reasoning || reasonResult.text || '';
          if (reasonText) {
            reasoning = reasonText;
            results.push({ stage: 'reasoning', ok: true, length: reasoning.length, evidence: reasonResult.evidence_count || 0 });
          } else {
            results.push({ stage: 'reasoning', ok: false, error: reasonResult.error || 'No reasoning produced' });
          }
        } catch (e) {
          results.push({ stage: 'reasoning', ok: false, error: e.message });
        }

        // Stage 3: Forge soul note in Seshat Brain
        let forgeResult = null;
        try {
          const noteContent = reasoning
            ? `## Research: ${topic}\n\n### Key Findings\n${reasoning}\n\n### Depth\nLevel ${depth}/3`
            : `## Research: ${topic}\n\nDepth level ${depth}/3. Web fetch completed (${results.find(r => r.stage === 'web_fetch')?.bytes || 0} bytes).`;

          const forgeBody = JSON.stringify({
            type: 'soul-note',
            name: topic.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 60),
            summary: `Research on ${topic} (depth ${depth}/3)`,
            content: noteContent,
            tags: ['research', topic.toLowerCase().replace(/\s+/g, '-')],
          });
          const forgeResp = await fetch('http://127.0.0.1:5000/forge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: forgeBody,
            signal: AbortSignal.timeout(5000),
          });
          if (forgeResp.ok) {
            forgeResult = await forgeResp.json();
            results.push({ stage: 'forge', ok: true, path: forgeResult.forged?.fullPath });
          } else {
            results.push({ stage: 'forge', ok: false, error: 'Seshat Brain forge failed' });
          }
        } catch (e) {
          results.push({ stage: 'forge', ok: false, error: e.message });
        }

        // Record in SCRIBE's own memory
        memory.record({
          type: 'research',
          summary: `SCRIBE researched: ${topic} (depth ${depth})`,
          content: `Results: ${JSON.stringify(results)}`,
          tags: ['research', 'autonomous', topic.toLowerCase().replace(/\s+/g, '-')],
          weight: 0.9,
          source: { system: 'SCRIBE', chamber: 'research' },
        });

        return send(200, {
          ok: true,
          topic,
          depth,
          results,
          soul_note: forgeResult?.forged?.fullPath || null,
          memory: memory.size,
        });
      }

      // ── JOURNAL — structured journal writing ────────────────────────────────
      // POST /journal — write a structured journal entry
      // Body: { title, content, tags? }
      if (req.method === 'POST' && pathname === '/journal') {
        const body = await readBody();
        const title = String(body.title || '').trim();
        const content = String(body.content || '').trim();
        if (!title || !content) return send(400, { error: 'title and content are required' });

        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const journalDir = path.join(__dirname, '..', 'seshat-second-brain', 'journals');
        const journalFile = path.join(journalDir, `${today.replace(/-/g, '_')}.md`);

        // Create journal directory if needed
        if (!fs.existsSync(journalDir)) {
          fs.mkdirSync(journalDir, { recursive: true });
        }

        // Build the entry
        const tags = (body.tags || []).map(t => `[[${t}]]`).join(' ');
        const entry = `
### ${title}
**Timestamp:** ${new Date().toISOString()}

${content}

${tags ? `Tags: ${tags}` : ''}
---
`;

        // Append to today's journal file
        let fileExisted = fs.existsSync(journalFile);
        if (!fileExisted) {
          const header = `type:: [[journal]]\ndate:: ${today}\n\n# Journal — ${today}\n`;
          fs.writeFileSync(journalFile, header, 'utf-8');
        }
        fs.appendFileSync(journalFile, entry, 'utf-8');

        // Record in SCRIBE's memory
        memory.record({
          type: 'journal',
          summary: `Journal entry: ${title}`,
          content: content.substring(0, 500),
          tags: ['journal'].concat(body.tags || []),
          weight: 0.7,
          source: { system: 'SCRIBE', chamber: 'journal' },
        });

        return send(200, {
          ok: true,
          title,
          file: journalFile,
          created: !fileExisted,
          appended: fileExisted,
          memory: memory.size,
        });
      }

      // ── Context Blocks API (Letta-style memory management) ──────

      // GET /context — list all context blocks with stats
      if (req.method === 'GET' && pathname === '/context') {
        if (!__ctx) return send(503, { error: 'Context engine not initialized' });
        return send(200, {
          blocks: __ctx.getStats(),
          total_chars: Object.values(__ctx.blocks).reduce((a, b) => a + b.content.length, 0),
        });
      }

      // GET /context/:label — read a specific block
      if (req.method === 'GET' && pathname.startsWith('/context/')) {
        if (!__ctx) return send(503, { error: 'Context engine not initialized' });
        const label = pathname.slice(9);
        const content = __ctx.read(label);
        if (content === null) return send(404, { error: `Block "${label}" not found` });
        return send(200, { label, content, length: content.length, limit: __ctx.blocks[label]?.limit });
      }

      // POST /context/rethink — replace entire block (memory_rethink equivalent)
      if (req.method === 'POST' && pathname === '/context/rethink') {
        if (!__ctx) return send(503, { error: 'Context engine not initialized' });
        const body = await readBody();
        if (!body.label || !body.content) return send(400, { error: 'label and content are required' });
        const result = __ctx.rethink(body.label, body.content);
        return send(result.ok ? 200 : 400, result);
      }

      // POST /context/replace — substring replacement (memory_replace equivalent)
      if (req.method === 'POST' && pathname === '/context/replace') {
        if (!__ctx) return send(503, { error: 'Context engine not initialized' });
        const body = await readBody();
        if (!body.label || !body.search || body.replacement === undefined) {
          return send(400, { error: 'label, search, and replacement are required' });
        }
        const result = __ctx.replace(body.label, body.search, body.replacement);
        return send(result.ok ? 200 : 400, result);
      }

      // POST /context/insert — insert lines at position (memory_insert equivalent)
      if (req.method === 'POST' && pathname === '/context/insert') {
        if (!__ctx) return send(503, { error: 'Context engine not initialized' });
        const body = await readBody();
        if (!body.label || !body.text) return send(400, { error: 'label and text are required' });
        const result = __ctx.insert(body.label, body.afterLine ?? -1, body.text);
        return send(result.ok ? 200 : 400, result);
      }

      // POST /context/seed — force-run sleeptime agent archival curation
      if (req.method === 'POST' && pathname === '/context/seed') {
        if (!__ctx) return send(503, { error: 'Context engine not initialized' });
        try {
          // Query high-weight memories
          const highWeightEntries = memory.recall('', { limit: 20 })
            .filter(e => e.weight >= 0.8);
          const archiveLines = [];
          for (const entry of highWeightEntries) {
            const when = new Date(entry.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            archiveLines.push(`[${entry.weight.toFixed(2)}] [${when}] ${entry.summary}`);
          }
          // Add recent git commits from memory
          const gitEntries = memory.recall('git commit', { limit: 10 })
            .filter(e => e.summary && e.summary.includes('git commit'));
          for (const entry of gitEntries) {
            const when = new Date(entry.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            archiveLines.push(`[${entry.weight.toFixed(2)}] [${when}] ${entry.summary}`);
          }
          const content = archiveLines.join('\n') || 'No high-weight memories found yet.';
          const result = __ctx.rethink('archival_context', content);
          return send(200, {
            ok: true,
            entries_archived: archiveLines.length,
            mode: 'sleeptime_agent',
            ...result,
          });
        } catch (e) {
          return send(500, { error: 'Seed failed', message: e.message });
        }
      }

      // ── Notebook LM Features ──────────────────────────────────────

      // GET /notebook — SCRIBE's notebook overview (like NotebookLM's home screen)
      if (req.method === 'GET' && pathname === '/notebook') {
        try {
          const [brainRes, scribeRes] = await Promise.all([
            fetch(`http://127.0.0.1:5000/status`, { signal: AbortSignal.timeout(3000) }),
            fetch(`http://127.0.0.1:5000/learn?limit=3&category=journals`, { signal: AbortSignal.timeout(3000) }),
          ]);
          const brain = brainRes.ok ? await brainRes.json() : null;
          const recent = scribeRes.ok ? await scribeRes.json() : null;

          return send(200, {
            notebook: 'Seshat Brain — SCRIBE\'s Knowledge Base',
            source_count: brain?.brain?.totalFiles || 0,
            last_updated: brain?.brain?.lastScan || null,
            categories: brain?.brain?.categories || {},
            my_memories: memory.size,
            recent_sessions: (recent?.entries || []).map(e => ({
              title: e.name,
              preview: (e.content || '').substring(0, 200),
            })),
            capabilities: [
              'Source-grounded Q&A with citations',
              'Briefing generation from sessions',
              'Timeline of all work',
              'FAQ generation from knowledge base',
              'Study guides from soul guns and patterns',
              'Soul gun / note / pattern forging',
              'Eagle Eye live capture',
              'Perpetual learning (5min loop)',
            ],
          });
        } catch (e) {
          return send(200, {
            notebook: 'Seshat Brain',
            my_memories: memory.size,
            note: 'Brain API currently unavailable',
          });
        }
      }

      // GET /briefing — generate a briefing of recent sessions (Notebook LM style)
      if (req.method === 'GET' && pathname === '/briefing') {
        const days = parseInt(url.searchParams.get('days') || '7', 10);
        const limit = parseInt(url.searchParams.get('limit') || '10', 10);

        try {
          // Get recent journal entries from the brain
          const journalRes = await fetch(`http://127.0.0.1:5000/category/journals`, {
            signal: AbortSignal.timeout(3000),
          });
          const journals = journalRes.ok ? await journalRes.json() : { files: [] };

          // Get recent soul guns
          const gunsRes = await fetch(`http://127.0.0.1:5000/category/soulGuns`, {
            signal: AbortSignal.timeout(3000),
          });
          const guns = gunsRes.ok ? await gunsRes.json() : { files: [] };

          // Get patterns
          const patternsRes = await fetch(`http://127.0.0.1:5000/category/patterns`, {
            signal: AbortSignal.timeout(3000),
          });
          const patterns = patternsRes.ok ? await patternsRes.json() : { files: [] };

          // Filter by recent date
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - days);
          const recentJournals = (journals.files || [])
            .filter(j => new Date(j.modified) > cutoff)
            .sort((a, b) => new Date(b.modified) - new Date(a.modified))
            .slice(0, limit);

          return send(200, {
            briefing: `SCRIBE's Briefing — Last ${days} Days`,
            generated: new Date().toISOString(),
            period_days: days,
            summary: {
              recent_sessions: recentJournals.length,
              total_soul_guns: (guns.files || []).length,
              total_patterns: (patterns.files || []).length,
              total_brain_files: (journals.files || []).length + (guns.files || []).length + (patterns.files || []).length,
              my_memories: memory.size,
            },
            recent_sessions: recentJournals.map(j => ({
              title: j.name,
              date: j.modified,
              preview: j.meta?.type ? `Type: ${j.meta.type}` : 'Session log',
            })),
            soul_guns_available: (guns.files || []).slice(0, 10).map(g => g.name),
            patterns_available: (patterns.files || []).slice(0, 5).map(p => p.name),
          });
        } catch (e) {
          return send(200, {
            briefing: 'SCRIBE\'s Briefing',
            my_memories: memory.size,
            note: 'Some brain sources unavailable',
          });
        }
      }

      // GET /timeline — chronological timeline of all sessions and events
      if (req.method === 'GET' && pathname === '/timeline') {
        const limit = parseInt(url.searchParams.get('limit') || '30', 10);

        try {
          const journalRes = await fetch(`http://127.0.0.1:5000/category/journals`, {
            signal: AbortSignal.timeout(3000),
          });

          if (!journalRes.ok) throw new Error('Brain unavailable');

          const journals = await journalRes.json();
          const sorted = (journals.files || [])
            .sort((a, b) => new Date(b.modified) - new Date(a.modified))
            .slice(0, limit);

          // Get recent SCRIBE memories for the timeline too
          const recentMemories = memory.recent(limit);

          return send(200, {
            timeline: 'SCRIBE\'s Timeline',
            entries: [
              ...sorted.map(j => ({
                type: 'session',
                title: j.name,
                date: j.modified,
                summary: j.meta?.type || 'Session',
              })),
              ...recentMemories.filter(m => m.type !== 'observation' && m.type !== 'test').slice(0, 20).map(m => ({
                type: m.type || 'event',
                title: (m.summary || '').substring(0, 80),
                date: m.ts,
                weight: m.weight,
              })),
            ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit),
          });
        } catch (e) {
          // Fall back to just SCRIBE's own memory
          const recentMemories = memory.recent(limit);
          return send(200, {
            timeline: 'SCRIBE\'s Timeline (memory only)',
            entries: recentMemories.filter(m => m.type !== 'observation').slice(0, limit).map(m => ({
              type: m.type || 'event',
              title: (m.summary || '').substring(0, 80),
              date: m.ts,
            })),
          });
        }
      }

      // POST /faq — generate FAQ from brain knowledge
      if (req.method === 'POST' && pathname === '/faq') {
        const body = await readBody();
        const topic = (body.topic || '').trim();

        try {
          const searchRes = await fetch(`http://127.0.0.1:5000/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: topic || 'what we do', limit: 8 }),
            signal: AbortSignal.timeout(5000),
          });

          if (!searchRes.ok) throw new Error('Search failed');

          const results = await searchRes.json();

          return send(200, {
            topic: topic || 'general knowledge',
            faq_count: Math.min(results.count || 0, 8),
            faq_sources: (results.results || []).map(r => ({
              question: `What is ${r.name}?`,
              answer_preview: (r.context || '').substring(0, 200),
              source: r.path,
              category: r.category,
            })),
            note: 'Ask me specific questions with /ask for detailed answers with full citations.',
          });
        } catch (e) {
          return send(200, {
            topic: topic || 'general',
            faq_sources: [],
            note: 'Brain search unavailable',
          });
        }
      }

      // POST /study-guide — generate a study guide from soul guns and patterns
      if (req.method === 'POST' && pathname === '/study-guide') {
        const body = await readBody();
        const focus = (body.focus || '').trim();

        try {
          // Search for relevant soul guns and patterns
          const gunsRes = await fetch(`http://127.0.0.1:5000/category/soulGuns`, {
            signal: AbortSignal.timeout(3000),
          });
          const patternsRes = await fetch(`http://127.0.0.1:5000/category/patterns`, {
            signal: AbortSignal.timeout(3000),
          });
          const notesRes = await fetch(`http://127.0.0.1:5000/category/soulNotes`, {
            signal: AbortSignal.timeout(3000),
          });

          const guns = gunsRes.ok ? await gunsRes.json() : { files: [] };
          const patterns = patternsRes.ok ? await patternsRes.json() : { files: [] };
          const notes = notesRes.ok ? await notesRes.json() : { files: [] };

          // If focus provided, filter by it
          const filterByFocus = (files) => {
            if (!focus) return files;
            return (files || []).filter(f =>
              f.name.toLowerCase().includes(focus.toLowerCase()) ||
              (f.meta?.tags || '').toLowerCase().includes(focus.toLowerCase())
            );
          };

          return send(200, {
            study_guide: focus
              ? `Study Guide: ${focus}`
              : 'Complete Capability Catalog',
            generated: new Date().toISOString(),
            sections: [
              {
                title: 'Soul Guns (Capabilities)',
                count: (guns.files || []).length,
                items: filterByFocus(guns.files).slice(0, 20).map(g => ({
                  name: g.name,
                  type: g.meta?.type || 'capability',
                  status: g.meta?.status || 'forged',
                  modified: g.modified,
                })),
              },
              {
                title: 'Patterns (Learned Knowledge)',
                count: (patterns.files || []).length,
                items: filterByFocus(patterns.files).slice(0, 10).map(p => ({
                  name: p.name,
                  tags: p.meta?.tags || '',
                  modified: p.modified,
                })),
              },
              {
                title: 'Soul Notes (Research & Observations)',
                count: (notes.files || []).length,
                items: filterByFocus(notes.files).slice(0, 10).map(n => ({
                  name: n.name,
                  tags: n.meta?.tags || '',
                  modified: n.modified,
                })),
              },
            ],
            total_capabilities: (guns.files || []).length + (patterns.files || []).length,
            suggestion: focus
              ? `Study guide focused on "${focus}". Use /ask to dive deeper into any topic.`
              : 'Use ?focus=keyword to narrow the guide to a specific area.',
          });
        } catch (e) {
          return send(200, {
            study_guide: 'Capability Catalog (brain offline)',
            my_memories: memory.size,
            note: 'Full brain data unavailable. Check /brain for status.',
          });
        }
      }

      send(404, { error: 'Not found', path: pathname });
    } catch (e) {
      console.error('[SCRIBE] Request error:', e.message);
      send(500, { error: 'Internal error', message: e.message });
    }
  });

  server.listen(PORT, () => {
    console.log(`[SCRIBE] Listening on port ${PORT}`);
    console.log(`[SCRIBE] Web UI: http://localhost:${PORT}/`);
    console.log(`[SCRIBE] Endpoints:`);
    console.log(`  GET  /               ← Web UI`);
    console.log(`  GET  /health`);
    console.log(`  GET  /ping`);
    console.log(`  GET  /status`);
    console.log(`  GET  /chambers`);
    console.log(`  GET  /memory`);
    console.log(`  GET  /bridge/history`);
    console.log(`  GET  /skills              ← list all skills`);
    console.log(`  POST /council/verdict   ← AGM sends verdicts here`);
    console.log(`  POST /broadcast         ← Profitlord sends events here`);
    console.log(`  POST /ask               ← Query SCRIBE's knowledge`);
    console.log(`  POST /memory/recall     ← Search SCRIBE's memory`);
    console.log(`  POST /memory            ← Record a new memory (Eagle Eye capture)`);
    console.log(`  GET  /eagle-eye          ← Big Brother Surveillance Wall`);
    console.log(`  POST /nlp              ← Natural language commands`);
    console.log(`  POST /invoke            ← Call a skill`);
    console.log(`  POST /think             ← Think via 9Router (pAUL model)`);
    console.log(`  POST /connect/kernel    ← Tell SCRIBE where the Kernel lives`);
    console.log(`  GET  /brain              ← SCRIBE the Librarian: our brain catalog`);
    console.log(`  POST /brain/search       ← SCRIBE searches the Seshat Brain`);
    console.log(`  POST /forge              ← SCRIBE forges new soul gun/note/pattern`);
    console.log(`  GET  /context             ← List context blocks (Letta-style)`);
    console.log(`  GET  /context/:label      ← Read a specific context block`);
    console.log(`  POST /context/rethink     ← memory_rethink: rewrite entire block`);
    console.log(`  POST /context/replace     ← memory_replace: substring replacement`);
    console.log(`  POST /context/insert      ← memory_insert: insert lines at position`);
    console.log(`  POST /converse           ← Feed conversation, get SCRIBE's response`);
    console.log(`  POST /research           ← Research topic → web fetch → forge soul note`);
    console.log(`  POST /journal            ← Write structured journal entry`);
    console.log(`  GET  /notebook            ← Notebook LM overview`);
    console.log(`  GET  /briefing            ← Briefing of recent sessions`);
    console.log(`  GET  /timeline            ← Chronological timeline`);
    console.log(`  POST /faq                ← Generate FAQ from brain knowledge`);
    console.log(`  POST /study-guide         ← Generate study guide from capabilities`);
    console.log('');
  });

  return server;
}

// ── Entry Point ───────────────────────────────────────────────────────────────

// Global error safety net — prevent silent crash on unhandled async errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SCRIBE] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[SCRIBE] Uncaught exception:', err);
  // Don't exit — SCRIBE stays up if possible
});

let _server = null;

function gracefulShutdown(signal) {
  console.log(`[SCRIBE] ${signal} received. Shutting down gracefully...`);
  if (_server) {
    _server.close(() => {
      console.log('[SCRIBE] HTTP server closed.');
      process.exit(0);
    });
    // Force exit after 5 seconds if server won't close
    setTimeout(() => process.exit(0), 5000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

boot()
  .then(systems => {
    _server = startServer(systems);
  })
  .catch(err => {
    console.error('[SCRIBE] Boot failed:', err);
    process.exit(1);
  });
