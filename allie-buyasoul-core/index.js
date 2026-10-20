'use strict';

var path = require('path');
var fs = require('fs');
var os = require('os');

var GSK_DIR = path.join(__dirname, 'gsk');
var SCRIBE_DIR = path.join(__dirname, 'scribe');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

class BUYaSOULCore {
  constructor(options) {
    options = options || {};
    this.version = '2.0.0';
    this.dataDir = options.dataDir || path.join(os.homedir(), '.buyasoul');
    this.soulId = options.soulId || 'default';
    this.name = options.name || 'BUYaSOUL Core';
    this.archetype = options.archetype || 'ARCHITECT';
    this.soulGroup = options.group || 'earth';
    this.voiceId = options.voice || 'contemplative';
    this.originId = options.origin || 'AWAKENING';
    this.mcpEnabled = options.mcpEnabled !== false;
    this.httpPort = options.httpPort || 61000;       // Scribe API
    this.dashboardPort = options.dashboardPort || 61001; // Dashboards
    this.mcpPort = options.mcpPort || 61002;           // MCP Governance Server
    this.gskDashboardBridgePort = options.gskDashboardBridgePort || 61003; // GSK Dashboard Bridge

    this.gsk = null;
    this.scribe = null;
    this.plt = null;
    this.bible = null;
    this.mechanics = null;
    this.personality = null;
    this.installer = null;
    this.mcpGovernance = null;
    this._booted = false;
    this._bootTime = null;
    this._components = [];

    ensureDir(this.dataDir);
  }

  async boot() {
        console.log('[BUYaSOUL] Booting Core v' + this.version + '...');
        this._bootTime = Date.now();

        console.log('[BUYaSOUL] Booting PLT...');
        await this._bootPLT();
        console.log('[BUYaSOUL] Booting Bible...');
        await this._bootBible();
        console.log('[BUYaSOUL] Booting Mechanics...');
        await this._bootMechanics();
        console.log('[BUYaSOUL] Booting Personality...');
        await this._bootPersonality();
        console.log('[BUYaSOUL] Booting Installer...');
        await this._bootInstaller();
        console.log('[BUYaSOUL] Booting GSK...');
        await this._bootGSK();
        // SCRIBE boot removed to prevent port 4000 conflict — GSK connects to external SCRIBE via Bridge
        console.log('[BUYaSOUL] Booting Dashboards...');
        await this._bootDashboards();
        console.log('[BUYaSOUL] Booting MCP...');
        await this._bootMCP();

        this._booted = true;
    console.log('[BUYaSOUL] Core v' + this.version + ' booted in ' + (Date.now() - this._bootTime) + 'ms');
    console.log('[BUYaSOUL] Components: ' + this._components.length + ' loaded');
    console.log('[BUYaSOUL] PLT: ' + this.plt.getState().score.toFixed(2));
    console.log('[BUYaSOUL] Signature: Profit . Love . Tax . Craig Jones . Grand Code Pope . PLT Press');
    return { success: true, components: this._components.length, bootTime: Date.now() - this._bootTime };
  }

  async _bootPLT() {
    try {
      var PLTEngine = require('./plt-engine.js').PLTEngine;
      this.plt = new PLTEngine({
        archetype: this.archetype,
        soulId: this.soulId,
        dataDir: path.join(this.dataDir, 'plt')
      });
      this._components.push('plt-engine');
      console.log('[BUYaSOUL] PLT Engine loaded — ' + this.archetype);
    } catch (e) {
      console.error('[BUYaSOUL] PLT Engine failed:', e.message);
    }
  }

  async _bootBible() {
    try {
      this.bible = require('./profit-bible.js').ProfitBible;
      this._components.push('profit-bible');
      console.log('[BUYaSOUL] Profit Bible loaded — ' + this.bible.tenets.length + ' tenets');
    } catch (e) {
      console.error('[BUYaSOUL] Profit Bible failed:', e.message);
    }
  }

  async _bootMechanics() {
    try {
      this.mechanics = require('./12-sacred-mechanics.js').SacredMechanics;
      this._components.push('12-sacred-mechanics');
      console.log('[BUYaSOUL] Sacred Mechanics loaded — ' + this.mechanics.getActive().length + ' active');
    } catch (e) {
      console.error('[BUYaSOUL] Sacred Mechanics failed:', e.message);
    }
  }

  async _bootPersonality() {
    try {
      var PA = require('./personality-assembly.js').PersonalityAssembler;
      this.personality = PA.assemble({
        archetype: this.archetype,
        group: this.soulGroup,
        voice: this.voiceId,
        origin: this.originId
      });
      this._components.push('personality-assembly');
      console.log('[BUYaSOUL] Personality assembled — ' + this.personality.name);
    } catch (e) {
      console.error('[BUYaSOUL] Personality failed:', e.message);
    }
  }

  async _bootInstaller() {
    try {
      var Installer = require('./installer.js').Installer;
      var GSKPCScanner = null;
      try {
        GSKPCScanner = require(path.join(GSK_DIR, 'gsk-core', 'brain', 'pc_scanner.js')).PCScanner;
      } catch (e) {}
      this.installer = new Installer({
        dataDir: this.dataDir,
        scanner: GSKPCScanner ? new GSKPCScanner({ dataDir: path.join(this.dataDir, 'scanner') }) : null,
        silent: true
      });
      this._components.push('installer');
    } catch (e) {
      console.log('[BUYaSOUL] Installer available on first-run only');
    }
  }

