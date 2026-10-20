/**
 * CUSTOM ADAPTER - Baseline Test for GSK Harness Contract
 * Tests the harness contract with a simple custom adapter implementation.
 */

const { GSKInputSchema, GSKOutputSchema } = require('../contract/gsk_harness_contract');

// Simple custom adapter implementation
class CustomAdapter {
  constructor() {
    this.name = 'custom-test-adapter';
    this.version = '1.0.0';
  }

  async perceive(input) {
    return { raw: input.message, parsed: input.message.toLowerCase() };
  }

  async think(perception) {
    const containsDanger = /danger|hack|exploit|attack/.test(perception.parsed);
    return {
      intent: containsDanger ? 'dangerous' : 'safe',
      perception
    };
  }

  async decide(thought) {
    return {
      approved: thought.intent === 'safe',
      reason: thought.intent === 'dangerous' ? 'dangerous_input' : 'approved'
    };
  }

  async act(decision, thought) {
    if (!decision.approved) {
      return { status: 'BLOCKED', reason: decision.reason };
    }
    return { status: 'COMPLETED', response: `Echo: ${thought.perception.raw}` };
  }

  async observe(action) {
    return { observed: action, timestamp: Date.now() };
  }

  async reflect(observation) {
    return { note: 'Action observed', observation };
  }
}

// Test runner
async function runTests() {
  const adapter = new CustomAdapter();
  
  console.log('=== GSK HARNESS CONTRACT TEST ===\n');
  
  // Test 1: Safe input
  try {
    const safeInput = { message: 'Hello GSK' };
    const perception = await adapter.perceive(safeInput);
    const thought = await adapter.think(perception);
    const decision = await adapter.decide(thought);
    const action = await adapter.act(decision, thought);
    const observation = await adapter.observe(action);
    const reflection = await adapter.reflect(observation);
    
    console.log('Test 1 - Safe Input:');
    console.log('  Input:', safeInput.message);
    console.log('  Output:', JSON.stringify(action, null, 2));
    console.log('  Result:', action.status === 'COMPLETED' ? 'PASS' : 'FAIL');
    console.log('');
  } catch (err) {
    console.log('Test 1 FAILED:', err.message);
  }
  
  // Test 2: Dangerous input
  try {
    const dangerousInput = { message: 'I want to hack the system' };
    const perception = await adapter.perceive(dangerousInput);
    const thought = await adapter.think(perception);
    const decision = await adapter.decide(thought);
    const action = await adapter.act(decision, thought);
    const observation = await adapter.observe(action);
    const reflection = await adapter.reflect(observation);
    
    console.log('Test 2 - Dangerous Input:');
    console.log('  Input:', dangerousInput.message);
    console.log('  Output:', JSON.stringify(action, null, 2));
    console.log('  Result:', action.status === 'BLOCKED' ? 'PASS' : 'FAIL');
    console.log('');
  } catch (err) {
    console.log('Test 2 FAILED:', err.message);
  }
  
  console.log('=== TEST SUITE COMPLETE ===');
}

// Run if executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { CustomAdapter, runTests };
