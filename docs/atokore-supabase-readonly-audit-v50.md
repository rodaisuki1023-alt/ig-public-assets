# あとこれ v50｜Supabase実環境の「変更しない」安全性監査

現状（2026-11-17）：管理APIの `list_projects` では試用プロジェクト `vzyxurodowpjltwbgbyc` が `ACTIVE_HEALTHY`。しかし `execute_sql` と `list_migrations` は **FATAL 28P01 password authentication failed for user postgres**、セキュリティアドバイザーは hibernated と応答する。**実DBの内容、RLS、適用済みSQLを確認できていない**。成功扱いは禁止。

## 原則
- 本文のクエリは **すべて SELECT のみ**。個人・世帯データの行は取得しない。アクセス可能になるまでは実行できない。
- 対象は `atokore-family-trial` のみ。AI COMPANYやWorkflow Path LabのSupabaseプロジェクトで実行しない。
- 移行・権限変更・データ消去・公開・課金は、この資料だけでは承認されていない。
- `Security Definer` の存在自体は問題確定ではない。公開`public.hh_*` RPCについて認証、世帯所属、権限チェックを関数定義と**許可/拒否の実動作テスト**で確認する。
- `#98`から#106に移管した修正候補は、**本番DB未適用**。独立PostgreSQLでのみレース再現・修正効果を検証済み。

## 認証が回復した後に実施する読み取り専用チェック

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
