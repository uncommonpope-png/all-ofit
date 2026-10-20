#!/usr/bin/env node
/**
 * growth-loop.cjs — GSK's Perpetual Learning & Growth Loop
 *
 * Runs periodically to:
 * 1. Scan Seshat Brain and SCRIBE for new content
 * 2. Extract patterns from recent activity
 * 3. Learn from mistakes (failed builds, errors)
 * 4. Forge new soul guns, notes, and patterns
 * 5. Continuously expand his own knowledge
 *
 * This is the self-improvement loop that makes GSK's brain
 * grow forever without manual intervention.
 */

const http = require('http');

const SESHA_URL = 'http://127.0.0.1:5000';
const SCRIBE_URL = 'http://127.0.0.1:4000';
const LOOP_INTERVAL_MS = parseInt(process.env.GROWTH_INTERVAL || '300000', 10); // 5 min default

function apiPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const client = u.protocol === 'https:' ? require('https') : http;
    const req = client.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve({ raw: d }); }
      });
    });
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

function apiGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? require('https') : http;
    client.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve({ raw: d }); }
      });
    }).on('error', reject);
  });
}

// ─── Learning Functions ─────────────────────────────────────

async function learnFromRecentActivity() {
  try {
    // 1. Get recent memories from SCRIBE
    const scribeMemories = await apiGet(SCRIBE_URL + '/memory?limit=20');
    const recentMemories = scribeMemories.recent || [];

    // 2. Get recent brain changes
    const brainStatus = await apiGet(SESHA_URL + '/status');
    
    // 3. Check for errors in recent memories
    const errors = recentMemories.filter(m => 
      m.summary && (m.summary.toLowerCase().includes('error') || 
                     m.summary.toLowerCase().includes('fail') ||
                     m.summary.toLowerCase().includes('broken'))
    );

    // 4. Check for new content in the brain
    const newJournals = brainStatus.brain?.categories?.journals || 0;

    return {
      totalMemories: recentMemories.length,
      errors: errors.length,
      brainFilesTotal: brainStatus.brain?.totalFiles || 0,
      newJournals,
      recentErrors: errors.map(e => e.summary).slice(0, 5)
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function forgeFromPatterns() {
  try {
    // Search for patterns that could be extracted
    const scribeRecent = await apiGet(SCRIBE_URL + '/memory?limit=10');
    const entries = scribeRecent.recent || [];
    
    // Find repeated patterns (same tag or type appearing multiple times)
    const typeCounts = {};
    for (const e of entries) {
      if (e.type) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    }

    // If tool_call type appears 5+ times, note the pattern
    for (const [type, count] of Object.entries(typeCounts)) {
      if (count >= 5 && type !== 'observation') {
        // Forge a pattern observation
        await apiPost(SCRIBE_URL + '/memory', {
          type: 'pattern',
          summary: `Growth loop detected pattern: ${count} entries of type '${type}' in recent memory`,
          tags: ['pattern', 'growth-loop', type],
          weight: 0.6,
          source: { system: 'growth_loop' }
        });
        console.log(`[GROWTH] Detected pattern: ${type} × ${count}`);
      }
    }

    return { typeCounts };
  } catch (e) {
    return { error: e.message };
  }
}

async function learnFromMistakes() {
  try {
    // Search SCRIBE for errors
    const errors = await apiPost(SCRIBE_URL + '/memory/recall', {
      query: 'error fail broken crash',
      limit: 5
    });

    if (errors.results && errors.results.length > 0) {
      for (const err of errors.results) {
        // Check if we already have a lesson learned from this
        const existing = await apiPost(SESHA_URL + '/search', {
          query: 'lesson learned ' + (err.summary || '').substring(0, 40),
          limit: 1
        });

        if (existing.count === 0) {
          // Forge a lesson-learned pattern
          const lessonName = 'Lesson from: ' + (err.summary || '').substring(0, 60).replace(/[^a-zA-Z0-9 ]/g, '');
          await apiPost(SESHA_URL + '/forge', {
            type: 'pattern',
            name: lessonName,
            gunType: 'lesson',
            summary: `Learned from past mistake: ${err.summary || 'unknown error'}`,
            content: `## What happened\n\n${err.summary || 'Unknown'}\n\n## Context\n\n${err.content || ''}\n\n## Lesson\n\nAutomatically extracted by growth loop. This mistake should not be repeated.\n\n## Related tags\n\n${(err.tags || []).join(', ')}`,
            tags: ['lesson', 'mistake', 'growth-loop'].concat(err.tags || [])
          });
          console.log(`[GROWTH] Learned from mistake: ${err.summary?.substring(0, 60)}`);
        }
      }
    }
    return { learned: errors.results?.length || 0 };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Sleeptime Agent: Archival Context Curation ────────────

async function curateArchivalContext() {
  try {
    // 1. Get high-weight memories from SCRIBE (last 10 significant)
    const recallResult = await apiPost(SCRIBE_URL + '/memory/recall', {
      query: '', limit: 15, minWeight: 0.7
    });
    const significant = (recallResult.results || []).filter(m => m.weight >= 0.7);

    // 2. Get recent git commits
    const gitCommits = (recallResult.results || []).filter(m => m.type === 'git_commit').slice(0, 5);

    // 3. Build archival context block content
    const lines = [];

    // Header with summary
    const now = new Date().toISOString();
    lines.push(`[Sleeptime Agent — Last curated ${now}]`);
    lines.push(`Significant memories in working set: ${significant.length}/${recallResult.results?.length || 0}`);
    lines.push('');

    // Recent git activity
    if (gitCommits.length > 0) {
      lines.push('── Recent Git Activity ──');
      for (const g of gitCommits) {
        const date = new Date(g.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        lines.push(`  [${date}] ${g.summary || ''}`);
      }
      lines.push('');
    }

    // Find thematic connections
    const allTags = new Map();
    for (const m of significant) {
      for (const tag of (m.tags || [])) {
        allTags.set(tag, (allTags.get(tag) || 0) + 1);
      }
    }
    const topTags = [...allTags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (topTags.length > 0) {
      lines.push('── Active Themes ──');
      for (const [tag, count] of topTags) {
        lines.push(`  ${tag} (${count})`);
      }
      lines.push('');
    }

    // Recent high-weight events
    lines.push('── Notable Recent Events ──');
    for (const m of significant.slice(0, 8)) {
      const date = new Date(m.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      lines.push(`  [${m.weight.toFixed(2)}] [${date}] ${(m.summary || '').substring(0, 150)}`);
    }

    // 4. Update the archival_context block via SCRIBE's context API
    const contextBody = JSON.stringify({
      label: 'archival_context',
      content: lines.join('\n'),
    });

    return await new Promise((resolve, reject) => {
      const u = new URL(SCRIBE_URL);
      const client = u.protocol === 'https:' ? require('https') : require('http');
      const req = client.request(SCRIBE_URL + '/context/rethink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(contextBody) }
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch { resolve({ ok: false, raw: d }); }
        });
      });
      req.on('error', reject);
      req.write(contextBody);
      req.end();
    });
  } catch (e) {
    return { error: e.message };
  }
}

async function surfaceConnections() {
  try {
    // Find connections between recent git commits and existing soul guns/patterns
    const recentMemories = await apiPost(SCRIBE_URL + '/memory/recall', {
      query: 'git_commit', limit: 10
    });
    const commits = (recentMemories.results || []).filter(m => m.type === 'git_commit');

    // Check if any commits relate to existing patterns in the brain
    for (const commit of commits) {
      const summary = commit.summary || '';
      // Extract keywords from commit message
      const keywords = summary
        .replace(/[\[\]]/g, '')
        .split(/[\s/:]+/)
        .filter(w => w.length > 3 && !['the','this','that','with','from','feat','genesis','add'].includes(w.toLowerCase()))
        .slice(0, 3);

      if (keywords.length === 0) continue;

      // Search Seshat Brain for related knowledge
      await apiPost(SESHA_URL + '/search', {
        query: keywords.join(' '),
        limit: 3
      });
    }
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Main Loop ──────────────────────────────────────────────

async function growthCycle() {
  console.log(`\n[GROWTH] Loop cycle at ${new Date().toISOString()}`);

  try {
    // Phase 1: Learn from recent activity
    const activity = await learnFromRecentActivity();
    console.log(`[GROWTH] Activity: ${activity.totalMemories} memories, ${activity.errors} errors, ${activity.brainFilesTotal} brain files`);

    // Phase 2: Extract patterns
    const patterns = await forgeFromPatterns();
    
    // Phase 3: Learn from mistakes
    const mistakes = await learnFromMistakes();

    // Phase 4: Curate archival context (sleeptime agent's primary job)
    const contextResult = await curateArchivalContext();
    console.log(`[GROWTH] Archival context curated: ${contextResult.ok ? 'OK' : 'FAIL'} ${contextResult.error || ''}`);

    // Phase 5: Surface connections between current and past
    const connections = await surfaceConnections();

    // Phase 6: Log the cycle
    await apiPost(SCRIBE_URL + '/memory', {
      type: 'growth_cycle',
      summary: `Sleeptime cycle: ${activity.totalMemories} memories scanned, ${mistakes.learned || 0} lessons, context curated ${contextResult.ok ? '✓' : '✗'}`,
      tags: ['sleeptime', 'cycle', 'growth-loop'],
      weight: 0.5,
      source: { system: 'sleeptime_agent' }
    });

    console.log(`[GROWTH] Sleeptime cycle complete. Next in ${LOOP_INTERVAL_MS/1000}s`);
  } catch (e) {
    console.error(`[GROWTH] Cycle error: ${e.message}`);
    // Don't crash the loop on errors
  }
}

// ─── Boot ───────────────────────────────────────────────────

console.log('');
console.log(`╔══════════════════════════════════════════╗`);
console.log(`║     SCRIBE SLEEPTIME AGENT               ║`);
console.log(`║     (Letta-style archival memory agent)  ║`);
console.log(`║     Interval: ${(LOOP_INTERVAL_MS/1000)}s                     ║`);
console.log(`║     Sesha: ${SESHA_URL}                   ║`);
console.log(`║     SCRIBE: ${SCRIBE_URL}                  ║`);
console.log(`╚══════════════════════════════════════════╝`);

// Run first cycle immediately, then on interval
growthCycle();
setInterval(growthCycle, LOOP_INTERVAL_MS);

process.on('SIGINT', () => { console.log('\n[GROWTH] Stopping'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[GROWTH] Stopping'); process.exit(0); });
