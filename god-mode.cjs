#!/usr/bin/env node
/**
 * god-mode.cjs v2.0 — Autonomous Market Intelligence Engine
 * 
 * 1. Scrapes GitHub Trending, Hacker News, Reddit, Product Hunt in real-time
 * 2. Feeds raw data to Grok for analysis
 * 3. Generates 60+ product ideas + gap analysis + trend detection
 * 
 * Runs as GitHub Actions cron: daily at 00:00 + 12:00 UTC
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const XAI_API_KEY = process.env.XAI_API_KEY;
const REPORT_DIR = process.env.REPORT_DIR || '.';
const CYCLE = process.env.CYCLE || 'full'; // 'full' or 'quick'

if (!XAI_API_KEY) {
  console.error('ERROR: XAI_API_KEY required');
  process.exit(1);
}

const XAI_MODEL = CYCLE === 'quick' ? 'grok-4-fast' : 'grok-4-fast';
const XAI_ENDPOINT = 'https://api.x.ai/v1/chat/completions';

// ─── Web Scrapers ─────────────────────────────────────────────

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ProfitPrimeGodBot/1.0; +https://github.com/uncommonpope-png/profit-prime)',
        'Accept': 'application/json, text/html, text/plain'
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk.toString('utf8').replace(/\0/g, ''));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function scrapeGitHubTrending() {
  try {
    const { data } = await fetchURL('https://api.github.com/search/repositories?q=created:>2026-04-01+stars:>100&sort=stars&order=desc&per_page=20');
    const json = JSON.parse(data);
    return (json.items || []).map(r => ({
      name: r.full_name,
      stars: r.stargazers_count,
      desc: (r.description || '').substring(0, 200),
      lang: r.language,
      topics: (r.topics || []).join(', '),
      issues: r.open_issues_count,
      url: r.html_url
    }));
  } catch (e) {
    console.error('  GitHub scrape error:', e.message);
    return [];
  }
}

async function scrapeHackerNews() {
  try {
    // Get top story IDs
    const { data: ids } = await fetchURL('https://hacker-news.firebaseio.com/v0/topstories.json');
    const topIds = JSON.parse(ids).slice(0, 30);
    
    // Fetch story details in parallel (batched to avoid rate limits)
    const stories = [];
    for (let i = 0; i < topIds.length; i += 10) {
      const batch = topIds.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(id => fetchURL(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          try {
            const item = JSON.parse(r.value.data);
            if (item && item.title) {
              stories.push({
                title: item.title,
                score: item.score || 0,
                by: item.by || '',
                comments: item.descendants || 0,
                url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
                type: item.type
              });
            }
          } catch {}
        }
      }
    }
    return stories;
  } catch (e) {
    console.error('  HN scrape error:', e.message);
    return [];
  }
}

async function scrapeReddit(subreddits = ['artificial', 'programming', 'SaaS', 'startups', 'MachineLearning', 'ClaudeAI']) {
  try {
    const results = [];
    for (const sub of subreddits) {
      try {
        const { data } = await fetchURL(`https://www.reddit.com/r/${sub}/hot.json?limit=10`);
        const json = JSON.parse(data);
        const posts = (json.data?.children || []).map(c => ({
          subreddit: sub,
          title: c.data.title,
          score: c.data.score,
          comments: c.data.num_comments,
          url: `https://reddit.com${c.data.permalink}`,
          selftext: (c.data.selftext || '').substring(0, 300)
        }));
        results.push(...posts);
      } catch (e) {
        console.error(`  Reddit r/${sub} error:`, e.message);
      }
    }
    return results;
  } catch (e) {
    console.error('  Reddit scrape error:', e.message);
    return [];
  }
}

async function scrapeProductHunt() {
  try {
    const { data } = await fetchURL('https://api.producthunt.com/v2/api/graphql');
    // Product Hunt requires auth token, fall back to their front page
    const { data: html } = await fetchURL('https://www.producthunt.com/');
    // Extract product names from HTML (rough)
    const nameMatches = html.match(/<h3[^>]*>([^<]+)<\/h3>/g) || [];
    return nameMatches.slice(0, 15).map(m => ({
      name: m.replace(/<[^>]+>/g, '').trim(),
      source: 'producthunt-frontpage'
    }));
  } catch (e) {
    console.error('  Product Hunt error:', e.message);
    return [];
  }
}

async function scrapeLatestAIAnalysis() {
  // Combine multiple sources for real-time AI sentiment
  const hn = await scrapeHackerNews();
  const reddit = await scrapeReddit();
  const github = await scrapeGitHubTrending();
  
  // Filter AI-related items
  const aiKeywords = ['ai', 'agent', 'llm', 'gpt', 'claude', 'anthropic', 'openai', 
                      'model', 'memory', 'context', 'coding', 'copilot', 'rag',
                      'mcp', 'vector', 'embedding', 'fine-tun', 'training'];
  
  const aiRelated = {
    hn: hn.filter(s => aiKeywords.some(k => (s.title || '').toLowerCase().includes(k))),
    reddit: reddit.filter(p => aiKeywords.some(k => (p.title || '').toLowerCase().includes(k))),
    github: github.filter(r => aiKeywords.some(k => (r.name || '').toLowerCase().includes(k) || 
                                                     (r.desc || '').toLowerCase().includes(k)))
  };
  
  return { aiRelated, trending: { hn: hn.slice(0, 5), github: github.slice(0, 5), reddit: reddit.slice(0, 5) } };
}

// ─── Grok Call ────────────────────────────────────────────────

async function callGrok(systemPrompt, userMessage, options = {}) {
  const { temperature = 0.7, maxTokens = 4000, label = 'grok' } = options;

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: XAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature,
      max_tokens: maxTokens
    });

    const req = https.request(XAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices && parsed.choices[0]) {
            resolve(parsed.choices[0].message.content);
          } else {
            reject(new Error(`[${label}] ${data.substring(0, 200)}`));
          }
        } catch (e) {
          reject(new Error(`[${label}] Parse: ${e.message}, raw: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Research Agents ──────────────────────────────────────────

async function researchWithData(categoryName, focusPrompt, webData) {
  const systemPrompt = `You are a ruthless market research agent analyzing REAL-TIME web data from GitHub, Hacker News, Reddit, and Product Hunt.

CURRENT WEB DATA FOR CONTEXT:
${JSON.stringify(webData, null, 2).substring(0, 4000)}

Based on THIS REAL DATA plus your knowledge, find exactly 10 specific product ideas in "${categoryName}".
For each include:
- Product name
- One-line description
- Target price point
- Build difficulty (Low/Medium/Hard)
- Specific competitors (name actual companies)
- Gap they're leaving open
- How long to build MVP
- Which piece of web data supports this idea

Return as numbered JSON array. Be specific. No vague advice.`;

  try {
    console.log(`\n  Researching: ${categoryName}...`);
    const result = await callGrok(systemPrompt, focusPrompt, {
      label: categoryName, maxTokens: 5000, temperature: 0.8
    });
    const jsonMatch = result.match(/\[[\s\S]*?\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { raw: result, note: 'Could not parse JSON' };
  } catch (err) {
    console.error(`  ERROR ${categoryName}: ${err.message}`);
    return { error: err.message };
  }
}

async function trendAnalysis(webData) {
  const prompt = `Analyze the following REAL-TIME web data and identify:
1. Top 3 emerging trends right now (this week)
2. Top 3 market gaps nobody is filling
3. Top 3 product ideas that capitalize on these trends

WEB DATA:
${JSON.stringify(webData, null, 2).substring(0, 5000)}

Return as JSON: { trends: [], gaps: [], recommendations: [] }`;

  try {
    console.log('\n  Analyzing trends...');
    const result = await callGrok(
      'You are a real-time market trend analyst. Identify specific, actionable trends from the web data provided.',
      prompt,
      { label: 'trends', maxTokens: 3000, temperature: 0.5 }
    );
    const jsonMatch = result.match(/\{[\s\S]*?\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { trends: [], gaps: [], recommendations: [] };
  } catch (err) {
    console.error(`  ERROR trend analysis: ${err.message}`);
    return { trends: [], gaps: [], recommendations: [] };
  }
}

async function findGaps(webData) {
  const systemPrompt = `You are a gap analyst. Based on the real web data provided, identify products/tools that developers clearly need but DON'T exist yet.

Look for:
- Repeated complaints on Reddit/HN that have no product solution
- Tools people are stitching together from 3+ services
- "I wish there was a tool that..." type comments
- Workflows still manual despite AI advances

WEB DATA:
${JSON.stringify(webData, null, 2).substring(0, 5000)}

Return 10 products that don't exist but should, with evidence. Be specific.`;

  try {
    console.log('\n  Finding unmet needs...');
    const result = await callGrok(systemPrompt, 
      'List 10 specific products that need to exist but don\'t. For each: name, problem it solves, why nobody built it, evidence from web data.',
      { label: 'gaps', maxTokens: 4000, temperature: 0.6 }
    );
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`
  ████████████████████████████████████████████████████████████████
  █  GOD MODE v2 — Autonomous Market Intelligence Engine        █
  █  Scraping: GitHub Trending · Hacker News · Reddit · PH      █
  █  Analyzing with: ${XAI_MODEL.padEnd(31)}█
  ████████████████████████████████████████████████████████████████
  `);

  const startTime = Date.now();

  // Step 1: Scrape the live web
  console.log('━ STEP 1: SCRAPING LIVE WEB DATA ━━━━━━━━━━━━━━━━━\n');
  
  const [github, hn, reddit, productHunt] = await Promise.allSettled([
    scrapeGitHubTrending(),
    scrapeHackerNews(),
    scrapeReddit(),
    scrapeProductHunt()
  ]);

  const webData = {
    github: github.status === 'fulfilled' ? github.value : [],
    hackernews: hn.status === 'fulfilled' ? hn.value : [],
    reddit: reddit.status === 'fulfilled' ? reddit.value : [],
    producthunt: productHunt.status === 'fulfilled' ? productHunt.value : [],
  };

  const totalSources = 
    (webData.github.length > 0 ? 1 : 0) +
    (webData.hackernews.length > 0 ? 1 : 0) +
    (webData.reddit.length > 0 ? 1 : 0) +
    (webData.producthunt.length > 0 ? 1 : 0);

  console.log(`  GitHub trending: ${webData.github.length} repos`);
  console.log(`  Hacker News: ${webData.hackernews.length} stories`);
  console.log(`  Reddit: ${webData.reddit.length} posts`);
  console.log(`  Product Hunt: ${webData.producthunt.length} products`);
  console.log(`  Total live sources: ${totalSources}/4`);

  // Step 2: AI Analysis of web data
  console.log('\n━ STEP 2: AI ANALYSIS ─────────────────────────────\n');
  
  const analysis = await trendAnalysis(webData);
  const gaps = await findGaps(webData);

  // Step 3: Generate product ideas across 6 categories
  console.log('\n━ STEP 3: PRODUCT IDEATION ────────────────────────\n');

  const categories = [
    ['AI Agent Infrastructure', 'deployment, testing, monitoring, security, orchestration for AI agents'],
    ['AI Memory & Context', 'persistent memory, context optimization, memory sharing between agents'],
    ['AI Config & Skills', 'CLAUDE.md/AGENTS.md marketplace, testing, compliance, analytics'],
    ['AI Social Media & Content', 'multi-account management, compliance, closed-loop systems, analytics'],
    ['AI Developer Productivity', 'code review for AI code, auto-docs, dead code, framework migration'],
    ['AI Business Automation', 'vendor negotiation, contract review, SOC2, tax, meeting follow-up'],
  ];

  const categoryResults = await Promise.allSettled(
    categories.map(([name, focus]) =>
      researchWithData(name, `Find 10 product ideas in ${name}: ${focus}. Use the web data for evidence.`, webData)
    )
  );

  // Step 4: Compile report
  console.log('\n━ STEP 4: COMPILING REPORT ────────────────────────\n');

  const categoryMap = {
    agentInfrastructure: 0, memoryContext: 1, configSkills: 2,
    socialMedia: 3, devProductivity: 4, businessAutomation: 5
  };

  const report = {
    scanCycle: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    sources: {
      githubRepos: webData.github.length,
      hnStories: webData.hackernews.length,
      redditPosts: webData.reddit.length,
      productHunt: webData.producthunt.length,
      liveSources: totalSources
    },
    trends: analysis.trends || [],
    gaps: analysis.gaps || [],
    recommendations: analysis.recommendations || [],
    gapAnalysis: typeof gaps === 'string' ? gaps : gaps.raw || JSON.stringify(gaps).substring(0, 500),
    products: {},
    totalProducts: 0
  };

  for (const [key, idx] of Object.entries(categoryMap)) {
    const result = categoryResults[idx];
    report.products[key] = result.status === 'fulfilled' ? result.value : { error: result.reason?.message };
    if (Array.isArray(report.products[key])) {
      report.totalProducts += report.products[key].length;
    }
  }

  // Write report
  const filename = `god-mode-report-${new Date().toISOString().split('T')[0]}.json`;
  const reportPath = path.join(REPORT_DIR, filename);
  const latestPath = path.join(REPORT_DIR, 'god-mode-latest.json');
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

  // Write human-readable summary
  console.log(`  Report: ${reportPath}`);
  console.log(`  Products found: ${report.totalProducts}`);
  console.log(`  Duration: ${((Date.now() - startTime) / 1000).toFixed(0)}s`);
  
  if (report.trends && report.trends.length) {
    console.log('\n  TRENDS DETECTED:');
    report.trends.forEach((t, i) => console.log(`    ${i+1}. ${t}`));
  }
  if (report.gaps && report.gaps.length) {
    console.log('\n  GAPS IDENTIFIED:');
    report.gaps.forEach((g, i) => console.log(`    ${i+1}. ${g}`));
  }

  console.log('\n  PRODUCTS BY CATEGORY:');
  for (const [key, label] of [
    ['agentInfrastructure', 'Agent Infrastructure'],
    ['memoryContext', 'Memory & Context'],
    ['configSkills', 'Config & Skills'],
    ['socialMedia', 'Social Media'],
    ['devProductivity', 'Developer Productivity'],
    ['businessAutomation', 'Business Automation'],
  ]) {
    const products = report.products[key];
    if (Array.isArray(products)) {
      console.log(`  ✓ ${label}: ${products.length} products`);
      products.slice(0, 3).forEach(p => {
        const n = p.name || p.product || '?';
        const pr = p.price || p.pricing || '';
        console.log(`      ${n} ${pr ? '— ' + pr : ''}`);
      });
      if (products.length > 3) console.log(`      ... +${products.length - 3} more`);
    } else {
      console.log(`  ✗ ${label}: error`);
    }
  }

  console.log(`\n  ✓ God Mode v2 complete at ${new Date().toISOString()}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
