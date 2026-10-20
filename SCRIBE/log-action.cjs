#!/usr/bin/env node
/**
 * log-action.cjs — SCRIBE Eagle Eye Capture Tool
 *
 * Usage:
 *   node log-action.cjs <type> <summary> [tags] [content]
 *
 * Examples:
 *   node log-action.cjs "tool_call" "bash: git push origin publish" "git,push,build"
 *   node log-action.cjs "edit" "Updated YOU-ARE-HERE.md" "docs,seshat"
 *   node log-action.cjs "webfetch" "Fetched three.js docs" "research,threejs"
 *   node log-action.cjs "websearch" "Searched Big Brother surveillance patterns" "research,architecture"
 *   node log-action.cjs "git" "Commit abc123: P28 reaction persistence" "git,ship"
 *   node log-action.cjs "file_change" "Created log-action.cjs" "build,scribe"
 *
 * Environment variable: SCRIBE_URL (default: http://127.0.0.1:4000)
 */

const http = require('http');
const https = require('https');

const SCRIBE_URL = process.env.SCRIBE_URL || 'http://127.0.0.1:4000';
const [,, type, summary, tags, content] = process.argv;

if (!type || !summary) {
  console.error('Usage: node log-action.cjs <type> <summary> [tags] [content]');
  process.exit(1);
}

const memoryEntry = {
  id: `eye_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  ts: new Date().toISOString(),
  type: type || 'observation',
  summary: summary,
  content: content || '',
  tags: (tags || '').split(',').filter(Boolean),
  weight: 0.8,
  source: {
    system: 'profit',
    chamber: 'eagle_eye',
    pid: process.pid,
    cwd: process.cwd()
  }
};

const body = JSON.stringify(memoryEntry);
const url = new URL(SCRIBE_URL);
const client = url.protocol === 'https:' ? https : http;

const req = client.request(
  `${SCRIBE_URL}/memory`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  },
  (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode < 300) {
        console.log(`✓ SCRIBE logged [${type}]: ${summary}`);
      } else {
        console.error(`✗ SCRIBE error ${res.statusCode}: ${data}`);
      }
    });
  }
);

req.on('error', (err) => {
  console.error(`✗ SCRIBE unreachable: ${err.message}`);
});

req.write(body);
req.end();
