#!/usr/bin/env node
/**
 * seshat-brain.cjs — SCRIBE's Brain (Seshat Knowledge API)
 * 
 * Reads the Seshat Second Brain markdown files and serves them as
 * a structured, queryable knowledge API that SCRIBE the Librarian
 * can read, search, learn from, and write back to.
 *
 * This is the fusion: Seshat stops being a record WE keep.
 * It becomes SCRIBE's living brain — his long-term memory,
 * his knowledge base, his pattern library, his skill forge.
 *
 * Port: 5000 (SESHA — Scribe Embedded Soul Hippocampus API)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = parseInt(process.env.SESHA_PORT || '5000', 10);
const SESHAT_DIR = process.env.SESHAT_DIR || 'C:\\Users\\uncom\\Desktop\\seshat-second-brain';

// ─── Brain Index ────────────────────────────────────────────

let brainIndex = {
  journals: [],    // daily session logs
  pages: [],       // knowledge pages, patterns, decisions
  soulGuns: [],    // forged capabilities
  soulNotes: [],   // research & observations
  others: [],      // everything else
  totalFiles: 0,
  lastScan: null,
  sizeBytes: 0
};

// File watcher handles
let watchers = [];

// ─── Scanner ────────────────────────────────────────────────

function categorizeFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const dir = path.dirname(filePath).toLowerCase();

  if (dir.includes('journals') || name.startsWith('202')) return 'journals';
  if (dir.includes('pages')) {
    if (name.includes('soul-gun') || name.includes('soulgun')) return 'soulGuns';
    if (name.includes('soul-note') || name.includes('soulnote')) return 'soulNotes';
    if (name.includes('pattern')) return 'patterns';
    if (name.includes('decision')) return 'decisions';
    return 'pages';
  }
  return 'others';
}

function parseMarkdownMeta(content) {
  const meta = {};
  // Extract Logseq-style properties: key:: value
  const propRegex = /^([\w\-]+)::\s*(.+)$/gm;
  let match;
  while ((match = propRegex.exec(content)) !== null) {
    meta[match[1].trim()] = match[2].trim();
  }
  return meta;
}

function scanBrain() {
  const start = Date.now();
  const index = { journals: [], pages: [], soulGuns: [], soulNotes: [], patterns: [], decisions: [], others: [] };
  let totalFiles = 0;
  let totalBytes = 0;

  function walkDir(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    const dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const dirEntry of dirEntries) {
      const fullPath = path.join(dirPath, dirEntry.name);
      if (dirEntry.isDirectory()) {
        if (!dirEntry.name.startsWith('.') && dirEntry.name !== 'node_modules') {
          walkDir(fullPath);
        }
      } else if (dirEntry.name.endsWith('.md')) {
        totalFiles++;
        const stats = fs.statSync(fullPath);
        totalBytes += stats.size;
        const content = fs.readFileSync(fullPath, 'utf8');
        const category = categorizeFile(fullPath);
        const relPath = path.relative(SESHAT_DIR, fullPath);

        const fileEntry = {
          path: relPath,
          fullPath: fullPath,
          name: dirEntry.name.replace('.md', ''),
          size: stats.size,
          modified: stats.mtime.toISOString(),
          category: category,
          meta: parseMarkdownMeta(content),
          preview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
          wordCount: content.split(/\s+/).length
        };

        if (!index[category]) index[category] = [];
        index[category].push(fileEntry);
      }
    }
  }

  walkDir(SESHAT_DIR);

  brainIndex = {
    ...index,
    totalFiles,
    sizeBytes: totalBytes,
    lastScan: new Date().toISOString(),
    scanTimeMs: Date.now() - start
  };

  console.log(`[SESHA] Brain scanned: ${totalFiles} files, ${(totalBytes/1024).toFixed(1)}KB in ${brainIndex.scanTimeMs}ms`);
  return brainIndex;
}

// ─── File Watcher ───────────────────────────────────────────

function startWatcher() {
  // Clear old watchers
  watchers.forEach(w => w.close());
  watchers = [];

  try {
    const watcher = fs.watch(SESHAT_DIR, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        console.log(`[SESHA] Brain changed: ${filename} (${eventType}) — rescanning`);
        scanBrain();
      }
    });
    watchers.push(watcher);
    console.log(`[SESHA] Watching ${SESHAT_DIR} for changes`);
  } catch (e) {
    console.log(`[SESHA] File watch unavailable: ${e.message}`);
  }
}

// ─── Search ─────────────────────────────────────────────────

/** Common English stop words to exclude from multi-word search scoring */
const STOP_WORDS = new Set([
  'a','an','the','is','it','its','was','were','be','been','being',
  'have','has','had','do','does','did','done','doing',
  'will','would','could','should','can','shall','may','might',
  'i','you','he','she','we','they','me','him','her','us','them',
  'this','that','these','those','my','your','his','its','our','their',
  'and','or','but','if','because','so','then','than','too','very',
  'not','no','nor','just','about','above','after','before','between',
  'up','down','in','out','on','off','over','under','again','further',
  'once','here','there','when','where','why','how','all','each','every',
  'both','few','more','most','other','some','such','only','own','same',
  'to','of','for','with','by','from','at','into','through','during',
  'what','which','who','whom','whose','today','yesterday','tomorrow',
  'please','tell','me','know','about','like','want','need','get',
]);

