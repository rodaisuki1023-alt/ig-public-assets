# あとこれ v50｜家族写真の即時権限失効：CDN再発を受けた設計変更案

作成：2026-11-23 JST。**設計審査用・非公開Draftのみ。実DB/本番/既存試用設定の変更は許可されていない。**

## 1. 実測された失敗（仮説ではない）

試用Supabase `atokore-family-trial` の2回の合成 A/B/C・iPhone Safari実HTTP試験で、Bの家族除外後に**以前取得した同一URL＋`cache:reload`がHTTP 200で合成JPEGを返した**。2回目（コホート `c0e4b6f7a9`）には、新規アップロードの `Cache-Control: private, no-store, max-age=0` を適用済みだったが失敗は継続。Edgeログで旧URLの除外後GETが `cf-cache-status=HIT` / 200、別nonceのB新規GETと再Auth後のB新規GETが `BYPASS` / 400と確認できた。

**結論**：現在の「クライアント→Supabase Storage `/object/authenticated/` 直接GET＋毎回nonce」方式では、通常操作は新規認可されても、持ち去られた旧URLからのCDN再配信を防ぐ根拠がない。TTLを0にする案は**不合格**。PR #109のコードをこのまま公開しない。

同試験コホート `d59b5fa73f` と `c0e4b6f7a9` は、各回で本人承認を受け、UUID限定で削除済み。対象Auth/household/Storage等14カテゴリ0件を独立照合。再利用禁止。

## 2. 比較と採否

| 案 | CDNの旧URLの課題 | 追加固定費 | 事業面・結論 |
| --- | --- | --- | --- |
| A. 同じStorage URLでno-store/短TTL/nonce | **実機でFAIL**。旧URL HITあり | 0円 | **不採用**。通常クライアントの新規GET防御は維持可 |
| B. 退会・除外時に旧写真を削除、ランダムパスへ再アップロード | キャッシュ失効の伝播に時間差。アップロード時の障害・他メンバー同期・大量写真移行が難しい | 無料枠内の可能性 | 主対策にはせず、既存写真の廃止/移行案として検証 |
| C. **新しい写真オブジェクト名前空間＋毎回サーバー認可付き画像中継** | **新規経路では直接Storage GET不可**とする。古い旧バケットURLは明示移行・削除が別途必要 | Edge Functions無料枠内で収まるか実測 | **優先設計案**。費用/権限/キャッシュ試験まで未合格 |
| D. 正式版で家族の写真共有だけ一時非提供 | 新しい共有写真の取得経路を作らない。**旧URLは放置せず既存分の封鎖が必要** | 0円 | Cが遅れるときの代替。端末内写真は保持し、商品在庫・共有同期は維持。採用は別途製品判断 |

## 3. 優先設計C（実装前提・未デプロイ）

1. **新規private bucket（例 `atokore-private-photos-v2`）**を作成。JPEG/サイズ80KiB以下。端末ユーザー(`authenticated`/`anon`)がこのバケットを直接GETできる **SELECTポリシーは作らない**。新しいファイルを旧バケットへ直接保存しない。Storageの直接URLにJWTを付けても、エンドユーザーはどの写真も取得できないことを最初に実証する。
2. **Supabase Edge Functionか同等の保護されたサーバー**を使い、写真の取得/登録/削除を一元化する。クライアントは毎回Auth JWTで関数へ **POST**（GET URL/CDNキャッシュを使わない）。サーバー側で`auth.getUser`と現在のDB世帯所属・生存レコードIDを**要求のたびに照合**。単なるJWTのロール/世帯クレームやクライアント指定UUIDを信用しない。別世帯・除外済み・期限切れは拒否。
3. 認可成功したリクエストに限り、**サーバー内部だけ**でsecret/service権限により新バケットを読み書きする。秘密鍵はEdge Functionの環境変数で管理し、HTML/JS/PR/ログに埋め込まない。書込先は `householdId/itemRecordId/randomUuid.jpg`、パスを厳格正規表現で検証し、上限バイト・Content-Type/実JPEGマジックバイトを検証。識別子以外をオブジェクト名に含めない。
4. 写真のレスポンスは `Cache-Control: private, no-store, max-age=0`、`Pragma: no-cache`、`Vary: Origin`、`X-Content-Type-Options: nosniff`。Cookieや永久署名URLでの直配信はしない。許可オリジンを列挙し、CORSを最小化。認証結果を永続キャッシュせず、利用中のDB状態を毎回参照する。
5. **失敗時は閉じる**：認可RPC不応・関数障害・同期不一致の場合、共有写真は返さない/アップロードしない。ローカルの写真・在庫・未送信変更を破壊しない。再試行や明示エラーを提供する。
6. **旧バケットからの切替**：既存の旧パスをただ中継へ切り替えるだけでは旧URLのキャッシュHITが残る。既存パスを列挙・個別照合し、新バケットへの移行と**旧オブジェクトのStorage API削除**、旧GET不可の監査を別工程で行う。旧URL/CDNキャッシュの失効遅延を測定し、**旧URL経由の200が残る間は公開しない**。元画像を保存済みの利用者から回収することは不可。バケット/DBの実変更前にオーナー承認。
7. 新方式の本番反映は、SDK/Edge Functionsの無料枠使用量、写真転送コスト、Auth/DB呼出回数、80KiB制限、PWA/オフラインの失敗ケース、RLS/secret管理を**非公開の合成環境**で試験してから判断する。

