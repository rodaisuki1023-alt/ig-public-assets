# あとこれ v50｜公開前の技術・セキュリティ監査（2026-11-23）

状態：**未合格・本番公開保留**。この文書は実装者から独立したMuse監査の**代替合格証明ではない**。現行コード・実Supabase設定・GitHub Actionsを読み取り、残る実測を明確にするレビュー。

## 根拠／確認したもの

- Draft PR #106 `b82add14`（統合）、#108 `56785b6`（正式版OCR非表示・iPhone UI）、#109（新規写真TTL対策）、#107（認証付き受入）。
- 試用Supabase `atokore-family-trial`：`storage.buckets` に `atokore-product-photos`、`public=false`、JPEG限定／80KiB制限。RLSの SELECT/INSERT/DELETE が `atokore_private.photo_allowed(name)` と `bucket_id` を照合。
- 前回合成 A/B/CのAuth/世帯/HTTP写真試験：Cの他世帯拒否、B除外後の新JWT・新nonce GET拒否／Aの保持、写真SHA256合格。**同一URL `cache:reload` はHTTP200、CDNの `cf-cache-status=HIT`**。前回合成データは対象UUID限定の承認後に削除、14カテゴリ0件。
- Supabase Security Advisor（読み取り専用）：`rls_enabled_no_policy` INFO 9、`authenticated_security_definer_function_executable` WARN 15、`auth_allow_anonymous_sign_ins` WARN 1、`auth_leaked_password_protection` WARN 1。意図した内部表／RPC構成であっても、セキュリティ保証の代わりにしない。
- WebKitとChromiumの現行 E2E、PostgreSQL 17の別接続ロック競合テスト。PR #109の独立追加テストでは、2つの**別々の仮想端末保存領域**を一度オフラインにして在庫を両方+1し、再起動後サーバーを+2へ収束させる。**物理iPhone2台ではない**。

## 優先度判定

| 優先 | 項目 | 結論 |
| --- | --- | --- |
| P0 | 実家族/本番データの意図しない変更 | 今回なし。main/本番/正式公開/課金には変更なし |
| **P1** | 家族除外後の既知写真URLからのCDN HIT | **実HTTPで確認済み、未解消** |
| **P1** | `private, no-store, max-age=0`アップロードの実HTTP効果 | Draft実装・単体/CI検証のみ、**旧URL再取得の実測が必要** |
| **P1** | 家族共有ONで実iPhone2台の同期・除外・Safari/PWA | WebKitシミュレーションとDB競合試験まで、**物理2台未実施** |
| P2 | 古い写真URL・既存アップロードの扱い | 新規写真だけの変更。既存写真自動ローテーションは未対応 |
| P2 | 暗号学的に有効な古いJWTと保存済み画像 | サーバー所属チェックとUI側ローカルキャッシュの消去を追加確認 |
| P2 | `SECURITY DEFINER`15関数、匿名セッション、漏えいパスワード検出設定 | アドバイザー警告と実際の権限を照合。無断の権限変更は不可 |
| P3 | OCRの精度 | 本番の機能入口を隠す方針を維持。研究用コードのみ |

## 改善・検証の前提

1. **CDNに保存された暗号化されていない過去のJPEGの完全回収は不可能**。メンバーが除外前に保存した画像やバックアップも回収不能。保証するのは「除外後の新規の認証付きネットワーク取得は拒否される」の範囲とし、それを実HTTPで証明する。
2. 写真取得は`/storage/v1/object/authenticated/...`とBearer JWT、ランダムnonce、`cache: no-store`。アプリのService Workerは**同一オリジンの静的ファイルのみ**をキャッシュするため、異なる`supabase.co`の写真HTTPはサービスワーカーのキャッシュ対象外。ただしCDN独自キャッシュは別。
3. 新しくアップロードするJPEGだけ`Cache-Control: private, no-store, max-age=0`を指定する。Supabase FreeのCDNがそれをどう解釈するかは**未検証**。リクエストヘッダーの設定だけでは合格にしない。
4. **新規QAの合成3アカウント作成前**に、VercelのAll Deployments保護、未認証で`/qa/`と`/family/`が`login_required`、新コホートの表示、本人のパスワード入力経路を確認。成功・失敗を問わず一度実行したら再実行しない。結果と対象UUIDに基づき別途後片付け承認。
5. 同一URLで`cache:default`/ `cache:reload`、新nonce＋no-store、旧JWT/新JWT、C別世帯でHTTP結果を照合する。Supabase `edge_logs`の`cf-cache-status`で**HITかBYPASSか**を確認し、再取得時200ならP1未解消。
6. 実iPhone2台の`/family/`受入：A Googleログインで招待、Bゲスト参加、機内モードで両方＋1、解除後＋2、写真A/B表示、AがB除外、BがSafari再起動・PWA再起動で写真再取得不可を検証。**Vercel認証がホーム画面版でも機能すること**も評価する。
7. 新しい合成Auth/世帯/写真は**実HTTP検証ができる時だけ作成**し、登録メール/UUIDを固定して残存0件まで確認。パスワードをチャット・ログ・Issueへ出さない。

## 合格・公開へのゲート

- PR #109の最新HEADで**全CI成功**し、認証付き保護環境の新コホートQAが安全に稼働する
- **実StorageのCDN HIT由来200が失効後ゼロ**であると、ブラウザとEdgeログ両方で確認する
- **実iPhone2台**で上記9項目が合格（Safariとホーム画面版）
- 既存写真への対応／セキュリティ警告のリスク受容または修正を文書化
- Museなど別の監査者の独立レビューと、**オーナーによるPRマージ・本番公開の個別承認**が済む

資料：
- [Supabase Storage CDN](https://supabase.com/docs/guides/storage/cdn/fundamentals)
- [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase CDN purge (Pro以降)](https://supabase.com/docs/guides/storage/cdn/purge-cdn-cache)
- [Issue #96](https://github.com/rodaisuki1023-alt/ig-public-assets/issues/96)

**判定：正式公開不可／P1継続**。費用0円の枠内、本番・マージ・Supabase設定変更なし。
