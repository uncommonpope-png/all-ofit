'use strict';

/**
 * Context Blocks Engine — SCRIBE's structured memory context system
 *
 * Inspired by Letta AI's Archival Memory System:
 * - Core blocks always in context (identity, summary, recent activity)
 * - Archival context block dynamically curated by sleeptime agent
 * - Block-level memory editing (rethink, replace, insert)
 *
 * Blocks are stored as a JSON file and read/written by SCRIBE and
 * the growth loop (sleeptime agent).
 */

const fs = require('fs');
const path = require('path');

const BLOCKS_PATH = path.join(__dirname, '../../data/context-blocks.json');

/** Default block definitions */
const DEFAULT_BLOCKS = {
  identity: {
    label: 'identity',
    description: 'SCRIBE\'s core identity — always injected',
    limit: 2000,
    content: '',
    updatedAt: null,
    autoUpdate: false,
  },
  memory_summary: {
    label: 'memory_summary',
    description: 'Summary of what SCRIBE knows — memory statistics',
    limit: 2000,
    content: '',
    updatedAt: null,
    autoUpdate: true,
  },
  recent_activity: {
    label: 'recent_activity',
    description: 'Recent high-weight events and observations',
    limit: 3000,
    content: '',
    updatedAt: null,
    autoUpdate: true,
  },
  archival_context: {
    label: 'archival_context',
    description: 'Dynamic context bridge — curated by sleeptime agent from high-significance memories',
    limit: 3000,
    content: '',
    updatedAt: null,
    autoUpdate: false, // Updated by sleeptime agent (growth loop)
  },
};

class ContextEngine {
  constructor(memory) {
    this.memory = memory; // Reference to Memory instance
    this.blocks = this._load();
    this._dirty = false;

    // Auto-update blocks that should reflect live state
    this._updateInterval = setInterval(() => this._autoUpdate(), 30000); // 30s
  }

  _load() {
    try {
      if (fs.existsSync(BLOCKS_PATH)) {
        const raw = fs.readFileSync(BLOCKS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        // Merge with defaults so new blocks appear
        const merged = { ...DEFAULT_BLOCKS };
        for (const [key, val] of Object.entries(parsed)) {
          if (merged[key]) {
            merged[key] = { ...merged[key], ...val };
          } else {
            merged[key] = val;
          }
        }
        return merged;
      }
    } catch (e) {
      // Fall through to defaults
    }
    return { ...DEFAULT_BLOCKS };
  }

  _save() {
    try {
      const dir = path.dirname(BLOCKS_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const toStore = {};
      for (const [key, block] of Object.entries(this.blocks)) {
        toStore[key] = {
          label: block.label,
          description: block.description,
          limit: block.limit,
          content: block.content,
          updatedAt: block.updatedAt,
          autoUpdate: block.autoUpdate,
        };
      }
      fs.writeFileSync(BLOCKS_PATH, JSON.stringify(toStore, null, 2));
      this._dirty = false;
    } catch (e) {
      console.error('[CONTEXT] Failed to save blocks:', e.message);
    }
  }

  /**
   * Read a block's content.
   */
  read(label) {
    const block = this.blocks[label];
    return block ? block.content : null;
  }

  /**
   * Write/rethink a block — replaces entire content.
   * Letta's `memory_rethink` equivalent.
   */
  rethink(label, content) {
    if (!this.blocks[label]) {
      this.blocks[label] = {
        label,
        description: 'Dynamic block',
        limit: 3000,
        content: '',
        updatedAt: null,
        autoUpdate: false,
      };
    }
    const block = this.blocks[label];
    block.content = content.substring(0, block.limit);
    block.updatedAt = new Date().toISOString();
    this._dirty = true;
    this._save();
    return { ok: true, label, length: block.content.length, limit: block.limit };
  }

  /**
   * Replace a substring within a block — Letta's `memory_replace` equivalent.
   */
  replace(label, search, replacement) {
    const block = this.blocks[label];
    if (!block) return { ok: false, error: `Block "${label}" not found` };
    if (!block.content.includes(search)) {
      return { ok: false, error: `Substring not found in block "${label}"` };
    }
    block.content = block.content.replace(search, replacement);
    block.updatedAt = new Date().toISOString();
    this._dirty = true;
    this._save();
    return { ok: true, label, occurrences: (block.content.match(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length };
  }

  /**
   * Insert lines at a specific location within a block — Letta's `memory_insert` equivalent.
   */
  insert(label, afterLine, text) {
    const block = this.blocks[label];
    if (!block) return { ok: false, error: `Block "${label}" not found` };
    const lines = block.content.split('\n');
    const idx = afterLine === -1 ? lines.length - 1 : lines.findIndex(l => l.trim() === afterLine.trim());
    if (idx === -1) {
      // Append
      block.content += (block.content ? '\n' : '') + text;
    } else {
      lines.splice(idx + 1, 0, text);
      block.content = lines.join('\n');
    }
    block.content = block.content.substring(0, block.limit);
    block.updatedAt = new Date().toISOString();
    this._dirty = true;
    this._save();
    return { ok: true, label };
  }

  /**
   * Get all blocks as a formatted string for context injection.
   */
  getFormattedContext() {
    const parts = [];
    for (const block of Object.values(this.blocks)) {
      if (block.content) {
        parts.push(`<${block.label}>\n${block.content}\n</${block.label}>`);
      }
    }
    return parts.join('\n\n');
  }

  /**
   * Get block stats.
   */
  getStats() {
    const stats = {};
    for (const [key, block] of Object.entries(this.blocks)) {
      stats[key] = {
        length: block.content.length,
        limit: block.limit,
        pct: Math.round((block.content.length / block.limit) * 100),
        updatedAt: block.updatedAt,
        autoUpdate: block.autoUpdate,
      };
    }
    return stats;
  }

  /**
   * Auto-update blocks marked autoUpdate (memory_summary, recent_activity).
   */
  _autoUpdate() {
    if (!this.memory) return;
    try {
      // Update memory_summary block
      const summary = this.blocks.memory_summary;
      if (summary && summary.autoUpdate) {
        const state = this.memory.getState();
        const recent = this.memory.recent(5);
        summary.content = [
          `Total memories: ${this.memory.size}`,
          `Last memory at: ${state.last_memory_at || 'unknown'}`,
          `Booted at: ${state.booted_at || 'unknown'}`,
          '',
          'Recent entries:',
          ...recent.filter(m => m.weight >= 0.7).map(m =>
            `  - [${m.weight.toFixed(2)}] ${(m.summary || '').substring(0, 120)}`
          ),
        ].join('\n').substring(0, summary.limit);
        summary.updatedAt = new Date().toISOString();
        this._dirty = true;
      }

      // Update recent_activity block
      const activity = this.blocks.recent_activity;
      if (activity && activity.autoUpdate) {
        const highWeight = this.memory.recall('', { limit: 8, minWeight: 0.7 });
        activity.content = highWeight.map(m => {
          const date = new Date(m.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          return `[${m.weight.toFixed(2)}] [${date}] ${(m.summary || '').substring(0, 150)}`;
        }).join('\n').substring(0, activity.limit);
        activity.updatedAt = new Date().toISOString();
        this._dirty = true;
      }

      if (this._dirty) this._save();
    } catch (e) {
      // Silent — don't break SCRIBE for context
    }
  }

  /**
   * Cleanup.
   */
  destroy() {
    if (this._updateInterval) clearInterval(this._updateInterval);
    if (this._dirty) this._save();
  }
}

module.exports = { ContextEngine };
