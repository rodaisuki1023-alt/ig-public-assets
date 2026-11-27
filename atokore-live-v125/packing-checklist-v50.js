/* あとこれ：持ち物チェックMVP。買い物/在庫/家族同期を一切変更しない、端末内専用。 */
(function (root) {
  'use strict';
  const doc = root.document;
  const section = doc && doc.getElementById('atkPackingMvp');
  if (!section) return;

  // GitHub Pages is one origin for the ordinary app and every preview.
  // Include the application path in the key: no preview may read/write the ordinary app's kit.
  const path = root.location.pathname.replace(/index\.html$/, '').replace(/\/?$/, '/');
  const KEY = 'atokorePackingChecklistV1:' + path;
  const TEMPLATES = Object.freeze({
    daycare: ['連絡帳', '着替え', 'おむつ', 'おしりふき', 'タオル', '水筒'],
    outing: ['おむつ', 'おしりふき', '着替え', '飲み物', 'ゴミ袋', '必要なら母子手帳']
  });
  const NAMES = { daycare: '保育園セット', outing: 'お出かけセット' };
  const buttonAdd = doc.getElementById('atkPackAddButton');
  const input = doc.getElementById('atkPackAddInput');
  const reset = doc.getElementById('atkPackReset');
  const progress = doc.getElementById('atkPackProgress');
  const rows = doc.getElementById('atkPackRows');
  const error = doc.getElementById('atkPackError');

  const initial = () => ({
    version: 1,
    active: 'daycare',
    lists: Object.fromEntries(Object.entries(TEMPLATES).map(([id, names]) => [
      id, names.map((name, i) => ({ id: id + '-' + i, name, done: false }))
    ]))
  });
  const valid = s => s && s.version === 1 && Object.prototype.hasOwnProperty.call(NAMES, s.active) &&
    s.lists && typeof s.lists === 'object' &&
    ['daycare', 'outing'].every(id => Array.isArray(s.lists[id]) && s.lists[id].length <= 50 &&
      s.lists[id].every(x => x && typeof x.id === 'string' && x.id.length <= 100 &&
        typeof x.name === 'string' && x.name.length <= 60 && typeof x.done === 'boolean' &&
        (x.preferredStock === undefined || (x.preferredStock &&
          typeof x.preferredStock.id === 'string' && x.preferredStock.id.length <= 100 &&
          typeof x.preferredStock.name === 'string' && x.preferredStock.name.length <= 150 &&
          typeof x.preferredStock.unit === 'string' && x.preferredStock.unit.length <= 30))) &&
      new Set(s.lists[id].map(x => x.id)).size === s.lists[id].length);

  let state = initial();
  let locked = false;
  let snapshot = null; // raw bytes last read or successfully committed by this tab
  let store = null;
  try {
    store = root.localStorage;
    const saved = store.getItem(KEY);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (!valid(parsed)) throw Error('invalid-kit');
      state = parsed;
    }
    snapshot = saved;
  } catch (e) {
    // Never replace an unreadable checklist. Refuse writes, even to the defaults on screen.
    locked = true;
  }

  function notice(message) {
    error.hidden = !message;
    error.textContent = message || '';
  }
  function reconcile(raw) {
    if (raw === snapshot) return;
    if (raw === null) {
      locked = true; // another tab reset/deleted data: do not resurrect its old checklist
      notice('別のタブでチェックリストが削除されました。古い内容で上書きしないため、この画面での変更を停止しています。');
      render();
      return;
    }
    try {
      const latest = JSON.parse(raw);
      if (!valid(latest)) throw Error('corrupt-checklist');
      state = latest;
      snapshot = raw;
      notice('別のタブでチェックリストが更新されました。最新の内容に読み直しました。操作をもう一度確認してください。');
    } catch (e) {
      locked = true;
      notice('別のタブで保存内容が読めない状態になりました。保護のため変更を停止しています。');
    }
    render();
  }
  root.addEventListener?.('storage', event => {
    if (event.key === KEY || event.key === null) {
      try { reconcile(store.getItem(KEY)); }
      catch (e) { locked = true; notice('保存状態を読み直せません。変更を停止しています。'); render(); }
    }
  });

  function commit(next) {
    if (locked) return false;
    const raw = JSON.stringify(next);
    try {
      // Other tabs share localStorage. A stale tab must not erase newer checklist edits.
      const current = store.getItem(KEY);
      if (current !== snapshot) {
        reconcile(current);
        return false; // explicitly retry the current action after reviewing the fresh checklist
      }
      store.setItem(KEY, raw);
      if (store.getItem(KEY) !== raw) throw Error('write-verification');
    } catch (e) {
      notice('保存できませんでした。端末の空き容量とSafariの保存設定を確認してください。');
      render(); // undo the browser's temporary checked state
      return false;
    }
    state = next;
    snapshot = raw;
    notice('');
    render();
    return true;
  }
  function edited(fn) {
    const next = JSON.parse(JSON.stringify(state));
    fn(next);
    return commit(next);
  }
  function make(tag, cls, value) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (value !== undefined) n.textContent = value;
    return n;
  }
  function render() {
    for (const b of section.querySelectorAll('[data-pack]')) {
      const current = b.dataset.pack === state.active;
      b.setAttribute('aria-pressed', String(current));
      b.classList.toggle('on', current);
      b.disabled = locked;
    }
    const items = state.lists[state.active];
    const done = items.filter(x => x.done).length;
    progress.textContent = NAMES[state.active] + '：' + done + '/' + items.length + ' 準備済み';
    rows.replaceChildren();
    for (const item of items) {
      const row = make('div', 'atk-pack-row');
      const label = make('label', 'atk-pack-label');
      const check = make('input');
      check.type = 'checkbox';
      check.checked = item.done;
      check.disabled = locked;
      check.setAttribute('aria-label', item.name + 'を準備済みにする');
      check.addEventListener('change', () => edited(next => {
        const target = next.lists[next.active].find(x => x.id === item.id);
        if (target) target.done = check.checked;
      }));
      const name = make('span', item.done ? 'atk-pack-done' : '', item.name);
      label.append(check, name);
      // Inline read-only stock hint, not an extra shopping action or row.
      // Never alter inventory or buy list when checking a packing item.
      const stockChoices = root.AtokoreKitShoppingV50?.choices?.(item.name);
      if (Array.isArray(stockChoices?.stocks)) {
        const hint = make('small', 'atk-pack-stock-inline');
        const stock = stockChoices.stocks;
        // Unregistered is not equivalent to zero. Multiple matching products
        // must not be added together (different sizes/units may be involved).
        hint.textContent = stock.length > 1 ? '在庫：複数登録'
          : stock.length === 0 ? '在庫：未登録'
          : '在庫：' + stock[0].qty + stock[0].unit;
        if (stock.length === 1 && Number(stock[0].qty) === 0) hint.classList.add('atk-pack-stock-empty');
        label.append(hint);
      }
      const remove = make('button', 'atk-pack-remove', '削除');
      remove.type = 'button';
      remove.disabled = locked;
      remove.setAttribute('aria-label', item.name + 'をリストから削除');
      remove.addEventListener('click', async () => {
        // A kit switch while the dialog is open must not delete from the new kit.
        if (!root.AtokoreConfirm || typeof root.AtokoreConfirm.ask !== 'function') return;
        const kit = state.active;
        const expected = snapshot;
        const yes = await root.AtokoreConfirm.ask('持ち物を削除しますか？', item.name + 'をこのセットから削除します。あとで「準備済みチェックをすべて外す」を押しても、削除した項目は戻りません。必要な場合は再追加してください。在庫と買い物リストは変わりません。', '削除');
        // A newer edit or another tab's update invalidates a decision made about old contents.
        if (yes && !locked && state.active === kit && snapshot === expected)
          edited(next => { next.lists[kit] = next.lists[kit].filter(x => x.id !== item.id); });
      });
      row.append(label, remove);
      // Preparation is a concise checklist; purchase actions stay in the shopping list.
      // Keep legacy preferredStock metadata in saved checklists without acting on it.
      rows.append(row);
    }
    buttonAdd.disabled = locked || items.length >= 50;
    input.disabled = locked || items.length >= 50;
    reset.disabled = locked || done === 0;
    if (locked && error.hidden) notice('チェックリストの保存内容を読めません。データを保護するため変更を停止しています。');
  }

  for (const b of section.querySelectorAll('[data-pack]')) {
    b.addEventListener('click', () => {
      if (!locked && NAMES[b.dataset.pack] && state.active !== b.dataset.pack) {
        edited(next => { next.active = b.dataset.pack; });
      }
    });
  }
  function addItem() {
    const name = input.value.trim().slice(0, 60);
    if (!name || locked || state.lists[state.active].length >= 50) return;
    // The same item twice ("おむつ" already in the set) only makes the count wrong: say so instead.
    const same = n => String(n).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    if (state.lists[state.active].some(x => same(x.name) === same(name))) {
      notice('「' + name + '」はすでに' + NAMES[state.active] + 'にあります。');
      return;
    }
    notice('');
    const id = 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    if (edited(next => { next.lists[next.active].push({ id, name, done: false }); })) input.value = '';
  }
  buttonAdd.addEventListener('click', addItem);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
  reset.addEventListener('click', async () => {
    if (locked || !root.AtokoreConfirm || typeof root.AtokoreConfirm.ask !== 'function') return;
    const kit = state.active;
    const expected = snapshot;
    const yes = await root.AtokoreConfirm.ask('チェックを戻しますか？', NAMES[kit] + 'の「準備済み」チェックだけをすべて外します。持ち物の項目は残り、削除済みの項目は復元されません。在庫と買い物リストは変わりません。', 'チェックを戻す');
    if (yes && !locked && state.active === kit && snapshot === expected)
      edited(next => { for (const item of next.lists[kit]) item.done = false; });
  });

  render();
  root.AtokorePackingChecklist = Object.freeze({
    key: KEY,
    status: () => ({ active: state.active, items: state.lists[state.active].length, locked }),
    // Read-only copy of the active list for summaries (v51); writes stay in this module.
    items: () => locked ? null : state.lists[state.active].map(x => ({ name: x.name, done: x.done })),
    refresh: () => { if (!locked) render(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
