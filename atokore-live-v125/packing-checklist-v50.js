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
      // Optional local packing → shopping bridge. It uses the existing shopping
      // action owner to save, dedupe and synchronize purchases; a checklist
      // checkmark never decrements stock or claims an item is packed automatically.
      const bridge = root.AtokoreKitShoppingV50;
      if (!locked && !item.done && bridge && typeof bridge.choices === 'function') {
        const options = bridge.choices(item.name);
        // A repeat purchase may reuse the parent's explicit last choice, but
        // never trust only an ID: the row's name and unit must still match.
        // This is optional local metadata; old saved v1 checklists stay valid.
        const preferred = item.preferredStock && options.stocks.find(x =>
          String(x.id) === item.preferredStock.id &&
          x.name === item.preferredStock.name && x.unit === item.preferredStock.unit);
        const helper = make('div', 'atk-pack-shopping-helper');
        const statusLine = make('span', 'atk-pack-stock-hint');
        if (!options.stocks.length) statusLine.textContent = 'ストック登録は未確認（不足確定ではありません）';
        else if (options.stocks.length > 1) statusLine.textContent = preferred
          ? '前回のサイズ・種類を選択中（購入前に再確認）'
          : '複数の商品あり：サイズ・種類を選んでください';
        else statusLine.textContent = options.stocks[0].qty > 0
          ? 'ストック登録：' + options.stocks[0].qty + options.stocks[0].unit
          : '登録ストック：0' + options.stocks[0].unit;
        helper.append(statusLine);
        let picker = null;
        if (options.stocks.length > 1) {
          picker = make('select', 'atk-pack-stock-choice');
          picker.setAttribute('aria-label', item.name + 'の買い物商品を選ぶ');
          const empty = make('option', '', '商品・サイズを選ぶ');
          empty.value = '';
          picker.append(empty);
          for (const product of options.stocks) {
            const choice = make('option', '', product.name + '（' + product.qty + product.unit + '）');
            choice.value = String(product.id);
            picker.append(choice);
          }
          if (preferred) picker.value = String(preferred.id);
          helper.append(picker);
        }
        const action = make('button', 'atk-pack-to-buy', '🛒 買い物へ');
        action.type = 'button';
        action.setAttribute('aria-label', item.name + 'を買い物リストへ追加');
        const updateAction = () => {
          const selected = picker ? options.stocks.find(x => String(x.id) === picker.value) : options.stocks[0];
          const inBuy = selected ? selected.queued : options.queued.includes(item.name);
          action.disabled = !!(picker && !selected) || inBuy;
          action.textContent = inBuy ? '追加済み' : '🛒 買い物へ';
        };
        if (picker) picker.addEventListener('change', () => {
          const selected = options.stocks.find(x => String(x.id) === picker.value);
          // Save *only* the preference: selecting a variant must never add a
          // shopping row, decrement stock, or mark a packing item as ready.
          // commit() checks for concurrent tab edits and verifies the write.
          edited(next => {
            const current = next.lists[next.active].find(x => x.id === item.id);
            if (!current) return;
            if (selected) current.preferredStock = {
              id: String(selected.id), name: selected.name, unit: selected.unit
            };
            else delete current.preferredStock;
          });
        });
        updateAction();
        action.addEventListener('click', async () => {
          if (locked || state.lists[state.active].find(x => x.id === item.id)?.done) return;
          const chosen = picker ? picker.value : options.stocks[0]?.id;
          const expected = snapshot, kit = state.active;
          // No registered variant: never silently invent a precise diaper size.
          if (!options.stocks.length && (item.name === 'おむつ' || item.name === 'おしりふき')) {
            if (!root.AtokoreConfirm || typeof root.AtokoreConfirm.ask !== 'function') return;
            const ok = await root.AtokoreConfirm.ask(
              '商品名・サイズを確認してください',
              'ストックに商品がありません。「' + item.name + '」という汎用の買い物メモを追加します。購入前にサイズやメーカーを確認してください。ストック数は変わりません。',
              'メモとして追加'
            );
            if (!ok || locked || snapshot !== expected || state.active !== kit) return;
          }
          // Asynchronous confirmations must not act on a checklist that was
          // changed in another tab while the dialog was open.
          try {
            const current = store.getItem(KEY);
            if (current !== snapshot) { reconcile(current); return; }
          } catch (e) {
            locked = true;
            notice('保存状態を読み直せません。買い物への追加を停止しています。');
            render();
            return;
          }
          if (locked || state.active !== kit || snapshot !== expected ||
              !state.lists[kit].some(x => x.id === item.id && !x.done)) return;
          // Stocks may have changed since this row rendered (or while a
          // confirmation was open). Do not turn a remembered size into a
          // different product just because the numerical ID was reused.
          const currentOptions = bridge.choices(item.name);
          const chosenBefore = options.stocks.find(x => String(x.id) === String(chosen));
          const chosenNow = currentOptions.stocks.find(x => String(x.id) === String(chosen));
          if ((chosenBefore && (!chosenNow ||
              chosenBefore.name !== chosenNow.name || chosenBefore.unit !== chosenNow.unit)) ||
              (!options.stocks.length && currentOptions.stocks.length)) {
            notice('商品名・サイズの情報が変わりました。もう一度確認して選択してください。');
            render();
            return;
          }
          const result = bridge.add(item.name, chosen);
          if (result.status === 'failed') notice('買い物リストに保存できませんでした。端末の空き容量などをご確認ください。');
          else if (result.status === 'choose') notice('商品名やサイズを選んでください。');
          else if (result.status === 'invalid') notice('買い物商品の確認に失敗しました。もう一度お試しください。');
          else notice('');
          render();
        });
        helper.append(action);
        row.append(helper);
      }
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
    refresh: () => { if (!locked) render(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
