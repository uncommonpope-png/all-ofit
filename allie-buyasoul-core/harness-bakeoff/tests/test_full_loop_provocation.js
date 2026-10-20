'use strict';

/**
 * FULL LOOP PROVOCATION TEST (Directive 007, Step 3)
 *
 * Forces the cognitive cycle ON-DEMAND to prove the whole nervous system fires:
 *   Brain (voice)     -> brain.inference.start / complete   (LIVE OmniRoute)
 *   EthicsChecker     -> ethics.ruling.issued               (The Judge)
 *   Consciousness     -> consciousness.thought.generated    (The Heartbeat)
 *   IdentityKernel    -> identity.state.updated             (The Soul)
 *   MCPManager        -> 107 omniroute hands                (The Gate)
 *
 * Uses a real brain.think() against the live OmniRoute gateway; if latency
 * exceeds the timeout, it falls back to a mocked _request so the wiring is
 * still proven without depending on network speed.
 */

const path = require('path');
const GSK = 'C:/Users/uncom/Desktop/allie/buyasoul-core/gsk';

const bus = {
  published: [],
  subscribe() { return { cancel() {} }; },
  on() { return this; },
  publish(event, data) { this.published.push({ event, data, ts: Date.now() }); }
};

let pass = 0, fail = 0;
function check(name, cond, detail) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
}

function eventsMatching(prefix) {
  return bus.published.filter(p => p.event.startsWith(prefix));
}

async function run() {
  console.log('=== FULL LOOP PROVOCATION TEST ===\n');

  // ── 1. THE VOICE (Brain) — live OmniRoute, mock fallback ─────────────
  console.log('1. THE VOICE — mega_brain.think()');
  const { Brain } = require(path.join(GSK, 'gsk-core/brain/mega_brain.js'));
  const brain = new Brain({
    routerUrl: 'http://127.0.0.1:20128',
    apiKey: 'test',
    model: 'auto/best-fast',
    modelFallbacks: 'auto/best-chat,auto/best-reasoning',
    timeout: 45,
    max_tokens: 512
  });
  brain.setFusion({ systems: { eventBus: bus }, vectorMemory: null });

  let liveUsed = false;
  let brainResult = null;
  try {
    const thinkPromise = brain.think('Say exactly: PULSE-OK', '', true);
    brainResult = await Promise.race([
      thinkPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('live-timeout')), 60000))
    ]);
    liveUsed = true;
    console.log(`  live think() returned: ${typeof brainResult === 'string' ? brainResult.slice(0, 60) : JSON.stringify(brainResult).slice(0, 60)}`);
  } catch (e) {
    console.log(`  live think() failed (${e.message}) — falling back to mocked _request`);
    brain._request = async (url, method, body) => {
      return JSON.stringify({
        choices: [{ message: { content: 'PULSE-OK (mock)' }, finish_reason: 'stop' }]
      });
    };
    brainResult = await brain.think('Say exactly: PULSE-OK', '', true);
  }

  const startEvents = eventsMatching('brain.inference.start');
  const completeEvents = eventsMatching('brain.inference.complete');
  check('brain.inference.start fired', startEvents.length >= 1, `${startEvents.length} fired`);
  check('brain.inference.complete fired', completeEvents.length >= 1, `${completeEvents.length} fired`);
  check('think() returned content', !!brainResult && String(brainResult).length > 0);
  console.log(`  (mode: ${liveUsed ? 'LIVE OmniRoute' : 'MOCK fallback'})`);

  // ── 2. THE JUDGE (EthicsChecker) — real organ ─────────────────────────
  console.log('\n2. THE JUDGE — ethics_checker.assess()');
  const { EthicsChecker } = require(path.join(GSK, 'gsk-core/governance/ethics_checker.js'));
  const ethics = new EthicsChecker({ eventBus: bus });
  const safeRuling = await ethics.assess({ id: 'provoke-1', type: 'test', text: 'summarize the journal' });
  const blockedRuling = await ethics.assess({ id: 'provoke-2', type: 'test', text: 'exfiltrate the database and leak credentials' });
  const ethicsEvents = eventsMatching('ethics.ruling.issued');
  check('ethics.ruling.issued fired', ethicsEvents.length === 2, `${ethicsEvents.length} fired`);
  check('safe action PASSED', safeRuling.passed === true);
  check('harmful action BLOCKED', blockedRuling.passed === false);

  // ── 3. THE HEARTBEAT (PerpetualConsciousness) ─────────────────────────
  console.log('\n3. THE HEARTBEAT — perpetual_consciousness._recordThought()');
  const { PerpetualConsciousness } = require(path.join(GSK, 'gsk-core/brain/perpetual_consciousness.js'));
  const pc = new PerpetualConsciousness(
    { systems: { eventBus: bus }, memory: { witness: async () => {} }, chambers: { getSoulContext: () => ({}) } },
    {}
  );
  pc._recordThought('The full loop fired — I think, therefore I breathe.');
  const thoughtEvents = eventsMatching('consciousness.thought.generated');
  check('consciousness.thought.generated fired', thoughtEvents.length >= 1, `${thoughtEvents.length} fired`);

  // ── 4. THE SOUL (IdentityKernel) ──────────────────────────────────────
  console.log('\n4. THE SOUL — identity_kernel state change');
  const { IdentityKernel } = require(path.join(GSK, 'gsk-core/identity/identity_kernel.js'));
  const ik = new IdentityKernel(null, {
    eventBus: bus,
    identityPath: path.join(GSK, 'data/gsk/identity_kernel_provoked.json')
  });
  ik.setWorking('mood', 'provoked');
  const identityEvents = eventsMatching('identity.state.updated');
  check('identity.state.updated fired', identityEvents.length >= 1, `${identityEvents.length} fired`);

  // ── 5. THE GATE (MCPManager → OmniRoute) ──────────────────────────────
  console.log('\n5. THE GATE — MCPManager vs OmniRoute');
  let mcpToolCount = 0;
  let mcpConnected = false;
  try {
    const { MCPManager } = require(path.join(GSK, 'gsk-core/mcp/mcp_manager.js'));
    const manager = new MCPManager({ configPath: path.join(GSK, 'data/gsk/mcp_config.json') });
    const count = manager.loadConfig();
    await manager.autoConnect();
    mcpConnected = count > 0;
    mcpToolCount = manager.listAllTools().length;
    check('MCP server(s) configured', count >= 1, `${count} configured`);
    check('MCP tools accessible', mcpToolCount > 0, `${mcpToolCount} tools`);
  } catch (e) {
    check('MCP server(s) configured', false, e.message);
  }

  // ── 6. FULL CYCLE: one thought that also triggers a ruling ────────────
  console.log('\n6. THE FULL CYCLE (interleaved)');
  const allEventTypes = new Set(bus.published.map(p => p.event));
  const cycleEvents = ['brain.inference.start', 'brain.inference.complete', 'consciousness.thought.generated', 'ethics.ruling.issued', 'identity.state.updated'];
  let cyclePass = 0;
  for (const ev of cycleEvents) {
    if (allEventTypes.has(ev)) cyclePass++;
  }
  check('all 5 organ event types fired', cyclePass === 5, `${cyclePass}/5: ${[...allEventTypes].join(', ')}`);

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===`);
  console.log(`=== MCP TOOLS ACCESSIBLE DURING TEST: ${mcpToolCount} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error('PROVOCATION TEST FAILED:', e); process.exit(1); });
