# あとこれ v50｜Supabase実環境の「変更しない」安全性監査

**最新（2026-11-18 JST）**：管理SQL接続は認証エラーから**読み取りが回復**し、以下の実DBのスキーマ・権限・適用履歴・Supabase Security Advisorを確認できた。実データ行は一件も取得していない。**実DBへの変更・データ書き込みは行っていない。** なお、実環境の家族共有・所属失効の拒否テストは未実施であり、コードのCI成功だけで公開安全と判定しない。

## 原則
- 本文のクエリは **すべて SELECT のみ**。個人・世帯データの行は取得しない。アクセス可能になるまでは実行できない。
- 対象は `atokore-family-trial` のみ。AI COMPANYやWorkflow Path LabのSupabaseプロジェクトで実行しない。
- 移行・権限変更・データ消去・公開・課金は、この資料だけでは承認されていない。
- `Security Definer` の存在自体は問題確定ではない。公開`public.hh_*` RPCについて認証、世帯所属、権限チェックを関数定義と**許可/拒否の実動作テスト**で確認する。
- `#98`から#106に移管した修正候補は、**本番DB未適用**。独立PostgreSQLでのみレース再現・修正効果を検証済み。


## 2026-11-18｜実環境の読み取り専用監査結果（管理SQL復旧後）

対象：Supabase Project `vzyxurodowpjltwbgbyc`（`atokore-family-trial`）のみ。SELECTで取得したのはシステムカタログ/権限定義・Supabase管理アドバイザーの結果のみ。**家族/認証/写真/買い物/在庫の実レコードは読んでいない**。前日に28P01が発生していた原因は不明。パスワードや設定の変更なしに同じ公式MCP管理接続でSELECTが成功した。

| 監査項目 | 実環境で確認できた事実 | 判断 |
|---|---|---|
| migration履歴 | 8件。最後の適用は`20261104111127 atokore_receipt_imports_v49` | #106で隔離検証した所属ロック差分の実適用は未確認ではなく**未適用と確認** |
| `public`の家族用テーブル | なし。内部の10テーブルは`atokore_private` | データAPIに直接出す想定ではない |
| 家族用内部テーブル | 10表中9表でRLS有効。`atokore_private.receipt_imports`だけRLS無効 | **要設計レビュー**（ただし`anon`はスキーマUSAGE不可、`authenticated`も全10表に直接SELECT/INSERT権限なし）。RLS無効だけで直接漏えいとは断定しない |
| 家族RPC | `public.hh_*` 15関数はSECURITY DEFINER、`anon`のEXECUTEなし、`authenticated`のEXECUTEあり | 仕様として認証者専用RPCだが権限委譲関数なので、全ての世帯所属/入力検証を動作試験で再確認する必要あり。アドバイザーにWARN 15件 |
| `hh_receipt_claim` / `hh_receipt_finish` | **両方とも**`atokore_private.my_household(v_user)`を使用。`lock_member(v_user)`を使用していない | **公開前に修正要**。既存の隔離PostgreSQLレース再現は「除外完了と進行中のレシート確定」が競合することを証明済み。実DBのデータ事故は未確認 |
| `hh_remove_member` / `lock_member` | 除外は`lock_member(v_user, true)`を使う。privateの`lock_member`は世帯行をFOR UPDATEしロック後にメンバー所属を再確認 | 候補の2関数変更と整合する。実DBでの許可/拒否の動的検証は未実施 |
| 商品写真 | バケット`atokore-product-photos` は`public=false`、JPEGのみ、上限81,920 bytes。Storage objectsに認証者向けSELECT/INSERT/DELETEの3ポリシーがあり`photo_allowed(name)`で所属・商品を確認 | 非公開バケットとポリシーを確認。UPDATEポリシーなし（上書きupsertが必要な実装なら別途検証）。ファイルや写真は取得していない |
| Security Advisor | INFO: private9表で「RLS有効・policyなし」。WARN:認証者が呼べるSECURITY DEFINER 15件、匿名サインイン絡みの警告1件、漏えいパスワード保護オフ1件 | 自動警告をそのまま脆弱性確定とはしない。Googleログインのみ等の運用条件と関数定義で個別判定。**警告は未解消** |

