# 共有履歴SQL（20261025090000_atokore_history_w2.sql）適用計画 — 承認待ち

**この文書の段階では、実DBへの適用・書き込みは一切行っていません。** 対象は試用版専用のSupabaseプロジェクト `atokore-family-trial`（`vzyxurodowpjltwbgbyc`）です。通常版（公開中のアプリ）はSupabaseを使っていないため、影響はありません。

## 1. 現在の適用状況
- 最後の確認：2026-10-26、読み取りのみで「未適用」（`docs/atokore-release-v48-report.md` に記録）。
- 2026-10-31（この作業）：Supabaseに読み取りで接続する手段がこのセッションにないため、**再確認していません（未確認）**。適用の直前に、§4の読み取り専用SQLで状況を確かめます。
- SQLのSHA-256：`86f28ca53fceb69af0109fb7d21add71903cfda2786e2938b58d2d113c599589`（v48の報告と一致）。

## 2. 変更内容と影響

| 項目 | 現在（未適用） | 適用後 |
|---|---|---|
| 変更する対象 | — | `public.hh_changes(int)` の定義の差し替えだけ |
| データ | — | 行の追加・変更・削除はなし（世帯・メンバー・招待・商品・操作記録のすべて） |
| 権限 | 認証済みのユーザーだけが実行可能。匿名と一般公開は不可。security definer、search_path='' | 同じ |
| 実行者名 | その人の**現在の**表示名。過去の記録も今の名前になる | その操作をした時点の表示名 |
| 実行者を特定できないとき | 「家族」と表示 | null（アプリは「実行者不明」と表示） |
| 商品ID（`record_id`） | 返さない（共有の履歴から商品を開けない） | 返す（今の商品詳細を開く。削除済みなら記録として表示） |
| 退出したメンバー | 退出の記録が残るため、名前は引き続き表示される | 同じ（その時点の名前で表示） |
| 処理の重さ | 最大100行 | 各行でメンバーを1件調べる処理が増えるだけで、上限は同じ100行 |

**アプリとの互換**
- v48のアプリは、どちらの返り値にも対応しています。
- 未適用の今は、次のように表示されます。
  - 共有の履歴に、今の名前や「家族」が出る
  - 共有の履歴から商品を開けない
- 適用すると、v48で意図した表示になります。
- 公開中の試用版はv48だけです。v47以前のアプリで `who` がnullのときの表示は確認していません。

## 3. 隔離環境での検証（実施済み）
`tests/atokore-history-w2-migration-check.test.cjs` で検証しました。実際の全マイグレーションをPGliteで読み込み、同じデータで「適用前 → 適用 → 取り消し → 再適用」を確認しています。
- 適用前の返り値は、今の実DBと同じ定義です（現在の名前、「家族」、`record_id` なし）。
- 適用後に変わるのは `who` と `record_id` だけです。ほかの項目（時刻・種類・商品名・数量の変化など）はすべての行で同じです。
- 5つの表（households・members・invites・records・ops）の内容のハッシュと行数が、適用・取り消しの前後で一致しました。
- 権限と security definer・search_path は、適用前後で同じです。未ログインと世帯外の人は拒否されます。
- 取り消し用のSQL（`supabase/rollbacks/…_rollback.sql`）を流すと、適用前とまったく同じ返り値に戻ります。取り消したあとに再適用しても、同じ結果になります。
- マイグレーションにも取り消し用SQLにも、delete・update・insert・drop・truncate は含まれていません（テストで確認）。

## 4. 承認後の手順（オーナーの承認を得てから）
1. **適用前の確認（読み取りのみ）**
   ```sql
   select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
   select position('record_id' in pg_get_functiondef('public.hh_changes(int)'::regprocedure)) > 0 as already_applied;
   select has_function_privilege('anon','public.hh_changes(int)','execute') as anon,
          has_function_privilege('authenticated','public.hh_changes(int)','execute') as authenticated;
   select (select count(*) from atokore_private.households) households, (select count(*) from atokore_private.members) members,
          (select count(*) from atokore_private.records) records, (select count(*) from atokore_private.ops) ops;
   ```
   現在の関数定義（`pg_get_functiondef` の結果）を記録として控えます。
2. **適用**：SHA-256が上記と一致するSQL1本を、Supabaseの `apply_migration`（名前 `atokore_history_w2`）で適用します。管理画面に直接貼り付ける方法は使いません。
3. **適用後の確認（読み取りのみ）**
   - 手順1の4つの問い合わせを再実行します。次のとおりなら成功です。
     - `already_applied` が true
     - 権限が anon=false・authenticated=true
     - 件数が手順1と同じ
   - 実際の世帯での表示確認は、オーナーの端末で共有の履歴を開いて行います。確認項目は次の3点です。
     - 実行者名
     - 商品詳細が開くこと
     - 「実行者不明」の出方

   テスト用の世帯を実DBに作る場合は、書き込みになるため、別途承認を得ます。
4. **取り消し**（問題があった場合）：`supabase/rollbacks/20261025090000_atokore_history_w2_rollback.sql` を、別途承認を得たうえで1回だけ適用します。この取り消しで変わるのは関数だけで、データの削除や変更はありません。

## 5. 判断が必要な点
- 適用の承認。
- 実DBでの表示確認を、オーナーの実際の世帯（表示を見るだけ）で行うか、テスト用の世帯（書き込みが発生）で行うか。
