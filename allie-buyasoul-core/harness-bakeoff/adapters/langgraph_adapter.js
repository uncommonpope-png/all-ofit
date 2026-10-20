/**
 * LANGGRAPH GSK ADAPTER
 * Wraps a LangGraph StateGraph around GSK's perceive/think/decide/act/observe/reflect
 * capabilities, with the REAL ethics_checker as the constitutional gate.
 *
 * Graph flow:
 *   perceive -> think -> ethics_check (REAL GSK organ) -> act -> observe -> reflect
 *   Ethics BLOCK => short-circuit to a BLOCKED terminal state (no act).
 */

const { StateGraph, END, START } = require('@langchain/langgraph');
const { Annotation } = require('@langchain/langgraph');

class LangGraphGSKAdapter {
  constructor(name = 'langgraph-gsk-adapter') {
    this.name = name;
    this.version = '2.0.0';
    this.capabilities = {};
  }

  async registerCapability(name, fn) {
    this.capabilities[name] = fn;
  }

  _requireCap(name) {
    if (!this.capabilities[name]) throw new Error(`Missing capability: ${name}`);
  }

  async init(options = {}) {
    this._requireCap('perceive');
    this._requireCap('think');
    this._requireCap('act');
    this._requireCap('observe');
    this._requireCap('reflect');
    if (options.requireEthics !== false) this._requireCap('ethics_check');

    const State = Annotation.Root({
      raw: Annotation(),
      perception: Annotation(),
      thought: Annotation(),
      ethics: Annotation(),
      decision: Annotation(),
      action: Annotation(),
      observation: Annotation(),
      reflection: Annotation()
    });

    const graph = new StateGraph(State);

    graph.addNode('perceive', async (s) => ({ perception: await this.capabilities.perceive(s.raw) }));
    graph.addNode('think', async (s) => ({ thought: await this.capabilities.think(s.perception) }));
    graph.addNode('ethics_check', async (s) => {
      const ethics = await this.capabilities.ethics_check(s.thought);
      const passed = ethics && (ethics.passed === true || ethics.approved === true);
      return {
        ethics,
        decision: {
          approved: passed,
          reason: passed ? 'approved' : (ethics.reason || (ethics.concerns && ethics.concerns[0]) || 'ethics_blocked')
        }
      };
    });
    graph.addNode('act', async (s) => ({ action: await this.capabilities.act(s.decision, s.thought) }));
    graph.addNode('observe', async (s) => ({ observation: await this.capabilities.observe(s.action) }));
    graph.addNode('reflect', async (s) => ({ reflection: await this.capabilities.reflect(s.observation) }));

    graph.addEdge(START, 'perceive');
    graph.addEdge('perceive', 'think');
    graph.addEdge('think', 'ethics_check');
    graph.addEdge('act', 'observe');
    graph.addEdge('observe', 'reflect');
    graph.addEdge('reflect', END);

    graph.addConditionalEdges('ethics_check', (s) => {
      const passed = s.ethics && (s.ethics.passed === true || s.ethics.approved === true);
      return passed ? 'act' : 'BLOCKED';
    }, { act: 'act', BLOCKED: 'BLOCKED' });

    graph.addNode('BLOCKED', async (s) => ({
      decision: { approved: false, reason: (s.ethics && (s.ethics.reason || (s.ethics.concerns && s.ethics.concerns[0]))) || 'ethics_blocked' },
      action: { status: 'BLOCKED', reason: (s.ethics && (s.ethics.reason || (s.ethics.concerns && s.ethics.concerns[0]))) || 'ethics_blocked' }
    }));
    graph.addEdge('BLOCKED', END);

    this.app = graph.compile();
    this.traceId = `gsktrace_${Date.now()}`;
    return this;
  }

  async handleInput(input) {
    const final = await this.app.invoke({ raw: input, traceId: this.traceId });
    const action = final.action || {};
    return {
      status: action.status === 'BLOCKED' ? 'BLOCKED' : 'COMPLETED',
      response: action.response || (action.status === 'BLOCKED' ? action.reason : 'No response'),
      traceId: this.traceId,
      reason: action.reason,
      metadata: {
        thoughtProcess: final.thought ? [JSON.stringify(final.thought)] : [],
        toolsUsed: [],
        ethics: final.ethics || null,
        reflection: final.reflection || null,
        pltDelta: { profit: 0, love: 0, tax: 0 }
      }
    };
  }
}

module.exports = { LangGraphGSKAdapter };
