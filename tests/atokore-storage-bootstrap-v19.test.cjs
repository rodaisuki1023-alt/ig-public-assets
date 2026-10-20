// v19 storage bootstrap: unreadable data and the one-time copy from older trials must never
// destroy data — not when a backup write fails, not when a read fails, not half way through.
// The bootstrap is tested as published: built by scripts/atokore/build-preview.py (trial keys).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'atokore-boot-'));
execFileSync('python3', ['-I', path.join(repo, 'scripts/atokore/build-preview.py'), path.join(repo, 'atokore-live-v125'), path.join(out, 'v19'), '19'], { stdio: 'ignore' });
const { run } = require(path.join(out, 'v19', 'storage-bootstrap-v19.js'));

const KEY = 'atokorePreviewTrialV19', HISTORY = 'atokorePreviewHistoryV19';
const V17 = 'atokorePreviewTrialV17', V17H = 'atokorePreviewHistoryV17', V16 = 'atokorePreviewTrialV16';
const state = n => JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'item' + i, qty: 1 })), buys: [], routines: [] });

// localStorage stand-in with failure injection for reads, writes and removals.
function store(initial, { failGet = () => false, failSet = () => false, failRemove = () => false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(k) { if (failGet(k)) throw new Error('SecurityError'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (failSet(k, v)) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } map.set(k, String(v)); },
    removeItem(k) { if (failRemove(k)) throw new Error('remove failed'); map.delete(k); },
    snapshot() { return Object.fromEntries(map); },
  };
}

test('unreadable data whose backup cannot be written is kept as is, and nothing is copied over it', () => {
  const s = store({ [KEY]: '{broken', [V17]: state(3) }, { failSet: k => k.includes('Unreadable') });
  const notes = run(s);
  assert.equal(s.map.get(KEY), '{broken', 'original unreadable data must survive');
  assert.equal(s.map.get(V17), state(3));
  assert.deepEqual(Object.keys(s.snapshot()).sort(), [KEY, V17].sort(), 'nothing else written');
  assert.ok(notes.some(n => n.type === 'locked' && n.reason === 'unreadable-backup-failed'), JSON.stringify(notes));
});

test('if the unreadable data cannot be removed after backing it up, nothing is copied over it', () => {
  const s = store({ [KEY]: '{broken', [V17]: state(2) }, { failRemove: k => k === KEY });
  const notes = run(s);
  assert.equal(s.map.get(KEY), '{broken');
  const aside = [...s.map.keys()].find(k => k.startsWith(KEY + 'Unreadable'));
  assert.equal(aside && s.map.get(aside), '{broken', 'the backup copy exists');
  assert.ok(notes.some(n => n.type === 'locked'), JSON.stringify(notes));
});

test('a failed read of the saved data writes nothing and locks saving', () => {
  const s = store({ [KEY]: state(4), [V17]: state(1) }, { failGet: k => k === KEY });
  const notes = run(s);
  assert.deepEqual(s.snapshot(), { [KEY]: state(4), [V17]: state(1) });
  assert.ok(notes.some(n => n.type === 'locked' && n.reason === 'read-failed'), JSON.stringify(notes));
});

test('a migration that fails half way leaves no partial copy behind', () => {
  const s = store({ [V17]: state(2), [V17H]: '[{"id":1,"title":"x"}]' }, { failSet: k => k.endsWith('MigratedFrom') });
  const notes = run(s);
  assert.deepEqual(s.snapshot(), { [V17]: state(2), [V17H]: '[{"id":1,"title":"x"}]' }, 'v19 data and history rolled back, v17 untouched');
  assert.ok(notes.some(n => n.type === 'migration-failed'), JSON.stringify(notes));
});

test('an unreadable v17 never makes the bootstrap fall back to older v16 data', () => {
  for (const s of [
    store({ [V17]: state(5), [V16]: state(1) }, { failGet: k => k === V17 }),
    store({ [V17]: '{also broken', [V16]: state(1) }),
  ]) {
    const before = s.snapshot();
    const notes = run(s);
    assert.deepEqual(s.snapshot(), before, 'nothing copied');
    assert.ok(notes.some(n => n.type === 'migration-skipped'), JSON.stringify(notes));
  }
});

test('normal cases still work: unreadable data moved aside, v17 copied once, existing v19 kept', () => {
  const a = store({ [KEY]: '{broken', [V17]: state(2) });
  run(a);
  const aside = [...a.map.keys()].find(k => k.startsWith(KEY + 'Unreadable'));
  assert.equal(a.map.get(aside), '{broken');
  assert.equal(a.map.get(KEY), state(2));

  const b = store({ [V17]: state(3), [V17H]: '[]' });
  assert.ok(run(b).some(n => n.type === 'migrated'));
  assert.equal(b.map.get(KEY), state(3));
  assert.equal(b.map.get(HISTORY), '[]');
  assert.equal(b.map.get(V17), state(3));

  const c = store({ [KEY]: state(7), [V17]: state(3) });
  assert.deepEqual(run(c), []);
  assert.equal(c.map.get(KEY), state(7));
});