/**
 * TF-IDF-like relevance scoring for brain search.
 *
 * Scoring factors (combined into one relevance score):
 *  - Word frequency: more occurrences of query words = higher score
 *  - Position bonus: matches near the top (summary/frontmatter) score higher
 *  - Name match bonus: matches in the title/file name are strongest signal
 *  - Length normalization: short documents with dense matches score higher than long ones with sparse matches
 *  - Rarity bonus: rarer words contribute more (simple IDF approximation)
 */
function scoreDocument(content, name, metaText, queryWords, allDocsCount, docsWithWord) {
  const text = content.toLowerCase();
  const nameL = name.toLowerCase();
  const metaL = metaText.toLowerCase();
  const contentLen = text.length || 1;

  let totalScore = 0;
  let matchedCount = 0;

  for (const w of queryWords) {
    let wordScore = 0;

    // Name match (strongest signal — 10×)
    if (nameL.includes(w)) {
      wordScore += 10;
      // Bonus for exact name match or near-match
      if (nameL === w || nameL.startsWith(w + ' - ') || nameL.startsWith(w + ':')) {
        wordScore += 15;
      }
    }

    // Metadata match (3×)
    if (metaL.includes(w)) wordScore += 3;

    // Content frequency scoring
    if (text.includes(w)) {
      // Count occurrences (capped at 20 to prevent spam)
      let count = 0;
      let idx = -1;
      while ((idx = text.indexOf(w, idx + 1)) !== -1 && count < 20) {
        count++;
        // Position bonus: matches in first 500 chars get +1 each
        if (idx < 500) wordScore += 0.5;
        // Position bonus: matches in first 200 chars get additional +1
        if (idx < 200) wordScore += 0.5;
      }
      // TF component: log-normalized frequency
      wordScore += Math.log2(count + 1) * 2;

      // IDF approximation: rarer words contribute more
      const docsWithThis = docsWithWord.get(w) || 1;
      const idf = Math.log2((allDocsCount || 100) / docsWithThis);
      wordScore *= (0.5 + idf * 0.1); // Scale by rarity
    }

    // Length normalization bonus: short documents with matches get a boost
    if (wordScore > 0 && contentLen < 2000) {
      wordScore *= 1.2;
    } else if (wordScore > 0 && contentLen < 5000) {
      wordScore *= 1.1;
    }

    if (wordScore > 0) matchedCount++;
    totalScore += wordScore;
  }

  // Threshold: at least 60% of query words must contribute (for multi-word)
  // For single-word queries, any match passes
  if (queryWords.length > 1 && matchedCount / queryWords.length < 0.6) {
    return 0;
  }

  return Math.round(totalScore * 100) / 100;
}

