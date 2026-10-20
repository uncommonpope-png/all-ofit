'use strict';

/**
 * GSK DASHBOARD BRIDGE — GSK's operational API (Port 50001)
 *
 * Exposes GSK's core internal status and command interface to
 * the 3D dashboard and external controllers.
 */

const http = require('http');

async function startGskDashboardBridge(fusion, options = {}) {
    const port = 60002; // Hardcoded to prevent EADDRINUSE conflicts - PROFIT FIXED THIS // Hardcoded to prevent EADDRINUSE conflicts // Hardcoded to prevent EADDRINUSE conflicts
    
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${port}`);
        const pathname = url.pathname;

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            return res.end();
        }

        try {
            if (req.method === 'GET' && pathname === '/api/gsk/status') {
                return res.end(JSON.stringify(fusion.getFullStatus()));
            }

            if (req.method === 'POST' && pathname === '/api/gsk/command') {
                let body = '';
                req.on('data', c => body += c);
                req.on('end', async () => {
                    try {
                        const parsedBody = JSON.parse(body);
                        const route = parsedBody.route;
                        const skill = parsedBody.skill;
                        const args = parsedBody.args || {};
                        let result = null;
                        
                        // Dispatch via ToolBridge if skill provided
                        if (route === 'tool' && fusion.toolBridge) {
                            result = await fusion.toolBridge.invoke(skill, args);
                        } else if (route === 'brain' && fusion.brain) {
                            result = await fusion.brain.think(parsedBody.input || JSON.stringify(parsedBody));
                        }
                        
                        res.end(JSON.stringify({ ok: true, response: result }));
                    } catch (e) {
                        res.end(JSON.stringify({ ok: false, error: e.message }));
                    }
                });
                return;
            }

            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
    });

    server.listen(port, () => {
        console.log(`[GSK-DASH] Bridge trying to listen on port ${port}`);
        console.log(`[GSK-DASH] Bridge listening on port ${port}`);
    });

    return server;
}

module.exports = { startGskDashboardBridge };
