# あとこれ v50｜試用Supabase Security Advisor警告の個別レビュー

実施：2026-11-24 JST（Read-only、対象プロジェクト `atokore-family-trial`。本番変更なし）。

## Advisor現状と扱い（警告≠すべて脆弱性）

| Advisor | 件数 | 事実/リスク | 提案 |
|---|---:|---|---|
| `rls_enabled_no_policy` | INFO 9 | `atokore_private`内の契約/世帯/招待/メンバー/変更/在庫などはRLS有効で直接ポリシーなし。既存設計ではクライアントが直接テーブルへアクセスしないのが目的。 | **ポリシーを追加しない**。公開schema露出、`anon`/`authenticated`へのUSAGE/SELECT/INSERT/DELETEなどの実GRANT、既存RPCの所属検証を隔離Postgresで検査し、直接API権限がないことを証明する。 |
| `authenticated_security_definer_function_executable` | WARN 15 | `public.hh_*`等のSECURITY DEFINER RPCはauthenticatedの権限で呼び出せる。必要なAPIだがDB所有者権限で実行されるため、IDOR/競合に敏感。 | 関数ごとに`auth.uid()`取得・`lock_member()`による再判定・対象世帯以外の参照禁止・引数の上限・search_path固定・SQL注入の有無を検査。露出が不要な内部関数は非公開schemaへ置き、EXECUTE revoke。**意図した公開RPCを無差別に失効すると家族共有が壊れる**。 |
| `auth_allow_anonymous_sign_ins` | WARN 1 | ゲスト参加機能ではSupabase匿名ユーザーが必要で、`authenticated`ロールを使う場合がある。 | ロールだけで家族へのアクセスを許可しないことを確認する。招待コードの有効期限・一回利用・ログイン移行・レート制限・匿名ユーザーの再招待挙動を検査。本人の了承なしで匿名サインインをOFFにしない。 |
| `auth_leaked_password_protection` | WARN 1 | パスワード漏洩照合の保護が未有効。実ユーザー運用前の認証安全性課題。 | Supabaseプラン・設定による利用可能性と影響を確認。QA用の一時パスワードルール緩和はしない。設定変更は別途承認。 |

## 新しい写真ゲートに特有の追加レビュー

- 草案の`public.hh_photo_access(text,text)`は新しいSECURITY DEFINERとして既存15件のWARNに**追加される可能性**がある。機密値を返すのではなく真偽値だけを返す設計だが、`authenticated`が外部から呼べること自体を隠さない。
- `auth.uid()`が必須、アクティブな世帯の`members.left_at is null`、削除されていない`records.kind='item'`、対象パスの書式をDB内部でチェックする。
- 読取・削除の真偽は、在庫レコード`fields->>'photoPath'`がその同一パスを指している場合のみ真。`write`はアイテム存在・現在所属が必須。
- **新Storage bucketにエンドユーザーが読めるpolicyを作らない**ことが要件。既存バケットのpolicyは別途安全移行の後に停止する。CDNから古いURLの画像が残る問題を「新しい関数が安全だから合格」と誤認しない。
- server SDK `withSupabase({auth:'user'})` + Origin allowlist + POST only + JWT/Auth/RPCの再確認。envのsecret値をリポジトリ/HTML/スクリーンショット/Issueへ出さない。request.bodyには最大サイズ制限。
- 認証／Storage／DB障害時の拒否(deny closed)と例外をJSONエラーにする。不要なユーザーID・画像パスはレスポンスエラーに返さない。
- **TOCTOU残課題**：認可の直前/直後に除外が並行する場合、外部Storage呼出の全体を一つのPostgresトランザクションで囲むことはできない。現モジュールは取得前と配信直前に所属を再検証するが、完全に原子的な即時失効を保証するものではない。正式公開時には競合試験と脅威モデルの合意が必要。

## 検証方法と変更境界

1. 読取り専用の`pg_proc`・`pg_policies`・`information_schema.role_table_grants`・`storage.buckets`で権限を記録し、既存の実ユーザー名/写真パスは出力しない。
2. PGlite/隔離Postgresで匿名/ログイン済み、別世帯、除外済み、同時レシート確定、写真の読取/削除を再現する。
3. 試用DBの実機Auth/RPC/Storageに変更する前に、差分SQL・対象プロジェクト・新機能の試験手順・戻し方・秘密鍵の管理先をオーナーへ一括提示し個別承認を得る。
4. 実画像の削除、旧URL失効、合成データ作成/完全削除、PRマージ/本番公開はそれぞれ承認境界を守る。

**判定**：Security Advisorは意図した設計による警告を含むため、件数ゼロを目的にRLSを緩めない。残件は公開前の証拠とリスク受容/必要な修正を明示するまでゲート継続。
