'use strict';

/**
 * SCRIBE — Memory System
 *
 * SCRIBE's memory is causal. Every entry knows:
 *   - what it IS (type, content, timestamp)
 *   - what CAUSED it (parent_id)
 *   - what it LED TO (child_ids, filled in later)
 *   - what it MEANS (summary, tags, weight)
 *
 * This mirrors the AGM memory format intentionally.
 * When SCRIBE and the Kernel meet, their memories can be compared
 * and linked across systems.
 *
 * Format: JSONL (one JSON object per line) — append-only, never rewritten.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Memory {
  constructor(ledgerPath) {
    this.ledgerPath = ledgerPath || path.join(__dirname, '../../data/ledger.jsonl');
    this.statePath  = path.join(path.dirname(this.ledgerPath), 'state.json');

    // In-memory working set (configurable max entries)
    this.working = [];
    this.maxWorking = parseInt(process.env.MAX_MEMORY_WORKING || '2000', 10);

    // Index: id → entry (for causal lookups)
    this.index = new Map();

    // Debounce state writes — only flush when 10+ patches accumulated
    this._pendingStatePatch = {};

    this._ensureFiles();
    this._load();
  }

  _ensureFiles() {
    const dir = path.dirname(this.ledgerPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.ledgerPath)) {
      fs.writeFileSync(this.ledgerPath, '');
    }
    if (!fs.existsSync(this.statePath)) {
      this._writeState({ booted_at: new Date().toISOString(), total_memories: 0 });
    }
  }

  _load() {
    const raw = fs.readFileSync(this.ledgerPath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        this.index.set(entry.id, entry);
        this.working.push(entry);
      } catch { /* corrupt line — skip */ }
    }

    // Keep working set within limit — sort by weight descending so high-value entries survive
    if (this.working.length > this.maxWorking) {
      this.working.sort((a, b) => b.weight - a.weight);
      this.working = this.working.slice(0, this.maxWorking);
    }
  }

  /**
   * Record a new memory.
   *
   * @param {object} params
   * @param {string} params.type        — 'observation'|'decision'|'conflict'|'reading'|'verdict'|'contact'
   * @param {string} params.summary     — what happened, in one sentence
   * @param {string} [params.content]   — fuller detail (optional)
   * @param {string} [params.parent_id] — the memory that caused this one
   * @param {string[]} [params.tags]    — searchable labels
   * @param {number} [params.weight]    — 0–1, how significant (default 0.5)
   * @param {object} [params.source]    — { system, chamber } where this came from
   * @returns {object} the stored memory entry
   */
  record(params) {
    if (!params.summary) throw new Error('memory.record: summary is required');
    const entry = {
      id: this._newId(),
      ts: new Date().toISOString(),
      type: params.type || 'observation',
      summary: params.summary,
      content: params.content || null,
      parent_id: params.parent_id || null,
      child_ids: [],
      tags: params.tags || [],
      weight: typeof params.weight === 'number' ? params.weight : 0.5,
      source: params.source || { system: 'SCRIBE', chamber: null },
      outcome: params.outcome || null,
    };

    // Link: update parent's child_ids and persist to ledger
    if (entry.parent_id && this.index.has(entry.parent_id)) {
      const parent = this.index.get(entry.parent_id);
      parent.child_ids.push(entry.id);
      this._rewriteEntry(parent);
    }

    // Write to ledger
    fs.appendFileSync(this.ledgerPath, JSON.stringify(entry) + '\n');

    // Update index and working set
    this.index.set(entry.id, entry);
    this.working.push(entry);
    if (this.working.length > this.maxWorking) {
      this.working.sort((a, b) => b.weight - a.weight);
      this.working = this.working.slice(0, this.maxWorking);
    }

    // Update state — debounced, flush every 10 records
    this._updateState({ total_memories: this.index.size, last_memory_at: entry.ts });

    return entry;
  }

  /**
   * Recall memories relevant to a query.
   * Simple tag + summary keyword match — no embeddings needed.
   *
   * @param {string} query
   * @param {object} opts
   * @param {number} opts.limit     — max results (default 10)
   * @param {string} opts.type      — filter by type
   * @param {number} opts.minWeight — minimum weight threshold
   * @returns {object[]} matching entries, sorted by weight desc
   */
  /** Stop words too common to be useful in search */
  static STOP_WORDS = new Set([
    'a','an','the','is','it','it\'s','its','was','were','be','been','being',
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

  recall(query, opts = {}) {
    const { limit = 10, type = null, minWeight = 0 } = opts;
    const lower = query.toLowerCase();
    const words = lower.split(/\s+/).filter(Boolean);
    const significantWords = words.filter(w => w.length > 2 && !Memory.STOP_WORDS.has(w));

    // If we have significant words, use those; otherwise fall back to all words
    const searchWords = significantWords.length > 0 ? significantWords : words;

    const matches = this.working.filter(e => {
      if (type && e.type !== type) return false;
      if (e.weight < minWeight) return false;

      const searchText = [
        (e.summary || '').toLowerCase(),
        (e.content || '').toLowerCase(),
        ...e.tags.map(t => t.toLowerCase()),
      ].join(' ');

      // Word-level matching — uses a threshold that balances precision and recall:
      // - For 1-2 significant words: ALL must match (precise, like "P105 audit")
      // - For 3+ significant words: 60% threshold (tolerant, like "what did profit build today cosmic pyramid library")
      // - Stop-word-only queries: 60% of all words must match
      if (searchWords.length > 1) {
        const matched = searchWords.filter(w => searchText.includes(w));
        const threshold = searchWords.length <= 2 ? searchWords.length : Math.ceil(searchWords.length * 0.6);
        return matched.length >= threshold;
      }
      if (words.length > 1 && searchWords.length === 0) {
        // Only stop words — be lenient: at least 60% must match
        const matched = words.filter(w => searchText.includes(w));
        return matched.length / words.length >= 0.6;
      }

      // Single word: direct substring match
      return searchText.includes(lower);
    });

    return matches
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit);
  }

  /**
   * Follow causal chain from a memory id outward (parents and children).
   * Returns the chain as an ordered array from root → leaf.
   */
  causalChain(id) {
    const chain = [];
    let current = this.index.get(id);
    if (!current) return chain;

    // Walk up to root
    const ancestors = [];
    let cursor = current;
    const seen = new Set([id]);
    while (cursor.parent_id) {
      if (seen.has(cursor.parent_id)) break; // cycle guard
      seen.add(cursor.parent_id);
      const parent = this.index.get(cursor.parent_id);
      if (!parent) break;
      ancestors.unshift(parent);
      cursor = parent;
    }

    chain.push(...ancestors, current);

    // Walk down first child path
    cursor = current;
    while (cursor.child_ids && cursor.child_ids.length > 0) {
      const child = this.index.get(cursor.child_ids[0]);
      if (!child) break;
      chain.push(child);
      cursor = child;
    }

    return chain;
  }

  /**
   * The most recent N memories.
   */
  recent(n = 10) {
    return this.working.slice(-n).reverse();
  }

  /**
   * Import memories from the AGM memories.jsonl format.
   * Merges them into SCRIBE's ledger, tagged with source 'agm'.
   */
  importFromAGM(jsonlText) {
    const lines = jsonlText.trim().split('\n').filter(Boolean);
    const imported = [];

    for (const line of lines) {
      try {
        const agmEntry = JSON.parse(line);
        // Only import if not already present (check by original id in tags)
        const alreadyHave = [...this.index.values()].some(
          e => e.tags.includes(`agm:${agmEntry.id}`)
        );
        if (alreadyHave) continue;

        const entry = this.record({
          type: agmEntry.type || 'observation',
          summary: agmEntry.summary,
          content: JSON.stringify(agmEntry),
          tags: [
            ...(agmEntry.tags || []),
            `agm:${agmEntry.id}`,
            'imported',
          ],
          weight: agmEntry.impact_score || 0.5,
          source: { system: 'AGM', chamber: 'agm_memories' },
          outcome: agmEntry.outcome || null,
        });

        imported.push(entry.id);
      } catch { /* skip malformed */ }
    }

    return imported;
  }

  /**
   * State helpers
   */
  _writeState(state) {
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2) + '\n');
  }

  _updateState(patch) {
    Object.assign(this._pendingStatePatch, patch);
    if (Object.keys(this._pendingStatePatch).length >= 10) {
      this._flushState();
    }
  }

  _flushState() {
    if (Object.keys(this._pendingStatePatch).length === 0) return;
    let state = {};
    try { state = JSON.parse(fs.readFileSync(this.statePath, 'utf-8')); } catch { /* ok */ }
    Object.assign(state, this._pendingStatePatch);
    this._writeState(state);
    this._pendingStatePatch = {};
  }

  getState() {
    try { return JSON.parse(fs.readFileSync(this.statePath, 'utf-8')); } catch { return {}; }
  }

  _newId() {
    return 'scribe_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  }

  _rewriteEntry(updatedEntry) {
    const lines = fs.readFileSync(this.ledgerPath, 'utf-8').trim().split('\n').filter(Boolean);
    const newLines = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.id === updatedEntry.id) {
          newLines.push(JSON.stringify(updatedEntry));
        } else {
          newLines.push(line);
        }
      } catch {
        newLines.push(line);
      }
    }
    fs.writeFileSync(this.ledgerPath, newLines.join('\n') + '\n');
  }

  get size() {
    return this.index.size;
  }
}

module.exports = { Memory };
