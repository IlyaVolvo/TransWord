import { WordGraph }      from './graph.js';
import { shortestPath, generatePuzzles } from './solver.js';

const $ = (sel) => document.querySelector(sel);

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */

let wordLevels  = new Map();  // word → 1|2|3
let fullGraph   = null;       // all words — used for player validation
let puzzleGraph = null;       // level-filtered — used for puzzle generation
let puzzle      = null;       // { start, end, dist, path }
let chain       = [];         // words the player has committed so far (includes start)
let timerStart  = null;
let timerHandle = null;
let solved      = false;

const OP_LABELS = {
  substitute: 'replaced',
  insert:     'added',
  delete:     'removed',
  anagram:    'anagrammed',
};

/* ================================================================== */
/*  Boot                                                               */
/* ================================================================== */

async function loadCorpus() {
  const res  = await fetch('data/corpus_with_plurals.txt');
  const text = await res.text();
  const entries = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    const word  = parts[0].toLowerCase();
    const level = parseInt(parts[1], 10) || 1;
    entries.push({ word, level });
  }
  return entries;
}

function selectedLevel() {
  return parseInt($('#level-select').value, 10);
}

function buildGraphs(entries) {
  const lvl = selectedLevel();
  wordLevels = new Map();
  const allWords = [];
  const puzzleWords = [];

  for (const { word, level } of entries) {
    wordLevels.set(word, level);
    allWords.push(word);
    if (level <= lvl) puzzleWords.push(word);
  }

  fullGraph = new WordGraph(allWords);
  fullGraph.build();

  puzzleGraph = new WordGraph(puzzleWords);
  puzzleGraph.build();
}

let corpusEntries = null;

async function init() {
  setLoading('Loading corpus…');
  corpusEntries = await loadCorpus();
  setLoading(`Building graphs (${corpusEntries.length} words)…`);

  await nextFrame();
  buildGraphs(corpusEntries);

  hideLoading();
  $('#game').classList.remove('hidden');

  $('#new-btn').addEventListener('click', () => startNewPuzzle());
  $('#win-new-btn').addEventListener('click', () => { $('#win-overlay').classList.add('hidden'); startNewPuzzle(); });
  $('#level-select').addEventListener('change', onLevelChange);

  startNewPuzzle();
}

function onLevelChange() {
  showLoading('Rebuilding graph…');
  requestAnimationFrame(() => {
    buildGraphs(corpusEntries);
    hideLoading();
    startNewPuzzle();
  });
}

/* ================================================================== */
/*  Puzzle lifecycle                                                   */
/* ================================================================== */

function difficultyRange() {
  const v = parseInt($('#difficulty').value, 10);
  if (v <= 3) return [2, 3];
  if (v <= 5) return [4, 5];
  return [6, 8];
}

function startNewPuzzle() {
  const [min, max] = difficultyRange();
  const puzzles = generatePuzzles(puzzleGraph, { minSteps: min, maxSteps: max, count: 5, sampleSize: 500 });

  if (puzzles.length === 0) {
    alert('Could not find a puzzle for this difficulty / level. Try another setting.');
    return;
  }

  puzzle = puzzles[Math.floor(Math.random() * puzzles.length)];
  chain  = [puzzle.start];
  solved = false;

  $('#target-word').textContent = puzzle.end;
  $('#optimal-count').textContent = puzzle.dist;
  $('#step-count').textContent = '0';
  $('#win-overlay').classList.add('hidden');

  startTimer();
  renderChain();
}

/* ================================================================== */
/*  Timer                                                              */
/* ================================================================== */

function startTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerStart = Date.now();
  updateTimerDisplay();
  timerHandle = setInterval(updateTimerDisplay, 250);
}

