# 共有履歴SQL（20261025090000_atokore_history_w2.sql）— 実DBの状況と保留中の作業

**この文書の作業では、実DBへの適用・書き込みは一切行っていません。** 対象は試用版専用のSupabaseプロジェクト `atokore-family-trial`（`vzyxurodowpjltwbgbyc`）です。通常版（公開中のアプリ）はSupabaseを使っていないため、影響はありません。

## 1. 実DBの状況（確認できたこと・分からないこと）

| 日付 | 確認者・方法 | 結果 |
|---|---|---|
| 2026-10-26 | 読み取りのみ（`docs/atokore-release-v48-report.md`） | 「未適用」と記録 |
| 2026-10-31 | チャッピー・読み取りのみ（DBは変更していない） | `public.hh_changes(integer)` は**すでに新しい形式**。`record_id` を返し、実行者名を「操作時点の在籍期間」から取る定義で、確認した範囲では本マイグレーションの関数本体と一致。一方、`supabase_migrations.schema_migrations` に `20261025090000` の記録は**見つからなかった** |

- 10/26 の「未適用」は、10/31 の確認で古い情報になりました。**「マイグレーション履歴がない＝旧関数が動いている」ではありません。**
- いつ・どの方法で関数が変更されたかは**不明**です（このリポジトリの記録からは分かりません）。
- 実際の共有画面に `who` が null の行が出ているか、実際の世帯のデータは**確認していません**。
- SQLのSHA-256：`86f28ca53fceb69af0109fb7d21add71903cfda2786e2938b58d2d113c599589`（v48の報告と一致）。

### 関数本体の照合（読み取りのみ・1行）

```sql
select md5(prosrc) as body_md5 from pg_proc where oid = 'public.hh_changes(int)'::regprocedure;
```

| 結果 | 意味 |
|---|---|
| `3c5e7ddd8c034eabcc4ac9e57ffd766c` | 本マイグレーション（W2）の本体と文字単位で一致 |
| `3d4ed26d1431ac27263ea4a2f996e2e0` | 旧定義（`20261024111736_atokore_polish_v44.sql`）と一致。取り消し用SQLもこの本体 |
| それ以外 | 空白・改行の違いを含め、どちらとも文字単位では一致しない。中身の比較が必要 |

期待値は、全マイグレーションをPGliteで適用し、DBが保持した `prosrc` のmd5とファイル内の本体のmd5が一致することで確かめました。

## 2. 新旧の定義の違い

| 項目 | 旧定義（v44） | W2定義（10/31の確認では実DBはこちら） |
|---|---|---|
| 実行者名 | その人の**現在の**表示名 | その操作をした時点の表示名 |
| 実行者を特定できないとき | 「家族」 | **null** |
| 商品ID（`record_id`） | 返さない | 返す |
| 権限 | 認証済みのユーザーだけ。security definer、search_path='' | 同じ |
| データ | — | 関数の差し替えだけで、行の追加・変更・削除はなし |

### アプリへの影響（実DBがW2定義であることを前提に）

- ホームの「家族の最近の変更」は、v48 から null を「実行者不明」と表示します。
- 共有シートの「変更履歴」は、**v48 では null をそのまま「null」と表示**します。条件次第で、現在の試用版でも起こりえます（実際に null の行があるかは未確認）。
- v48.2（PR #83 の上の修正）で、共有シートでも「実行者不明」と表示するように直しました。旧形式（名前が常に入る・`record_id` なし）の返り値でも同じように表示されます。

## 3. 隔離環境での検証（実施済み）

`tests/atokore-history-w2-migration-check.test.cjs` で、実際の全マイグレーションをPGliteで読み込み、同じデータで「旧定義 → W2 → 取り消し → 再適用」を確認しました。
- 変わるのは `who` と `record_id` だけ。ほかの項目はすべての行で同じ。
- 5つの表（households・members・invites・records・ops）の内容のハッシュと行数が、前後で一致。
- 権限と security definer・search_path は前後で同じ。未ログインと世帯外の人は拒否。
- マイグレーションにも取り消し用SQLにも、delete・update・insert・drop・truncate は含まれていない。

## 4. 保留中の作業（実施しない・それぞれ別途承認が必要）

| 作業 | 状態 | 理由 |
|---|---|---|
| マイグレーションの再適用 | **保留** | 10/31 の確認では関数はすでにW2定義。再適用しても本体は同じになる見込みだが、履歴の記録方法も含めて判断が必要 |
| `schema_migrations` への記録の手動追加・修正 | **保留** | いつ・どう変更されたか不明なまま履歴を作ると、記録が事実と食い違うおそれ |
| 取り消し用SQL（`supabase/rollbacks/…_rollback.sql`）の実行 | **保留・現在のDBに適用しない** | 旧定義（v44）に戻すもので、現在のW2定義を巻き戻してしまう。v48.2の表示はどちらでも動くが、`record_id` が返らなくなり共有の履歴から商品を開けなくなる |

判断の前に行う読み取り専用の確認（どれもDBを変更しない）:

```sql
select md5(prosrc) as body_md5 from pg_proc where oid = 'public.hh_changes(int)'::regprocedure;
select version, name from supabase_migrations.schema_migrations order by version desc limit 10;
select has_function_privilege('anon','public.hh_changes(int)','execute') as anon,
       has_function_privilege('authenticated','public.hh_changes(int)','execute') as authenticated;
```

## 5. 判断が必要な点

- `schema_migrations` の記録をどう扱うか（このまま／経緯を確認してから記録を整える）。
- 実際の世帯で共有シートの「変更履歴」を見て、「実行者不明」の出方を確認するか（見るだけで、書き込みはしない）。
