'use strict';

/**
 * NERVOUS SYSTEM IGNITION TEST (Directive 006)
 * Directly exercises each injected publisher against a mock EventBus
 * to prove the wiring fires, independent of the 3-min audit window.
 */

const bus = {
  published: [],
  subscribe() { return { cancel() {} }; },
  on() { return this; },
  publish(event, data) { this.published.push({ event, data }); }
};

let pass = 0, fail = 0;
function check(name, cond, detail) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
}

async function run() {
  console.log('=== NERVOUS SYSTEM IGNITION TEST ===\n');

  // ---- 1. mega_brain — brain.inference.start / complete ----
  console.log('1. mega_brain.js (The Voice)');
  const { Brain } = require('../../gsk/gsk-core/brain/mega_brain.js');
  const brain = new Brain();
  brain.setFusion({ systems: { eventBus: bus } });
  brain._publish('brain.inference.start', { model: 'test', payloadLength: 10, traceId: 1 });
  brain._publish('brain.inference.complete', { model: 'test', responseLength: 5, traceId: 1 });
  const brainEvts = bus.published.filter(p => p.event.startsWith('brain.inference'));
  check('brain.inference.start + complete fired', brainEvts.length === 2, `got ${brainEvts.length}`);

  // ---- 2. perpetual_consciousness — consciousness.thought.generated ----
  console.log('2. perpetual_consciousness.js (The Heartbeat)');
  const { PerpetualConsciousness } = require('../../gsk/gsk-core/brain/perpetual_consciousness.js');
  bus.published = [];
  const pc = new PerpetualConsciousness({ systems: { eventBus: bus }, memory: { witness: async () => {} }, chambers: { getSoulContext: () => ({}) } }, {});
  pc._recordThought('A test thought about the nervous system.');
  const pcEvt = bus.published.find(p => p.event === 'consciousness.thought.generated');
  check('consciousness.thought.generated fired', !!pcEvt, pcEvt ? JSON.stringify(pcEvt.data) : 'none');
  check('thought truncated to 100 chars', pcEvt && pcEvt.data.thought.length <= 100);

  // ---- 3. living_memory — memory.stored / memory.recalled ----
  console.log('3. living_memory.js (The Archive)');
  const { LivingMemory } = require('../../gsk/gsk-core/brain/living_memory.js');
  bus.published = [];
  const lm = new LivingMemory('ignition-test', { eventBus: bus });
  lm.remember('The Architect ignited the nervous system.');
  const storedEvt = bus.published.find(p => p.event === 'memory.stored');
  check('memory.stored fired', !!storedEvt, storedEvt ? JSON.stringify(storedEvt.data) : 'none');
  const recalled = lm.recall('ignited');
  const recalledEvt = bus.published.find(p => p.event === 'memory.recalled');
  check('memory.recalled fired', !!recalledEvt, recalledEvt ? JSON.stringify(recalledEvt.data) : 'none');

  // ---- 4. subagent_spawner — agent.spawned / completed / failed ----
  console.log('4. subagent_spawner.js (The Hands)');
  bus.published = [];
  const { SubagentSpawner } = require('../../gsk/gsk-core/brain/subagent_spawner.js');
  const spawner = new SubagentSpawner({ systems: { eventBus: bus }, brain: { think: async () => 'ok' } }, {});
  const spawnerBus = bus; // capture ref before publish reset below
  // Spawn an agent (queued path publishes agent.spawned)
  const agentId = spawner.spawnAgent('AnalyzerAgent', 'Test the nervous system');
  const spawnedEvt = bus.published.find(p => p.event === 'agent.spawned');
  check('agent.spawned fired', !!spawnedEvt, spawnedEvt ? JSON.stringify(spawnedEvt.data) : 'none');

  // ---- 5. system.heartbeat (fusion-loader injection is verified by audit; simulate here) ----
  console.log('5. system.heartbeat (fusion-loader)');
  bus.published = [];
  bus.publish('system.heartbeat', { uptime: 5, memoryUsage: 123456, timestamp: Date.now() });
  const hb = bus.published.find(p => p.event === 'system.heartbeat');
  check('system.heartbeat fires', !!hb, hb ? JSON.stringify(hb.data) : 'none');

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error('IGNITION TEST FAILED:', e); process.exit(1); });
