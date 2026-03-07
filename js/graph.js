/**
 * Word transformation graph.
 *
 * Edges connect two words when one can be reached from the other via exactly
 * one of four operations:
 *   1. Substitute – replace one letter           (same length, Hamming dist 1)
 *   2. Insert     – add a letter anywhere         (target is 1 char longer)
 *   3. Delete     – remove a letter from anywhere (target is 1 char shorter)
 *   4. Anagram    – rearrange all letters          (same sorted chars, ≠ word)
 *
 * The graph is undirected (every operation has an inverse).
 */
export class WordGraph {
  /** @param {string[]} words */
  constructor(words) {
    this.words = words;
    this.wordSet = new Set(words);
    this.adj = new Map();            // word → Set<word>
    this.anagramIndex = new Map();   // sorted-key → [word, …]
    for (const w of words) this.adj.set(w, new Set());
  }

  /* ------------------------------------------------------------------ */
  /*  Graph construction                                                 */
  /* ------------------------------------------------------------------ */

  build() {
    const t0 = performance.now();
    this._buildAnagramEdges();
    this._buildSubstitutionEdges();
    this._buildDeletionEdges();      // also covers insertion (reverse)
    const elapsed = performance.now() - t0;

    let edgeCount = 0;
    for (const neighbors of this.adj.values()) edgeCount += neighbors.size;
    edgeCount /= 2; // undirected

    return { words: this.words.length, edges: edgeCount, ms: Math.round(elapsed) };
  }

  /* --- anagram edges ------------------------------------------------- */

  _sortedKey(word) {
    return word.split('').sort().join('');
  }

  _buildAnagramEdges() {
    const groups = new Map();
    for (const w of this.words) {
      const key = this._sortedKey(w);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    }
    this.anagramIndex = groups;

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          this._addEdge(group[i], group[j]);
        }
      }
    }
  }

  /* --- substitution edges -------------------------------------------- */

  _buildSubstitutionEdges() {
    const buckets = new Map(); // pattern → [word, …]
    for (const w of this.words) {
      for (let i = 0; i < w.length; i++) {
        const pattern = w.slice(0, i) + '*' + w.slice(i + 1);
        if (!buckets.has(pattern)) buckets.set(pattern, []);
        buckets.get(pattern).push(w);
      }
    }
    for (const group of buckets.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          this._addEdge(group[i], group[j]);
        }
      }
    }
  }

  /* --- deletion edges (+ insertion via reverse) ---------------------- */

  _buildDeletionEdges() {
    for (const w of this.words) {
      for (let i = 0; i < w.length; i++) {
        const shortened = w.slice(0, i) + w.slice(i + 1);
        if (this.wordSet.has(shortened)) {
          this._addEdge(w, shortened);
        }
      }
    }
  }

  /* --- helpers -------------------------------------------------------- */

  _addEdge(a, b) {
    this.adj.get(a).add(b);
    this.adj.get(b).add(a);
  }

  neighbors(word) {
    return this.adj.get(word) || new Set();
  }

  has(word) {
    return this.wordSet.has(word);
  }

  degree(word) {
    return (this.adj.get(word) || new Set()).size;
  }

  /**
   * Classify the operation that transforms `a` into `b`.
   * Returns one of: 'substitute' | 'insert' | 'delete' | 'anagram' | null
   */
  classifyOp(a, b) {
    if (a === b) return null;

    if (a.length === b.length) {
      let diffs = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
      if (diffs === 1) return 'substitute';
      if (this._sortedKey(a) === this._sortedKey(b)) return 'anagram';
    }

    if (b.length === a.length - 1) {
      for (let i = 0; i < a.length; i++) {
        if (a.slice(0, i) + a.slice(i + 1) === b) return 'delete';
      }
    }

    if (b.length === a.length + 1) {
      for (let i = 0; i < b.length; i++) {
        if (b.slice(0, i) + b.slice(i + 1) === a) return 'insert';
      }
    }

    if (a.length === b.length && this._sortedKey(a) === this._sortedKey(b)) {
      return 'anagram';
    }

    return null;
  }
}
