/**
 * GSK HARNESS CONTRACT
 * Defines the required capabilities for any agent harness adapter.
 * Every harness must implement these capabilities to be GSK-compatible.
 */

const z = require('zod');

// Input schema: what GSK sends to the harness
const GSKInputSchema = z.object({
  message: z.string(),
  context: z.object({
    traceId: z.string().optional(),
    source: z.enum(['user', 'autonomous', 'mcp', 'council', 'system']).default('user'),
    identity: z.object({
      name: z.string(),
      plt: z.object({
        profit: z.number(),
        love: z.number(),
        tax: z.number()
      })
    }).optional()
  }).optional()
});

// Output schema: what the harness returns
const GSKOutputSchema = z.object({
  status: z.enum(['COMPLETED', 'BLOCKED', 'ERROR']),
  response: z.string(),
  traceId: z.string().optional(),
  reason: z.string().optional(),
  metadata: z.object({
    thoughtProcess: z.array(z.string()).optional(),
    toolsUsed: z.array(z.string()).optional(),
    pltDelta: z.object({
      profit: z.number(),
      love: z.number(),
      tax: z.number()
    }).optional()
  }).optional()
});

// Harness adapter interface
const HarnessAdapterSchema = z.object({
  name: z.string(),
  version: z.string(),
  
  // Required capabilities
  perceive: z.function(),
  think: z.function(),
  decide: z.function(),
  act: z.function(),
  observe: z.function(),
  reflect: z.function(),
  
  // Optional capabilities
  remember: z.function().optional(),
  counsel: z.function().optional()
});

module.exports = {
  GSKInputSchema,
  GSKOutputSchema,
  HarnessAdapterSchema
};
