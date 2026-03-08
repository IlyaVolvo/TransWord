import { WordGraph }      from './graph.js';
import { shortestPath, generatePuzzles, analyseGraph } from './solver.js';

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

/* ================================================================== */
/*  Boot                                                               */
/* ================================================================== */

async function loadCorpus() {
  const res  = await fetch('data/corpus_with_plurals.txt');
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

async function init() {
  log('Loading corpus…');
  const words = await loadCorpus();
  log(`Loaded ${words.length} words.`);

  log('Building graph…');
  graph = new WordGraph(words);
  const stats = graph.build();
  log(`Graph ready — ${stats.words} words, ${stats.edges} edges (${stats.ms} ms).`);

  $('#controls').classList.remove('hidden');
  $('#analyse-btn').addEventListener('click', onAnalyse);
  $('#generate-btn').addEventListener('click', onGenerate);
  $('#solve-btn').addEventListener('click', onSolve);
  $('#export-btn').addEventListener('click', onExport);
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
