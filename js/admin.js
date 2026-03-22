import { WordGraph }      from './graph.js';
import { shortestPath, generatePuzzles, analyseGraph, bfs } from './solver.js';

const $ = (sel) => document.querySelector(sel);

const OP_LABELS = {
  substitute: 'S',
  insert:     'I',
  delete:     'D',
  anagram:    'A',
};

const OP_NAMES = {
  substitute: 'replaced',
  insert:     'added',
  delete:     'removed',
  anagram:    'anagrammed',
};

let graph = null;
let languageOptions = [];
let currentLanguageDir = null;

/* ================================================================== */
/*  Boot                                                               */
/* ================================================================== */

async function loadCorpus() {
  if (!currentLanguageDir) throw new Error('Language is not selected');
  const res  = await fetch(`data/languages/${currentLanguageDir}/corpus.txt`);
  if (!res.ok) throw new Error(`Failed to load corpus for ${currentLanguageDir}`);
  const text = await res.text();
  const words = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    words.push(parts[0].toLowerCase());
  }
  return words;
}

async function loadLanguageManifest() {
  const verifyEntries = async (entries) => {
    const out = [];
    for (const entry of entries) {
      const dir = entry?.dir;
      if (!dir) continue;
      try {
        const [cfgRes, corpusRes] = await Promise.all([
          fetch(`/data/languages/${dir}/language.json`, { cache: 'no-store' }),
          fetch(`/data/languages/${dir}/corpus.txt`, { cache: 'no-store' }),
        ]);
        if (!cfgRes.ok || !corpusRes.ok) continue;
        const text = await corpusRes.text();
        if (!text.trim()) continue;
        out.push(entry);
      } catch {
        // skip invalid entry
      }
    }
    return out;
  };

  const urls = ['/data/languages/index.json', 'data/languages/index.json'];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        const filtered = list.filter((l) => Number(l.words || 0) > 0);
        const verified = await verifyEntries(filtered);
        if (verified.length > 0) return verified;
      }
    } catch {
      // try fallback discovery
    }
  }

  const candidates = ['English', 'Spanish', 'French', 'Russian', 'Hebrew', 'Armenian', 'German'];
  const discovered = [];
  const fetchFirstOk = async (paths) => {
    for (const p of paths) {
      try {
        const r = await fetch(p, { cache: 'no-store' });
        if (r.ok) return r;
      } catch {
        // keep trying
      }
    }
    return null;
  };

  for (const dir of candidates) {
    try {
      const [cfgRes, corpusRes] = await Promise.all([
        fetchFirstOk([`/data/languages/${dir}/language.json`, `data/languages/${dir}/language.json`]),
        fetchFirstOk([`/data/languages/${dir}/corpus.txt`, `data/languages/${dir}/corpus.txt`]),
      ]);
      if (!cfgRes || !corpusRes) continue;
      const cfg = await cfgRes.json();
      const corpusText = await corpusRes.text();
      const words = corpusText.trim() ? corpusText.trim().split(/\r?\n/).length : 0;
      if (words <= 0) continue;
      discovered.push({
        dir,
        code: cfg.code || dir.slice(0, 2).toLowerCase(),
        menu: cfg.menu || dir,
        flag: cfg.flag || '',
        words,
      });
    } catch {
      // skip candidate
    }
  }
  return discovered;
}

function populateLanguageSelect(options) {
  const sel = $('#language-select');
  sel.innerHTML = '';
  for (const lang of options) {
    const opt = document.createElement('option');
    opt.value = lang.dir;
    const flag = lang.flag ? `${lang.flag} ` : '';
    opt.textContent = `${flag}${lang.menu}`;
    sel.appendChild(opt);
  }
}

async function loadSelectedLanguage() {
  log(`Loading corpus for ${currentLanguageDir}…`);
  const words = await loadCorpus();
  log(`Loaded ${words.length} words.`);

  log('Building graph…');
  graph = new WordGraph(words);
  const stats = graph.build();
  log(`Graph ready — ${stats.words} words, ${stats.edges} edges (${stats.ms} ms).`);
}