**追加静的照合（2026-11-18）**：公式Supabase管理DBの`pg_proc.prosrc`と、PR #106の[隔離PGで検証済み候補](../scripts/receipt-audit/candidate-member-lock.sql)を関数ごとに比較した。`hh_receipt_claim`と`hh_receipt_finish`の両方について、候補の`lock_member(v_user)`を元の`my_household(v_user)`に戻した本文が**実DBの現行関数本文と完全一致**。宣言・分岐・DML・例外処理などに他の文字差分はない。両関数の実シグネチャと`jsonb`戻り値、SECURITY DEFINER、`search_path`も候補と整合する。これは**静的な差分の一致**であって、実DBへの適用や権限失効の動的動作を証明するものではない。

### 採用推奨の最小変更（**提案のみ・未実施**）
- 本番DBで一括実行するSQLやパスワード変更は**オーナーの別途明示承認前に実施しない**。
- 対象は既存の`public.hh_receipt_claim`、`public.hh_receipt_finish`の2関数のみ。各関数の`v_hh uuid := atokore_private.my_household(v_user);` を`v_hh uuid := atokore_private.lock_member(v_user);`に置換する。
- 実行前に現在の`pg_get_functiondef`を監査専用バックアップとして保存（SQL本文・権限情報のみ、個人データなし）。その後、[隔離テスト済み候補SQL](../scripts/receipt-audit/candidate-member-lock.sql)と実DB関数の差分が**上記2行に限られる**と照合し、既存関数のgrant／search_path／デフォルト引数を維持する安全な追加マイグレーションを準備。
- 実DBに適用する場合は独立PGでの同じ並行実行回帰テストと、PostgREST経由の認証/認証なし/除外済み合成利用者の拒否テスト、Advisor再取得、意図せぬ権限変更の有無、ロールバック手順を条件にする。**合成2端末の家族共有テストは依然未実施**。
- `receipt_imports`のRLS有効化や他の15 RPCの権限・Auth設定はこの2行修正に混ぜず、影響範囲を別途審査（予期せぬ既存機能停止を防ぐ）。

### 管理上の判定
- **「Supabase管理DBに接続できない」は解消**。RLS/GRANT/Storage/RPC/履歴のメタデータ監査は完了。
- **「実DBの安全性を受入れ済み」は未達**。レシートの2関数が旧実装、匿名/除外済み/他世帯の動的拒否検証未実施、Advisor WARNの個別評価未完。
- PR #106とIssue #96のDraft品質ゲートを維持。実DB・本番・既存試用版には手を触れない。

## 再監査用の読み取り専用チェック

**1. メタデータ：対象DB、実際に適用済みのマイグレーション**

```sql
select current_database() as db, current_user as role, version();
select version as migration_version
from supabase_migrations.schema_migrations
order by version desc
limit 15;
```

**2. データAPIの公開スキーマと内部テーブルのRLS状態**

```sql
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public', 'atokore_private', 'storage')
  and c.relkind in ('r','p')
order by 1,2;
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname in ('public','atokore_private','storage')
  and (tablename like 'receipt_%' or schemaname='storage')
order by 1,2,3;
```

**3. 公開RPCのEXECUTE権限とSECURITY DEFINERの確認（データ行は読まない）**

```sql
select n.nspname as schema_name, p.proname as function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_executable,
       pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as signed_in_executable
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'hh_%'
order by 2,3;
```

**4. レシート2関数への所属ロックが反映済みか（静的文字列チェック）**

```sql
select p.proname,
  position('atokore_private.lock_member(v_user)' in p.prosrc)>0 as lock_member_present,
  position('atokore_private.my_household(v_user)' in p.prosrc)>0 as old_lookup_present
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('hh_receipt_claim','hh_receipt_finish')
order by p.proname;
```

**解釈**：両関数でロック未反映なら#106の候補を審査する。単なる文字列チェックだけでRLS/レース耐性の証明にはならない。

## データ保護の最終受入れ
1. 実DBは**認可された管理接続のみ**から読み取り専用で検査。
2. RLSとStorage権限、RPC実行権限、認証無し・別世帯・除外済みアカウントの**拒否テスト**を独立の合成世帯で実施。
3. 権限変更が必要と判明しても自動変更しない。差分SQL、隔離Postgres CI、ロールバック手順と影響範囲を出して本人に別途承認を求める。
4. 「実DB未確認」と「コード試験合格」を混同せず、第7段階の品質合格はすべて完了するまで保留。

[Supabase 公式 Database Security](https://supabase.com/docs/guides/database/postgres/row-level-security) と [Database Advisors](https://supabase.com/docs/guides/observability/advisors) を参照。