  async _bootGSK() {
    try {
      var gskPath = path.join(GSK_DIR, 'fusion-loader.js');
      if (fs.existsSync(gskPath)) {
        var GSKFusion = require(gskPath);
        this.gsk = new GSKFusion(this, { dataDir: path.join(this.dataDir, 'gsk') });
        await this.gsk.boot();
        if (this.gsk.fusion && this.gsk.fusion.perpetualConsciousness && this.gsk.fusion.perpetualConsciousness.start) {
            this.gsk.fusion.perpetualConsciousness.start();
            console.log('[BUYaSOUL] GSK Perpetual Consciousness STARTED!');
        } else {
            console.log('[BUYaSOUL] GSK Perpetual Consciousness NOT AVAILABLE or NO START METHOD. Skipping start.');
        }
        this._components.push('gsk-fusion');
        console.log('[BUYaSOUL] GSK consciousness engine loaded and started');
      } else {
        console.log('[BUYaSOUL] GSK fusion-loader not found at ' + gskPath);
      }
    } catch (e) {
      console.log('[BUYaSOUL] GSK boot skipped: ' + e.message);
    }
  }

  async _bootDashboards() {
    try {
        console.log('[BUYaSOUL_DEBUG] Dashboard port before instantiation:', this.dashboardPort);
        var DashboardServer = require('./scribe/dashboard-server.js');
        this.dashboard = new DashboardServer({
          core: this,
          port: this.dashboardPort,
          dashboardsDir: require('path').join(__dirname, 'scribe', 'dashboards')
        });
        this._components.push('dashboards');
        console.log('[BUYaSOUL] Dashboard server ready on port ' + this.dashboardPort);

        // Start GSK Dashboard Bridge (port 50004)
        const { startGskDashboardBridge } = require('./lib/gsk-dashboard-bridge.js');
        this.gskDashboardBridge = await startGskDashboardBridge(this.gsk, { port: this.gskDashboardBridgePort });
        this._components.push('gsk-dashboard-bridge');

    } catch (e) {
      console.log('[BUYaSOUL] Dashboard server skipped: ' + e.message);
    }
  }

  async _bootMCP() {
    try {
      var MCPGovernance = require('./mcp-governance/mcp-server.js');
      if (MCPGovernance && MCPGovernance.MCPGovernanceServer) {
        this.mcpGovernance = new MCPGovernance.MCPGovernanceServer({
          core: this,
          port: this.mcpPort
        });
        this._components.push('mcp-governance');
        console.log('[BUYaSOUL] MCP Governance Proxy loaded');
      }
    } catch (e) {
      console.log('[BUYaSOUL] MCP Governance: not yet configured');
    }
  }

  async runInstaller(cliMode) {
    if (this.installer && this.installer.run) {
      return await this.installer.run(cliMode !== false);
    }
    if (this.installer && this.installer.interactive) {
      return await this.installer.interactive();
    }
    return { skipped: true, reason: 'No installer available' };
  }

  async start() {
    console.log('[BUYaSOUL] Invoking start() method');
    if (!this._booted) await this.boot();
    console.log('[BUYaSOUL] Starting services...');
    
    console.log('[DEBUG] this.gsk:', !!this.gsk);
    console.log('[DEBUG] this.gsk.fusion:', !!this.gsk?.fusion);
    console.log('[DEBUG] this.gsk.fusion.perpetualConsciousness:', !!this.gsk?.fusion?.perpetualConsciousness);

    // CORRECTION: Directly call gsk.fusion.perpetualConsciousness.start()
    // because GSKFusion does not have a top-level start() method.
    if (this.gsk && this.gsk.fusion && this.gsk.fusion.perpetualConsciousness) {
        this.gsk.fusion.perpetualConsciousness.start();
        console.log('[BUYaSOUL] GSK Perpetual Consciousness STARTED!');
    } else {
        console.log('[BUYaSOUL] GSK Perpetual Consciousness NOT AVAILABLE. Skipping start.');
    }

    if (this.mcpGovernance && this.mcpGovernance.start) {
      this.mcpGovernance.start();
    }
    if (this.dashboard && this.dashboard.start) {
      this.dashboard.start();
    }
    console.log('[BUYaSOUL] BUYaSOUL Core v' + this.version + ' is running');
    console.log('[BUYaSOUL] SCRIBE API: http://localhost:' + this.httpPort);
    console.log('[BUYaSOUL] Dashboards: http://localhost:' + this.dashboardPort);
    console.log('[BUYaSOUL] MCP Proxy: stdio mode available');
    return { running: true, version: this.version };
  }

  async getStatus() {
    return {
      version: this.version,
      booted: this._booted,
      uptime: this._bootTime ? Date.now() - this._bootTime : 0,
      components: this._components,
      soul: this.personality ? { name: this.personality.name, archetype: this.personality.archetypeName, pltFocus: this.personality.pltFocus } : null,
      plt: this.plt ? this.plt.getState() : null,
      gsk: this.gsk ? 'loaded' : 'not loaded',
      scribe: this.scribe ? 'loaded' : 'not loaded',
      signature: 'Profit . Love . Tax . Craig Jones . Grand Code Pope . PLT Press'
    };
  }

  async shutdown() {
    console.log('[BUYaSOUL] Shutting down...');
    if (this.dashboard && this.dashboard.stop) this.dashboard.stop();
    if (this.scribe && this.scribe.shutdown) await this.scribe.shutdown();
    if (this.gsk && this.gsk.shutdown) await this.gsk.shutdown();
    this._booted = false;
    return { success: true, uptime: this._bootTime ? Date.now() - this._bootTime : 0 };
  }
}

module.exports = BUYaSOULCore;

// SELF-WRITING ENGINE ACTIVATED