function stopTimer() {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

function elapsedStr() {
  const s = Math.floor((Date.now() - timerStart) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  $('#timer').textContent = elapsedStr();
}

/* ================================================================== */
/*  Letter diff – compute per-character highlights                     */
/* ================================================================== */

function diffLetters(prev, cur, op) {
  const result = cur.split('').map(ch => ({ char: ch, cls: '' }));
  if (!op || !prev) return result;

  switch (op) {
    case 'substitute': {
      for (let i = 0; i < cur.length; i++) {
        if (prev[i] !== cur[i]) result[i].cls = 'letter-green';
      }
      break;
    }
    case 'insert': {
      for (let i = 0; i < cur.length; i++) {
        if (cur.slice(0, i) + cur.slice(i + 1) === prev) {
          result[i].cls = 'letter-green';
          break;
        }
      }
      break;
    }
    case 'delete': {
      for (let i = 0; i < prev.length; i++) {
        if (prev.slice(0, i) + prev.slice(i + 1) === cur) {
          if (i - 1 >= 0)     result[i - 1].cls = 'letter-yellow';
          if (i < cur.length)  result[i].cls     = 'letter-yellow';
          break;
        }
      }
      break;
    }
    case 'anagram': {
      for (let i = 0; i < cur.length; i++) {
        if (prev[i] !== cur[i]) result[i].cls = 'letter-red';
      }
      break;
    }
  }
  return result;
}

/* ================================================================== */
/*  Render the chain                                                   */
/* ================================================================== */

function renderChain() {
  const container = $('#chain');
  container.innerHTML = '';

  for (let i = 0; i < chain.length; i++) {
    if (i > 0) {
      container.appendChild(makeConnector(chain[i - 1], chain[i]));
    }
    const isFirst    = i === 0;
    const isEnd      = chain[i] === puzzle.end;
    const canUndo    = !solved && !isFirst && i === chain.length - 1;
    const prevWord   = i > 0 ? chain[i - 1] : null;
    container.appendChild(makeWordNode(chain[i], isFirst, isEnd, canUndo, prevWord));
  }

  if (!solved) {
    container.appendChild(makeConnector(null, null));
    container.appendChild(makeInputNode());
  }

  $('#step-count').textContent = chain.length - 1;

  scrollToBottom();
}

function makeWordNode(word, isStart, isEnd, canUndo, prevWord) {
  const node = document.createElement('div');
  node.className = 'node';

  const wrap = document.createElement('div');
  wrap.className = 'word-slot-wrap';

  const slot = document.createElement('div');
  slot.className = 'word-slot';
  if (isStart) slot.classList.add('start-word');
  if (isEnd)   slot.classList.add('end-word');

  if (prevWord) {
    const op = fullGraph.classifyOp(prevWord, word);
    const letters = diffLetters(prevWord, word, op);
    for (const { char, cls } of letters) {
      const span = document.createElement('span');
      span.textContent = char;
      if (cls) span.className = cls;
      slot.appendChild(span);
    }
  } else {
    slot.textContent = word;
  }

  wrap.appendChild(slot);

  if (canUndo) {
    const x = document.createElement('button');
    x.className = 'undo-x';
    x.textContent = '↑';
    x.title = 'Remove this step';
    x.addEventListener('click', undo);
    wrap.appendChild(x);
  }

  node.appendChild(wrap);
  return node;
}

function makeConnector(prev, cur) {
  const conn = document.createElement('div');
  conn.className = 'connector';
  const line = document.createElement('div');
  line.className = 'connector-line';
  conn.appendChild(line);

  if (prev && cur) {
    const op = fullGraph.classifyOp(prev, cur);
    if (op) {
      const badge = document.createElement('span');
      badge.className = `op-badge ${op}`;
      badge.textContent = OP_LABELS[op] || op;
      conn.appendChild(badge);
    }
  }
  return conn;
}

function makeInputNode() {
  const node = document.createElement('div');
  node.className = 'node';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input-slot';
  input.placeholder = 'type a word…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.id = 'word-input';

  const hint = document.createElement('div');
  hint.className = 'error-hint';
  hint.id = 'error-hint';

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitWord(input.value.trim().toLowerCase());
    }
  });

  node.appendChild(input);
  node.appendChild(hint);

  requestAnimationFrame(() => input.focus());
  return node;
}

/* ================================================================== */
/*  Submit / validate                                                  */
/* ================================================================== */

function submitWord(word) {
  const input = $('#word-input');
  const hint  = $('#error-hint');
  if (!word) return;

  clearError();

  const prev = chain[chain.length - 1];

  if (word === prev) {
    flashError(input, hint, 'Same as previous word');
    return;
  }

  if (!fullGraph.has(word)) {
    flashError(input, hint, 'Not in dictionary');
    return;
  }

  const op = fullGraph.classifyOp(prev, word);
  if (!op) {
    flashError(input, hint, 'Not a valid single-step transform');
    return;
  }

  // Valid move
  chain.push(word);

  if (word === puzzle.end) {
    solved = true;
    stopTimer();
    renderChain();
    showWin();
    return;
  }

  renderChain();
}

function flashError(input, hint, msg) {
  input.classList.remove('shake');
  void input.offsetWidth;
  input.classList.add('shake');
  hint.textContent = msg;
  hint.classList.add('visible');

  setTimeout(() => {
    input.classList.remove('shake');
  }, 500);
}

function clearError() {
  const hint = $('#error-hint');
  if (hint) hint.classList.remove('visible');
}

/* ================================================================== */
/*  Undo                                                               */
/* ================================================================== */

function undo() {
  if (chain.length <= 1 || solved) return;
  chain.pop();
  renderChain();
}

/* ================================================================== */
/*  Win                                                                */
/* ================================================================== */

function showWin() {
  const steps = chain.length - 1;
  $('#win-steps').textContent   = steps;
  $('#win-optimal').textContent = puzzle.dist;
  $('#win-time').textContent    = elapsedStr();

  const pathEl = $('#win-path');
  pathEl.innerHTML = chain.map((w, i) => {
    if (i === 0) return `<strong>${w}</strong>`;
    const op = fullGraph.classifyOp(chain[i - 1], w);
    const badge = op ? `<span class="op-inline ${op}">${OP_LABELS[op] || op}</span>` : '';
    return ` → ${badge} <strong>${w}</strong>`;
  }).join('');

  $('#win-overlay').classList.remove('hidden');
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function scrollToBottom() {
  const c = $('#chain-container');
  requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
}

function setLoading(msg) {
  $('#loading-msg').textContent = msg;
}

function showLoading(msg) {
  const el = $('#loading');
  el.classList.remove('hidden', 'fade-out');
  el.style.opacity = '1';
  $('#loading-msg').textContent = msg;
}

function hideLoading() {
  $('#loading').classList.add('fade-out');
  setTimeout(() => $('#loading').classList.add('hidden'), 400);
}

function nextFrame() {
  return new Promise(r => requestAnimationFrame(r));
}

/* ================================================================== */
/*  Start                                                              */
/* ================================================================== */

init();