function searchBrain(query, options = {}) {
  const q = query.toLowerCase();
  const results = [];
  const maxResults = options.limit || 20;

  // Split into words, filter stop words
  const words = q.split(/\s+/).filter(Boolean);
  const significantWords = words.filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const searchWords = significantWords.length > 0 ? significantWords : words;

  if (searchWords.length === 0) return [];

  const allEntries = [
    ...brainIndex.journals || [],
    ...brainIndex.pages || [],
    ...brainIndex.soulGuns || [],
    ...brainIndex.soulNotes || [],
    ...brainIndex.patterns || [],
    ...brainIndex.decisions || [],
    ...brainIndex.others || []
  ];

  if (allEntries.length === 0) return [];

  // Pre-scan: count how many docs contain each query word (for IDF)
  const docsWithWord = new Map();
  for (const w of searchWords) docsWithWord.set(w, 0);
  for (const entry of allEntries) {
    try {
      const contentSample = fs.readFileSync(entry.fullPath, 'utf8').toLowerCase();
      for (const w of searchWords) {
        if (contentSample.includes(w)) {
          docsWithWord.set(w, (docsWithWord.get(w) || 0) + 1);
        }
      }
    } catch { /* skip */ }
  }

  const totalDocs = allEntries.length;

  // Score each document
  for (const entry of allEntries) {
    try {
      const content = fs.readFileSync(entry.fullPath, 'utf8').toLowerCase();
      const nameLower = entry.name.toLowerCase();
      const metaText = Object.values(entry.meta).map(v => String(v).toLowerCase()).join(' ');

      const score = scoreDocument(content, nameLower, metaText, searchWords, totalDocs, docsWithWord);

      if (score > 0) {
        // Find context around the best match
        const bestWord = searchWords.find(w => content.includes(w)) || q;
        const idx = content.indexOf(bestWord);
        const contextStart = Math.max(0, idx - 80);
        const contextEnd = Math.min(content.length, idx + bestWord.length + 80);
        const context = idx >= 0
          ? (contextStart > 0 ? '...' : '') +
            content.substring(contextStart, contextEnd) +
            (contextEnd < content.length ? '...' : '')
          : entry.preview;

        results.push({
          path: entry.path,
          name: entry.name,
          category: entry.category,
          score,
          context,
          modified: entry.modified
        });
      }
    } catch (e) {
      // skip unreadable files
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ─── Soul Gun Forge ─────────────────────────────────────────

function forgeSoulGun(name, type, summary, content, tags) {
  const dateStr = new Date().toISOString().split('T')[0];
  const safeName = name.replace(/[^a-zA-Z0-9\- ]/g, '').trim().replace(/\s+/g, '-');
  const fileName = `SOUL-GUN - ${safeName}.md`;
  const filePath = path.join(SESHAT_DIR, 'pages', fileName);

  const body = `type:: [[soul-gun]]
created:: ${dateStr}
status:: [[forged]]
tags:: ${(tags || []).join(', ')}

## ${name}

**Type:** ${type}
**Summary:** ${summary}

---

${content}

---

— forged by **GSK** · ${dateStr}
`;

  fs.writeFileSync(filePath, body, 'utf8');
  console.log(`[SESHA] Soul Gun forged: ${fileName}`);

  // Rescan brain
  scanBrain();

  return {
    path: fileName,
    fullPath: filePath,
    type: 'soul-gun',
    name: safeName
  };
}

function forgeSoulNote(name, summary, content, tags) {
  const dateStr = new Date().toISOString().split('T')[0];
  const safeName = name.replace(/[^a-zA-Z0-9\- ]/g, '').trim().replace(/\s+/g, '-');
  const fileName = `SOUL-NOTE - ${safeName}.md`;
  const filePath = path.join(SESHAT_DIR, 'pages', fileName);

  const body = `type:: [[soul-note]]
created:: ${dateStr}
tags:: ${(tags || []).join(', ')}

## ${name}

**Summary:** ${summary}

---

${content}

---

— noted by **GSK** · ${dateStr}
`;

  fs.writeFileSync(filePath, body, 'utf8');
  console.log(`[SESHA] Soul Note forged: ${fileName}`);

  scanBrain();

  return {
    path: fileName,
    fullPath: filePath,
    type: 'soul-note',
    name: safeName
  };
}

function forgePattern(name, summary, content, tags) {
  const dateStr = new Date().toISOString().split('T')[0];
  const safeName = name.replace(/[^a-zA-Z0-9\- ]/g, '').trim().replace(/\s+/g, '-');
  const fileName = `PATTERN - ${safeName}.md`;
  const filePath = path.join(SESHAT_DIR, 'pages', fileName);

  const body = `type:: [[pattern]]
created:: ${dateStr}
tags:: ${(tags || []).join(', ')}

## ${name}

**Summary:** ${summary}

---

${content}

---

— learned by **GSK** · ${dateStr}
`;

  fs.writeFileSync(filePath, body, 'utf8');
  console.log(`[SESHA] Pattern forged: ${fileName}`);

  scanBrain();

  return {
    path: fileName,
    fullPath: filePath,
    type: 'pattern',
    name: safeName
  };
}

// ─── HTTP API ───────────────────────────────────────────────

function startServer(brain) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;
    const method = req.method;

    function sendJson(status, data) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    }

    function readBody() {
      return new Promise((resolve) => {
        if (method === 'GET' || method === 'HEAD') return resolve({});
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { resolve({}); }
        });
      });
    }

    try {
      // GET /ping
      if (method === 'GET' && pathname === '/ping') {
        return sendJson(200, {
          alive: true,
          name: 'SESHA',
          brain: brainIndex.totalFiles,
          lastScan: brainIndex.lastScan
        });
      }

      // GET /status — full brain index summary
      if (method === 'GET' && pathname === '/status') {
        return sendJson(200, {
          name: 'SESHA — GSK Hippocampus',
          brain: {
            totalFiles: brainIndex.totalFiles,
            sizeKB: (brainIndex.sizeBytes / 1024).toFixed(1),
            lastScan: brainIndex.lastScan,
            scanTimeMs: brainIndex.scanTimeMs,
            categories: {
              journals: (brainIndex.journals || []).length,
              pages: (brainIndex.pages || []).length,
              soulGuns: (brainIndex.soulGuns || []).length,
              soulNotes: (brainIndex.soulNotes || []).length,
              patterns: (brainIndex.patterns || []).length,
              decisions: (brainIndex.decisions || []).length
            }
          }
        });
      }

      // GET /category/:name — list files in a category
      const catMatch = pathname.match(/^\/category\/(\w+)$/);
      if (method === 'GET' && catMatch) {
        const cat = catMatch[1];
        const files = brainIndex[cat === 'all' ? 'pages' : cat];
        if (!files) return sendJson(404, { error: `Unknown category: ${cat}` });
        return sendJson(200, {
          category: cat,
          count: files.length,
          files: files.map(f => ({
            name: f.name,
            path: f.path,
            modified: f.modified,
            size: f.size,
            wordCount: f.wordCount,
            meta: f.meta
          }))
        });
      }

      // GET /read — read a file by path
      if (method === 'GET' && pathname === '/read') {
        const filePathParam = url.searchParams.get('path');
        if (!filePathParam) return sendJson(400, { error: 'path query param required' });
        const safePath = path.resolve(SESHAT_DIR, filePathParam);
        if (!safePath.startsWith(SESHAT_DIR)) return sendJson(403, { error: 'Path traversal denied' });
        if (!fs.existsSync(safePath)) return sendJson(404, { error: 'File not found' });
        const content = fs.readFileSync(safePath, 'utf8');
        return sendJson(200, {
          path: filePathParam,
          content,
          meta: parseMarkdownMeta(content),
          size: fs.statSync(safePath).size
        });
      }

      // POST /search — search across brain
      if (method === 'POST' && pathname === '/search') {
        const body = await readBody();
        if (!body.query) return sendJson(400, { error: 'query is required' });
        const results = searchBrain(body.query, { limit: body.limit || 20 });
        return sendJson(200, { query: body.query, count: results.length, results });
      }

      // POST /forge — forge a soul gun, soul note, or pattern
      if (method === 'POST' && pathname === '/forge') {
        const body = await readBody();
        if (!body.type || !body.name || !body.summary) {
          return sendJson(400, { error: 'type, name, and summary are required' });
        }

        let result;
        switch (body.type) {
          case 'soul-gun':
            result = forgeSoulGun(body.name, body.gunType || 'capability', body.summary, body.content || '', body.tags);
            break;
          case 'soul-note':
            result = forgeSoulNote(body.name, body.summary, body.content || '', body.tags);
            break;
          case 'pattern':
            result = forgePattern(body.name, body.summary, body.content || '', body.tags);
            break;
          default:
            return sendJson(400, { error: `Unknown forge type: ${body.type}. Use: soul-gun, soul-note, or pattern` });
        }

        return sendJson(200, { ok: true, forged: result });
      }

      // GET /learn — return content optimized for GSK context injection (brain dump)
      if (method === 'GET' && pathname === '/learn') {
        const limit = parseInt(url.searchParams.get('limit') || '5', 10);
        const category = url.searchParams.get('category') || 'all';

        let entries = [];
        if (category === 'all' || category === 'journals') {
          entries = entries.concat((brainIndex.journals || []).slice(0, limit));
        }
        if (category === 'all' || category === 'soulGuns') {
          entries = entries.concat((brainIndex.soulGuns || []).slice(0, limit));
        }
        if (category === 'all' || category === 'soulNotes') {
          entries = entries.concat((brainIndex.soulNotes || []).slice(0, limit));
        }
        if (category === 'all' || category === 'patterns') {
          entries = entries.concat((brainIndex.patterns || []).slice(0, limit));
        }
        if (category === 'all' || category === 'pages') {
          entries = entries.concat((brainIndex.pages || []).slice(0, limit));
        }

        const contents = entries.map(e => {
          try {
            return {
              name: e.name,
              path: e.path,
              content: fs.readFileSync(e.fullPath, 'utf8').substring(0, 2000)
            };
          } catch { return null; }
        }).filter(Boolean);

        return sendJson(200, {
          category,
          count: contents.length,
          brainSummary: {
            totalFiles: brainIndex.totalFiles,
            lastScan: brainIndex.lastScan
          },
          entries: contents
        });
      }

      sendJson(404, { error: 'Not found', path: pathname });
    } catch (e) {
      sendJson(500, { error: e.message });
    }
  });

  server.listen(PORT, () => {
    console.log('');
    console.log(`╔══════════════════════════════════════════╗`);
    console.log(`║     SESHA — SCRIBE'S BRAIN API           ║`);
    console.log(`║     Port: ${PORT}                          ║`);
    console.log(`║     Brain: ${brainIndex.totalFiles} files, ${(brainIndex.sizeBytes/1024).toFixed(0)}KB      ║`);
    console.log(`╚══════════════════════════════════════════╝`);
    console.log(`  GET  /ping              ← Health check`);
    console.log(`  GET  /status            ← Brain index summary`);
    console.log(`  GET  /category/:name    ← List files (journals/pages/soulGuns/soulNotes/patterns)`);
    console.log(`  GET  /read?path=...     ← Read a brain file`);
    console.log(`  POST /search            ← Search across all knowledge`);
    console.log(`  POST /forge             ← GSK forges new soul gun / note / pattern`);
    console.log(`  GET  /learn             ← Brain dump for GSK context injection`);
    console.log(`  GET  /eagle-eye         ← Feeds Eagle Eye captures`);
    console.log('');
  });

  return server;
}

// ─── Main ───────────────────────────────────────────────────

console.log('[SESHA] Booting GSK Hippocampus...');
console.log(`[SESHA] Seshat directory: ${SESHAT_DIR}`);

// Initial scan
scanBrain();

// Start file watcher
startWatcher();

// Start API server
const server = startServer(brainIndex);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[SESHA] Shutting down...');
  watchers.forEach(w => w.close());
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  watchers.forEach(w => w.close());
  server.close();
  process.exit(0);
});
