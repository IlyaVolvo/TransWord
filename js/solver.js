/**
 * BFS-based solver and puzzle-pair generator for the word graph.
 */

/**
 * BFS from `start`.  Returns a Map<word, { dist, prev }> for every
 * reachable word.  `prev` lets us reconstruct the shortest path.
 *
 * @param {import('./graph.js').WordGraph} graph
 * @param {string} start
 * @param {number} [maxDist=Infinity]  stop exploring beyond this depth
 * @returns {Map<string, {dist: number, prev: string|null}>}
 */
export function bfs(graph, start, maxDist = Infinity) {
  const visited = new Map();
  visited.set(start, { dist: 0, prev: null });
  const queue = [start];
  let qi = 0;

  while (qi < queue.length) {
    const word = queue[qi++];
    const info = visited.get(word);
    if (info.dist >= maxDist) continue;

    for (const nb of graph.neighbors(word)) {
      if (!visited.has(nb)) {
        visited.set(nb, { dist: info.dist + 1, prev: word });
        queue.push(nb);
      }
    }
  }
  return visited;
}

/**
 * Reconstruct the shortest path between `start` and `end`
 * using the BFS result map.
 * @returns {string[]|null}  the path including both endpoints, or null
 */
export function reconstructPath(bfsResult, start, end) {
  if (!bfsResult.has(end)) return null;
  const path = [];
  let cur = end;
  while (cur !== null) {
    path.push(cur);
    cur = bfsResult.get(cur).prev;
  }
  path.reverse();
  return path;
}

/**
 * Find the shortest path between two words.
 * @returns {{path: string[], dist: number}|null}
 */
export function shortestPath(graph, start, end) {
  if (!graph.has(start) || !graph.has(end)) return null;
  if (start === end) return { path: [start], dist: 0 };
  const result = bfs(graph, start);
  const path = reconstructPath(result, start, end);
  if (!path) return null;
  return { path, dist: path.length - 1 };
}

/* ------------------------------------------------------------------ */
/*  Puzzle pair generation                                             */
/* ------------------------------------------------------------------ */

/**
 * Generate puzzle pairs by sampling random starting words and collecting
 * reachable words at desired distances.
 *
 * @param {import('./graph.js').WordGraph} graph
 * @param {object} opts
 * @param {number}  opts.minSteps   minimum shortest-path distance (inclusive)
 * @param {number}  opts.maxSteps   maximum shortest-path distance (inclusive)
 * @param {number}  [opts.count=20]    how many pairs to return
 * @param {number}  [opts.sampleSize=200] how many seed words to BFS from
 * @returns {{start: string, end: string, dist: number, path: string[]}[]}
 */
export function generatePuzzles(graph, opts) {
  const { minSteps, maxSteps, count = 20, sampleSize = 200 } = opts;
  const words = graph.words;
  const puzzles = [];
  const usedStarts = new Set();
  const usedEnds   = new Set();
  const seen       = new Set();

  const seeds = _sample(words, Math.min(sampleSize, words.length));

  for (const seed of seeds) {
    if (puzzles.length >= count) break;
    if (usedStarts.has(seed)) continue;

    const result = bfs(graph, seed, maxSteps);

    // Collect all valid candidates, then pick one at random per seed
    const candidates = [];
    for (const [word, { dist }] of result) {
      if (dist < minSteps || dist > maxSteps) continue;
      if (usedEnds.has(word)) continue;
      const key = [seed, word].sort().join('|');
      if (seen.has(key)) continue;
      candidates.push({ word, dist, key });
    }

    if (candidates.length === 0) continue;

    // Pick a random candidate (one per seed for diversity)
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    seen.add(pick.key);
    usedStarts.add(seed);
    usedEnds.add(pick.word);

    const path = reconstructPath(result, seed, pick.word);
    puzzles.push({ start: seed, end: pick.word, dist: pick.dist, path });
  }

  puzzles.sort((a, b) => a.dist - b.dist);
  return puzzles;
}

/**
 * Analyse the full graph: find connected components and compute a
 * difficulty histogram (how many pairs exist at each distance).
 * Uses a bounded sample to stay fast in the browser.
 *
 * @param {import('./graph.js').WordGraph} graph
 * @param {number} [sampleSize=300]
 */
export function analyseGraph(graph, sampleSize = 300) {
  const components = _connectedComponents(graph);
  const compSizes = components.map(c => c.length).sort((a, b) => b - a);

  const distHist = new Map();
  const seeds = _sample(graph.words, Math.min(sampleSize, graph.words.length));

  let maxDist = 0;
  let totalPairs = 0;
  for (const seed of seeds) {
    const result = bfs(graph, seed);
    for (const { dist } of result.values()) {
      if (dist === 0) continue;
      distHist.set(dist, (distHist.get(dist) || 0) + 1);
      if (dist > maxDist) maxDist = dist;
      totalPairs++;
    }
  }

  const histogram = [];
  for (let d = 1; d <= maxDist; d++) {
    histogram.push({ distance: d, pairsFound: distHist.get(d) || 0 });
  }

  return {
    totalWords: graph.words.length,
    components: compSizes.length,
    largestComponent: compSizes[0] || 0,
    componentSizes: compSizes.slice(0, 10),
    histogram,
    sampleSize: seeds.length,
    totalPairsSampled: totalPairs,
  };
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function _connectedComponents(graph) {
  const visited = new Set();
  const components = [];

  for (const word of graph.words) {
    if (visited.has(word)) continue;
    const comp = [];
    const stack = [word];
    while (stack.length) {
      const w = stack.pop();
      if (visited.has(w)) continue;
      visited.add(w);
      comp.push(w);
      for (const nb of graph.neighbors(w)) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    components.push(comp);
  }
  return components;
}

function _sample(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
