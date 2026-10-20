#!/usr/bin/env node
/**
 * git-hook.cjs — Called by git post-commit hooks to log commits to SCRIBE
 * 
 * Used via .git/hooks/post-commit:
 *   node "C:\Users\uncom\Desktop\GSK-SOUL-OS\apps\scribe\git-hook.cjs"
 */

const { execSync } = require('child_process');
const http = require('http');

try {
  // Use shell:false + execFile to avoid cmd.exe interpreting % vars on Windows
  const { execFileSync } = require('child_process');
  const logOutput = execFileSync('git', ['log', '-1', '--format=%H|%an|%s|%ct'], { 
    encoding: 'utf8', 
    timeout: 5000,
    windowsHide: true 
  }).trim();
  
  const [hash, author, subject, timestamp] = logOutput.split('|');
  const repoPath = (process.cwd() || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'unknown';

  const entry = {
    id: `eye_git_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type: 'git_commit',
    summary: `[${repoPath}] ${subject}`,
    content: `Commit ${hash} by ${author}\nRepo: ${repoPath}\nSubject: ${subject}`,
    tags: ['git', 'commit', repoPath],
    weight: 0.9,
    source: { system: 'git_hook', chamber: 'eagle_eye', repo: repoPath, commit: hash }
  };

  const body = JSON.stringify(entry);
  const req = http.request('http://127.0.0.1:4000/memory', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  });
  
  req.on('error', () => { /* silent — never break git */ });
  req.write(body);
  req.end();
} catch (e) {
  // silent — never break git
}