async function init() {
  languageOptions = await loadLanguageManifest();
  if (languageOptions.length === 0) throw new Error('No language corpora found');
  populateLanguageSelect(languageOptions);
  let saved = null;
  try { saved = localStorage.getItem('tw_admin_language_dir'); } catch {}
  currentLanguageDir = languageOptions.some((l) => l.dir === saved) ? saved : languageOptions[0].dir;
  $('#language-select').value = currentLanguageDir;
  await loadSelectedLanguage();

  $('#controls').classList.remove('hidden');
  $('#analyse-btn').addEventListener('click', onAnalyse);
  $('#generate-btn').addEventListener('click', onGenerate);
  $('#solve-btn').addEventListener('click', onSolve);
  $('#from-btn').addEventListener('click', onFindFromWord);
  $('#export-btn').addEventListener('click', onExport);
  $('#language-select').addEventListener('change', async (e) => {
    currentLanguageDir = e.target.value;
    try { localStorage.setItem('tw_admin_language_dir', currentLanguageDir); } catch {}
    await loadSelectedLanguage();
  });
}

/* ================================================================== */
/*  Actions                                                            */
/* ================================================================== */

function onAnalyse() {
  const sampleSize = parseInt($('#sample-size').value, 10) || 300;
  log(`Analysing graph (sampling ${sampleSize} seeds)…`);
  const t0 = performance.now();
  const info = analyseGraph(graph, sampleSize);
  const ms = Math.round(performance.now() - t0);

  log(`Analysis done in ${ms} ms.`);
  log(`  Connected components: ${info.components}`);
  log(`  Largest component: ${info.largestComponent} words`);
  log(`  Top component sizes: ${info.componentSizes.join(', ')}`);
  log(`  Distance histogram (sampled from ${info.sampleSize} seeds):`);
  for (const h of info.histogram) {
    log(`    distance ${String(h.distance).padStart(2)}: ${h.pairsFound} pairs`);
  }
}

function onGenerate() {
  const min = parseInt($('#min-steps').value, 10) || 2;
  const max = parseInt($('#max-steps').value, 10) || 5;
  const cnt = parseInt($('#pair-count').value, 10) || 20;

  log(`Generating up to ${cnt} puzzles (steps ${min}–${max})…`);
  const t0 = performance.now();
  const puzzles = generatePuzzles(graph, {
    minSteps: min, maxSteps: max, count: cnt, sampleSize: 400,
  });
  const ms = Math.round(performance.now() - t0);

  log(`Found ${puzzles.length} puzzle(s) in ${ms} ms.`);
  renderPuzzles(puzzles);
}

function onSolve() {
  const start = $('#start-word').value.trim().toLowerCase();
  const end   = $('#end-word').value.trim().toLowerCase();

  if (!graph.has(start)) { log(`"${start}" is not in the corpus.`); return; }
  if (!graph.has(end))   { log(`"${end}" is not in the corpus.`);   return; }

  const t0 = performance.now();
  const result = shortestPath(graph, start, end);
  const ms = Math.round(performance.now() - t0);

  if (!result) {
    log(`No path from "${start}" to "${end}" (${ms} ms). Different components.`);
    return;
  }
  log(`Shortest path: ${result.dist} steps (${ms} ms).`);
  renderPath(result.path);
}

