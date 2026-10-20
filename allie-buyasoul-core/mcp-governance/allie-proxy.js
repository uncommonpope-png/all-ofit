'use strict';

var http = require('http');

var ALLIE_API_URL = process.env.ALLIE_API_URL || 'http://127.0.0.1:4431';
var ALLIE_API_KEY = process.env.ALLIE_API_KEY || 'allie-test-key-2026';

function _callAllie(method, pathname, body) {
  return new Promise(function(resolve) {
    var url = new URL(ALLIE_API_URL + pathname);
    var opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method || 'GET',
      headers: { 'x-api-key': ALLIE_API_KEY, 'Content-Type': 'application/json', 'User-Agent': 'Allie-MCP-Proxy/1.0' },
      timeout: 10000
    };
    var json = body ? JSON.stringify(body) : null;
    var req = http.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; if (data.length > 1e5) { req.destroy(); resolve(null); } });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', function() { resolve(null); });
    req.on('timeout', function() { req.destroy(); resolve(null); });
    if (json) req.write(json);
    req.end();
  });
}

var ALLIE_TOOLS = [
  {
    name: 'allie_status',
    description: 'Get Allie daemon status — consciousness level, cycle count, mood, uptime',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'allie_memory',
    description: 'Query Allie\'s memory system — recent memories, count, or search by tag',
    inputSchema: {
      type: 'object',
      properties: { tag: { type: 'string', description: 'Filter by tag (optional)' }, limit: { type: 'number', description: 'Number of results (default 5)' } },
      required: []
    }
  },
  {
    name: 'allie_consciousness',
    description: 'Get Allie\'s full consciousness state — mood, focus, growth, cycles',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'allie_subagents',
    description: 'List all subagents and their current state (tick count, last run, schedule)',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'allie_goals',
    description: 'Get Allie\'s current goals and their progress',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'allie_skills',
    description: 'Get Allie\'s skill inventory — total, wired, used, unused skills',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'allie_accounts',
    description: 'List all configured social media accounts and their status',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'allie_blitz',
    description: 'Get blitz mode configuration and speed multipliers',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'allie_ping',
    description: 'Ping Allie daemon to verify connectivity and response time',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'allie_post_bluesky',
    description: 'Trigger a Bluesky post cycle via Allie',
    inputSchema: { type: 'object', properties: { account: { type: 'string', description: 'Account to post as (allieboughtasoul or grandcodepope, optional)' } }, required: [] }
  },
  {
    name: 'allie_post_youtube',
    description: 'Trigger a YouTube content generation cycle via Allie',
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
];

class AllieProxyClient {
  constructor() {
    this.name = 'allie';
  }

  listTools() {
    return ALLIE_TOOLS;
  }

  async callTool(name, args) {
    args = args || {};
    switch (name) {
      case 'allie_status': {
        var r = await _callAllie('GET', '/status');
        if (r && r.data) return r.data;
        var r2 = await _callAllie('GET', '/api/status');
        if (r2 && r2.data) return r2.data;
        return { error: 'Allie not reachable at ' + ALLIE_API_URL };
      }
      case 'allie_memory': {
        var tagQuery = args.tag ? '?tag=' + encodeURIComponent(args.tag) : '';
        var r = await _callAllie('GET', '/memory' + tagQuery);
        return (r && r.data) ? r.data : { error: 'Memory endpoint not available' };
      }
      case 'allie_consciousness': {
        var r = await _callAllie('GET', '/status');
        if (r && r.data) return { mood: r.data.mood, focus: r.data.focus, cyclesCompleted: r.data.cyclesCompleted, totalActions: r.data.totalActions, awareness: r.data.awareness };
        return { error: 'Status endpoint not available' };
      }
      case 'allie_subagents': {
        var r = await _callAllie('GET', '/status');
        if (r && r.data && r.data.subagents) return r.data.subagents;
        return { error: 'Subagent info not available from status endpoint' };
      }
      case 'allie_goals': {
        var r = await _callAllie('GET', '/status');
        if (r && r.data && r.data.goals) return r.data.goals;
        return { note: 'Goals not in status response; check /post-idea or /engage-targets endpoints' };
      }
      case 'allie_skills': {
        var r = await _callAllie('GET', '/status');
        if (r && r.data && r.data.skills) return r.data.skills;
        return { error: 'Skills not available from status endpoint' };
      }
      case 'allie_accounts': {
        var r = await _callAllie('GET', '/status');
        if (r && r.data && r.data.accounts) return r.data.accounts;
        return { error: 'Accounts not available from status endpoint' };
      }
      case 'allie_blitz': {
        var r = await _callAllie('GET', '/status');
        if (r && r.data && r.data.blitz) return r.data.blitz;
        return { error: 'Blitz info not available from status endpoint' };
      }
      case 'allie_ping': {
        var start = Date.now();
        var r = await _callAllie('GET', '/status');
        var ms = Date.now() - start;
        if (r) return { alive: true, latencyMs: ms, statusCode: r.status };
        return { alive: false, latencyMs: ms };
      }
      case 'allie_post_bluesky': {
        var r = await _callAllie('POST', '/tick', { agent: 'blueskyAgent' });
        return (r && r.data) ? r.data : { error: 'Tick endpoint not available' };
      }
      case 'allie_post_youtube': {
        var r = await _callAllie('POST', '/tick', { agent: 'youtubeAgent' });
        return (r && r.data) ? r.data : { error: 'Tick endpoint not available' };
      }
      default:
        throw new Error('Tool not found: ' + name);
    }
  }
}

module.exports = { AllieProxyClient: AllieProxyClient, ALLIE_TOOLS: ALLIE_TOOLS };