## 4. 厳格な受入試験（実HTTP・Edgeログ）

同じ認証付与を持つA/B、別世帯Cで**新規1回限りの合成コホート**を使う。Vercel認証保護とowner入力経路を確認し、再実行しない。合成後はUUID照合→別途削除承認→14カテゴリ0件検証。

- A upload→A/BのEdge Function POST写真取得が200、バイト数/SHA256一致。Cは403/404。Storage直接GETは**A/B/Cいずれも拒否**。
- AがBを除外 → Bの旧JWTでも再Auth新JWTでも、**以前と同じ写真リクエストを繰り返しても**Edge Functionは拒否。Cも拒否。Aのみ200。エッジの旧URL cache:reload/同一URLと旧バケットを別途直接調査。
- HTTP 200の再現を**ブラウザ/Edgeログ両方**で確認。旧URLのCDN HIT・画像返却が残るなら**P1 FAIL維持**。ブラウザのローカルキャッシュとCDN通信を区別。
- A/Bで同時更新、写真差替え/削除、オフライン復帰、APIタイムアウト、認可DB障害、回線切断、ログイン切替/除外、古いJWT、パス偽装、サイズ超過、異常JPEG、過度の連続取得の全ケースをテスト。
- **物理iPhone2台のSafariとホーム画面版は現在オーナー希望で保留**。保留のまま「完了」にしない。
- セキュリティ独立レビュー（Muse等）、Supabase Advisor（既存SECURITY DEFINER 15件等）、無料枠見積、旧写真の後片付け、PR最新HEAD CI全成功、本人の別途マージ/公開承認が揃うまで本番不可。

## 5. 実行順と権限境界

1. **自走可**：上記設計の脅威モデル、最小API/DB関数案、非公開Draftコード、モック/隔離PG自動テスト、競合/コスト調査。
2. **本人追加承認**：新バケット作成、試用DB/RLS/Auth/Edge Functions設定/デプロイ、合成Authの再作成、旧写真移行/削除、本番デプロイ、マージ、課金。
3. **オーナー保留**：iPhone2台の現物受入（本人の再開意思が出るまで催促しない）。
4. **2026-11-23の状態**：`PR #109`のアップロードヘッダー対策は**実HTTP不合格**。本ファイルは**修正方針の候補であって安全な完成品/実装完了ではない**。P1は継続。

## 出典

- Supabase Storage CDN: https://supabase.com/docs/guides/storage/cdn/fundamentals
- Supabase Smart CDN: https://supabase.com/docs/guides/storage/cdn/smart-cdn
- Supabase private buckets: https://supabase.com/docs/guides/storage/buckets/fundamentals
- Supabase Edge Function + Auth: https://supabase.com/docs/guides/functions/auth-legacy-jwt
- Supabase CDN Purge（Pro以上・secret必要。無料枠採用不可）: https://supabase.com/docs/guides/storage/cdn/purge-cdn-cache
- 実測と削除後照合: https://github.com/rodaisuki1023-alt/ig-public-assets/issues/96

**追加費用0円・Draft維持。本番/試用DBの変更・マージ・正式公開・課金なし。**
