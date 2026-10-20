'use strict';

// cline.js — SCRIBE's Cline harness via @cline/sdk
// Lets SCRIBE use Cline's agent runtime as a sub-agent for deep research,
// code generation, and autonomous building. Uses SCRIBE's brain context.

let _memory = null;
function setMemory(m) { _memory = m; }

const MANIFEST = {
  name: 'cline',
  description: 'SCRIBE harness for Cline agent via @cline/sdk — deep research, code generation, autonomous building. Ops: research, code, build, ask. Uses SCRIBE brain context.',
  version: '1.0.0',
  inputs: {
    op:      { type: 'string', required: true, description: '"research"|"code"|"build"|"ask"' },
    prompt:  { type: 'string', required: true, description: 'Task for Cline to execute' },
    cwd:     { type: 'string', required: false, description: 'Working directory' },
    timeout: { type: 'number', required: false, description: 'Timeout in ms (default 60000)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    output: 'string — Cline response',
    error:  'string — present if ok is false',
    ts:     'string',
  },
};

let _agent = null;
let _sdkModule = null;

async function _ensureAgent() {
  if (_agent) return _agent;

  try {
    if (!_sdkModule) {
      _sdkModule = await import('@cline/sdk');
    }
    const { Agent } = _sdkModule;
    _agent = new Agent({
      providerId: process.env.CLINE_PROVIDER || 'anthropic',
      modelId: process.env.CLINE_MODEL || 'claude-sonnet-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLINE_API_KEY,
      maxIterations: 3,
    });
    return _agent;
  } catch (e) {
    throw new Error(`@cline/sdk not installed or API key missing: ${e.message}. Install with: npm install @cline/sdk`);
  }
}

async function run({ op, prompt, cwd = process.cwd(), timeout = 60000 }) {
  if (!op || !prompt) return err('op and prompt are required');

  const ts = new Date().toISOString();

  // Inject SCRIBE's brain context
  let memoryContext = '';
  if (_memory) {
    try {
      const memories = _memory.query({ query: prompt.substring(0, 100), limit: 5 });
      if (memories && memories.length > 0) {
        memoryContext = memories.map(m => `- ${m.summary || m.content.substring(0, 200)}`).join('\n');
      }
    } catch (_) {}
  }

  const enhancedPrompt = memoryContext
    ? `${prompt}\n\nSCRIBE Brain Context (related memories):\n${memoryContext}`
    : prompt;

  const fullPrompt = _formatPrompt(op, enhancedPrompt);

  // Try SDK first (if API key available)
  if (process.env.ANTHROPIC_API_KEY || process.env.CLINE_API_KEY) {
    try {
      const agent = await _ensureAgent();
      let output = '';

      agent.subscribe((event) => {
        if (event.type === 'assistant-text-delta') {
          output += event.text ?? '';
        }
      });

      await agent.run(fullPrompt);
      return { ok: true, op, output: output.trim(), ts };
    } catch (e) {
      // Fall through to CLI fallback
    }
  }

  // Fallback: spawn cline CLI
  try {
    const result = await _invokeClineCLI(fullPrompt, cwd, timeout);
    return { ok: true, op, output: result, ts };
  } catch (e) {
    return err(e.message, op);
  }
}

function _formatPrompt(op, prompt) {
  const prefixes = {
    research: 'You are a research agent. Study this topic deeply and return actionable insights with implementation patterns:',
    code: 'You are a code generation agent. Generate clean, working code for this requirement:',
    build: 'You are a build agent. Implement this feature following existing code patterns:',
    ask: 'You are an expert assistant. Answer this question concisely:',
  };

  return `${prefixes[op] || prefixes.ask}\n\n${prompt}\n\nReturn your response as clean markdown.`;
}

function err(message, op = null) {
  return { ok: false, op, output: null, error: message, ts: new Date().toISOString() };
}

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

function _findClineCmd() {
  if (process.env.CLINE_CMD) return process.env.CLINE_CMD;
  if (process.platform === 'win32') {
    const npmDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null;
    if (npmDir) {
      const cmdPath = path.join(npmDir, 'cline.cmd');
      try { if (require('fs').existsSync(cmdPath)) return cmdPath; } catch (_) {}
    }
  }
  return 'cline';
}

function _invokeClineCLI(prompt, cwd, timeout) {
  return new Promise((resolve, reject) => {
    const clineCmd = _findClineCmd();

    // On Windows, use PowerShell to properly quote the multi-line prompt
    if (process.platform === 'win32') {
      const psScript = `$p = ${JSON.stringify(prompt)}; & "${clineCmd}" $p`;
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        cwd,
        env: { ...process.env },
        timeout,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Cline CLI timeout after ${timeout}ms`));
      }, timeout + 5000);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Cline CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    } else {
      // Unix: direct spawn works fine
      const child = spawn(clineCmd, [prompt], {
        cwd,
        env: { ...process.env },
        timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Cline CLI timeout after ${timeout}ms`));
      }, timeout + 5000);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Cline CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    }
  });
}

module.exports = { MANIFEST, run, setMemory };
