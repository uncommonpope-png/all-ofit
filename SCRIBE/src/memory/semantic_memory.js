'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SemanticMemory {
  constructor(options = {}) {
    this.storePath = options.storePath || path.join(__dirname, '..', '..', 'data', 'semantic_store.json');
    this.embeddingsPath = options.embeddingsPath || path.join(__dirname, '..', '..', 'data', 'embeddings.jsonl');
    this.dimension = options.dimension || 1536;
    this.similarityThreshold = options.similarityThreshold || 0.05;
    this.maxMemories = options.maxMemories || 10000;
    this.decayThreshold = options.decayThreshold || 0.3;
    this.decayRate = options.decayRate || 0.001;
    this.embedCache = new Map();
    this.embeddings = [];
    this.memories = new Map();
    this.clusters = new Map();
    this._ensureFiles();
    this._load();
  }

  _ensureFiles() {
    const dir = path.dirname(this.embeddingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.storePath)) {
      fs.writeFileSync(this.storePath, JSON.stringify({ version: 1, memories: [] }));
    }
    if (!fs.existsSync(this.embeddingsPath)) {
      fs.writeFileSync(this.embeddingsPath, '');
    }
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
      for (const mem of data.memories || []) {
        this.memories.set(mem.id, mem);
      }
    } catch {}
    try {
      const lines = fs.readFileSync(this.embeddingsPath, 'utf-8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const emb = JSON.parse(line);
          this.embeddings.push(emb);
        } catch {}
      }
    } catch {}
  }

  async _generateEmbedding(text) {
    const cacheKey = text.slice(0, 100);
    if (this.embedCache.has(cacheKey)) return this.embedCache.get(cacheKey);
    try {
      const { run } = require('../skills/llm');
      const result = await run({ op: 'embed', prompt: text });
      if (result.ok && result.embedding) {
        this.embedCache.set(cacheKey, result.embedding);
        return result.embedding;
      }
    } catch {}
    return this._fallbackEmbedding(text);
  }

  _fallbackEmbedding(text) {
    // Character n-gram based embedding (trigrams).
    // Two texts sharing character sequences get overlapping vectors.
    const VEC_DIM = 512;
    const text_lower = text.toLowerCase();
    // Extract trigrams
    const grams = new Map();
    for (let i = 0; i < text_lower.length - 2; i++) {
      const gram = text_lower.substring(i, i + 3);
      grams.set(gram, (grams.get(gram) || 0) + 1);
    }
    if (grams.size === 0) {
      const vec = new Array(VEC_DIM).fill(0);
      vec[0] = 1;
      return vec;
    }
    const maxFreq = Math.max(...grams.values());
    const vec = new Array(VEC_DIM).fill(0);
    for (const [gram, count] of grams) {
      const hash = crypto.createHash('md5').update(gram).digest();
      // Map the 16 hash bytes into 8 positions in the vector (2 per byte)
      const tf = count / maxFreq;
      for (let i = 0; i < 8; i++) {
        const pos = ((hash[i * 2] || 0) * 256 + (hash[i * 2 + 1] || 0)) % VEC_DIM;
        vec[pos] += tf;
      }
    }
    // Normalize to unit vector
    const mag = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
    return vec.map(v => v / mag);
  }

  _cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
  }

  _assignCluster(memory) {
    if (!this.clusters.has(memory.cluster)) {
      this.clusters.set(memory.cluster, []);
    }
    this.clusters.get(memory.cluster).push(memory.id);
  }

  _updateClusters() {
    this.clusters.clear();
    for (const [id, mem] of this.memories) {
      this._assignCluster(mem);
    }
  }

  async store(content, metadata = {}) {
    const id = 'smem_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    const embedding = await this._generateEmbedding(content);
    const entry = {
      id,
      content,
      embedding,
      cluster: this._getClusterLabel(content),
      metadata,
      weight: metadata.weight || 0.5,
      accessCount: 0,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      decay: 0,
    };
    this.memories.set(id, entry);
    fs.appendFileSync(this.embeddingsPath, JSON.stringify({ id, embedding }) + '\n');
    this._assignCluster(entry);
    this._persist();
    return entry;
  }

  _getClusterLabel(content) {
    const labels = {
      'task': /task|goal|project|build|implement|create|finish|complete/i,
      'knowledge': /fact|know|learn|information|data|knowledge|understand/i,
      'decision': /decide|choice|option|prefer|select|choose|alternative/i,
      'social': /user|person|contact|email|message|people|team/i,
      'technical': /code|api|function|error|debug|system|server|database/i,
    };
    for (const [label, pattern] of Object.entries(labels)) {
      if (pattern.test(content)) return label;
    }
    return 'general';
  }

  _wordOverlap(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 1));
    const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 1));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let intersection = 0;
    for (const w of wordsA) if (wordsB.has(w)) intersection++;
    const union = wordsA.size + wordsB.size - intersection;
    return intersection / union;
  }

  async search(query, options = {}) {
    const { limit = 10, cluster = null, minSimilarity = this.similarityThreshold } = options;
    const queryEmbedding = await this._generateEmbedding(query);
    const queryWords = new Set(query.toLowerCase().split(/\W+/).filter(w => w.length > 1));
    const results = [];
    for (const [id, mem] of this.memories) {
      if (cluster && mem.cluster !== cluster) continue;
      const embSim = this._cosineSimilarity(queryEmbedding, mem.embedding);
      // Compute word overlap as a secondary signal for fallback matching
      const wordSim = this._wordOverlap(query, mem.content);
      // Combine: embedding similarity + word overlap bonus
      // When embeddings are real (LLM-based), embSim dominates.
      // When using fallback hash/n-gram embeddings, wordSim provides the signal.
      const combinedSim = embSim + wordSim * 0.5;
      if (combinedSim >= minSimilarity || wordSim >= 0.3) {
        mem.accessCount++;
        mem.lastAccessed = new Date().toISOString();
        results.push({ ...mem, similarity: combinedSim, embSim, wordSim });
      }
    }
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  async getCluster(cluster) {
    const clusterMemories = [];
    for (const [id, mem] of this.memories) {
      if (mem.cluster === cluster) clusterMemories.push(mem);
    }
    return clusterMemories.sort((a, b) => b.weight - a.weight);
  }

  async applyDecay() {
    const now = Date.now();
    const toRemove = [];
    for (const [id, mem] of this.memories) {
      const age = (now - new Date(mem.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      mem.decay = this.decayRate * age;
      const effectiveWeight = mem.weight * (1 - mem.decay) - (0.1 * mem.accessCount / (age + 1));
      if (effectiveWeight < this.decayThreshold) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.memories.delete(id);
    }
    if (toRemove.length > 0) this._persist();
    return toRemove.length;
  }

  async consolidate() {
    const clusterSummaries = {};
    for (const [cluster, ids] of this.clusters) {
      if (ids.length < 3) continue;
      const memories = ids.map(id => this.memories.get(id)).filter(Boolean);
      const avgWeight = memories.reduce((a, m) => a + m.weight, 0) / memories.length;
      clusterSummaries[cluster] = { count: ids.length, avgWeight, sample: memories[0].content.slice(0, 100) };
    }
    return clusterSummaries;
  }

  _persist() {
    if (this.memories.size > this.maxMemories) {
      const sorted = [...this.memories.values()].sort((a, b) => {
        const scoreA = a.weight * (1 - a.decay) - a.accessCount * 0.01;
        const scoreB = b.weight * (1 - b.decay) - b.accessCount * 0.01;
        return scoreB - scoreA;
      });
      const keep = sorted.slice(0, this.maxMemories);
      this.memories.clear();
      for (const mem of keep) this.memories.set(mem.id, mem);
    }
    const data = { version: 1, memories: [...this.memories.values()] };
    fs.writeFileSync(this.storePath, JSON.stringify(data));
    this._updateClusters();
  }

  async clear() {
    this.memories.clear();
    this.clusters.clear();
    this.embeddings = [];
    this._persist();
    fs.writeFileSync(this.embeddingsPath, '');
  }

  get size() { return this.memories.size; }
  get clusterCount() { return this.clusters.size; }
}

module.exports = { SemanticMemory };
