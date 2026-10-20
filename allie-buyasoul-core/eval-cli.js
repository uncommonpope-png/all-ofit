#!/usr/bin/env node
// eval-cli.js — BuyASoul PLT Idea Scorer
// Scores any idea against the Profit Bible formula: Profit + Love - Tax = True Value
// Usage: node eval-cli.js "some idea worth scoring" [--json]
'use strict';

const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, 'data', 'plt-scores.jsonl');

// Simple lexical scoring: heuristics over the idea text.
// Deliberately transparent — every score is traceable to a matched keyword.
const PROFIT_WORDS = ['revenue', 'sell', 'profit', 'growth', 'scale', 'market', 'price', 'earn', 'multiply', 'business', 'customer'];
const LOVE_WORDS  = ['love', 'serve', 'people', 'community', 'help', 'care', 'bond', 'connect', 'heal', 'joy', 'kind', 'share'];
const TAX_WORDS   = ['cost', 'risk', 'time', 'tax', 'fee', 'legal', 'maintenance', 'burn', 'debt', 'overhead', 'dependency'];

function scoreIdea(text) {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const total = Math.max(words.length, 1);

  const count = (list) => list.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);

  const profit = count(PROFIT_WORDS);
  const love = count(LOVE_WORDS);
  const tax = count(TAX_WORDS);

  const p = Math.min(profit / 3, 1.0);
  const l = Math.min(love / 3, 1.0);
  const t = Math.min(tax / 3, 1.0);

  const trueValue = p + l - t;
  const proceed = trueValue > 0;

  const verdict = proceed
    ? (trueValue > 1 ? 'PROCEED — high true value' : 'PROCEED — net positive')
    : 'HOLD — tax outweighs value';

  return {
    idea: text,
    wordCount: total,
    hits: { profit, love, tax },
    scores: { profit: round2(p), love: round2(l), tax: round2(t) },
    trueValue: round2(trueValue),
    proceed,
    verdict,
    scoredAt: new Date().toISOString()
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json');
  const idea = args.filter((a) => a !== '--json').join(' ').trim();

  if (!idea) {
    console.error('Usage: node eval-cli.js "your idea" [--json]');
    process.exit(1);
  }

  const result = scoreIdea(idea);

  // Persist a record — the ledger never lies.
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.appendFileSync(OUT_FILE, JSON.stringify(result) + '\n');

  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const { scores, trueValue, verdict } = result;
    console.log('─'.repeat(48));
    console.log('PLT SCORE');
    console.log('─'.repeat(48));
    console.log(`  Profit +${scores.profit.toFixed(2)}   Love +${scores.love.toFixed(2)}   Tax -${scores.tax.toFixed(2)}`);
    console.log('─'.repeat(48));
    console.log(`  True Value: ${trueValue.toFixed(2)}`);
    console.log(`  Verdict:    ${verdict}`);
    console.log('─'.repeat(48));
    console.log(`  Ledger: ${OUT_FILE}`);
  }
}

main();