function onFindFromWord() {
  const source = $('#from-word').value.trim().toLowerCase();
  let minSteps = parseInt($('#from-min-steps').value, 10) || 1;
  let maxSteps = parseInt($('#from-max-steps').value, 10) || 8;
  const limit = Math.max(10, Math.min(2000, parseInt($('#from-limit').value, 10) || 200));

  minSteps = Math.max(1, minSteps);
  maxSteps = Math.max(1, maxSteps);
  if (maxSteps < minSteps) {
    const tmp = minSteps;
    minSteps = maxSteps;
    maxSteps = tmp;
  }

  if (!source) {
    log('Please enter a source word.');
    return;
  }
  if (!graph.has(source)) {
    log(`"${source}" is not in the corpus.`);
    return;
  }

  log(`Searching reachable words from "${source}"...`);
  const t0 = performance.now();
  const result = bfs(graph, source);
  const items = [];
  for (const [word, info] of result.entries()) {
    if (word === source) continue;
    if (info.dist < minSteps || info.dist > maxSteps) continue;
    items.push({ word, dist: info.dist });
  }

  items.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.word.localeCompare(b.word);
  });
  const limited = items.slice(0, limit);
  const ms = Math.round(performance.now() - t0);

  log(
    `Found ${items.length} reachable words in ${ms} ms for steps ${minSteps}-${maxSteps} `
    + `(showing first ${limited.length}).`
  );
  renderTransformableWords(source, limited);
}

function onExport() {
  const easy   = parseInt($('#exp-easy').value, 10)   || 0;
  const medium = parseInt($('#exp-medium').value, 10)  || 0;
  const hard   = parseInt($('#exp-hard').value, 10)    || 0;

  log(`Generating export: ${easy} easy, ${medium} medium, ${hard} hard…`);

  const batches = [
    { difficulty: 'easy',   min: 2, max: 3, count: easy },
    { difficulty: 'medium', min: 4, max: 5, count: medium },
    { difficulty: 'hard',   min: 6, max: 8, count: hard },
  ];

  const output = [];
  for (const b of batches) {
    if (b.count <= 0) continue;
    const puzzles = generatePuzzles(graph, {
      minSteps: b.min, maxSteps: b.max, count: b.count, sampleSize: 600,
    });
    for (const p of puzzles) {
      output.push({
        start: p.start,
        end: p.end,
        optimalSteps: p.dist,
        difficulty: b.difficulty,
        solutionPath: p.path,
      });
    }
  }

  log(`Exporting ${output.length} puzzles…`);

  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'puzzles.json';
  a.click();
  URL.revokeObjectURL(url);

  log('Download started.');
}

/* ================================================================== */
/*  Rendering                                                          */
/* ================================================================== */

function renderPuzzles(puzzles) {
  const container = $('#results');
  container.innerHTML = '';

  if (puzzles.length === 0) {
    container.textContent = 'No puzzles found for this range.';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `<thead><tr>
    <th>#</th><th>Start</th><th>End</th><th>Steps</th><th>Path</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');

  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="word">${p.start}</td>
      <td class="word">${p.end}</td>
      <td>${p.dist}</td>
      <td class="path-cell">${formatPath(p.path)}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderPath(path) {
  const container = $('#results');
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'path-display';
  div.innerHTML = formatPath(path);
  container.appendChild(div);
}

function renderTransformableWords(source, items) {
  const container = $('#results');
  container.innerHTML = '';

  if (items.length === 0) {
    container.textContent = `No reachable words found for "${source}".`;
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `<thead><tr>
    <th>#</th><th>Word</th><th>Steps</th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="word">${it.word}</td>
      <td>${it.dist}</td>`;
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

function formatPath(path) {
  return path.map((word, i) => {
    if (i === 0) return `<span class="word">${word}</span>`;
    const op = graph.classifyOp(path[i - 1], word);
    const badge = op
      ? `<span class="op op-${op}" title="${OP_NAMES[op]}">${OP_LABELS[op]}</span>`
      : '';
    return ` → ${badge} <span class="word">${word}</span>`;
  }).join('');
}

/* ================================================================== */
/*  Log                                                                */
/* ================================================================== */

function log(msg) {
  const el = $('#log');
  const line = document.createElement('div');
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

/* ================================================================== */
/*  Start                                                              */
/* ================================================================== */

init().catch(err => log('Error: ' + err.message));
