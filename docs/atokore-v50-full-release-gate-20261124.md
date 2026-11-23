# あとこれ v50｜一括完成ゲートと安全な導入手順（2026-11-24 JST）

**用途**：オーナー最終承認用、実装/試用/公開を明確に分ける。追加固定費0円。PR #109内の資料・コードは一切本番反映していない。

## A. 実測済みの現状と止めているP1

1. Supabase試用 `atokore-family-trial` は `ACTIVE_HEALTHY`。旧写真バケット `atokore-product-photos` は private。SQL読み取りでStorage **1オブジェクト**、未削除のアイテムの `photoPath` **1件**、両者の対応 **1件**、孤立画像 **0件**。機密の実写真パスや画像本体はこの資料へ出していない。
2. 合成A/B/Cの2回の実iPhone HTTP試験で、Bを世帯から外しても、除外前に取得済みの**同一直接Storage URL**がEdge `cf-cache-status=HIT` で HTTP200。新しいアップロード `Cache-Control:private,no-store,max-age=0` でも再発。**旧方式はFAIL**。
3. A/B/Cの他の認証/共有/家族除外/RPC/Storage削除試験は合格。使用済み合成2コホートは各回オーナーの明示承認後、関連14カテゴリ残存0件まで完全削除した。
4. 物理iPhone **2台**でのSafari/PWA家族同期試験は本人希望で今は保留。代わりのWebKit CIでは正式合格扱いにしない。

## B. GitHub非公開PRの進捗

- [x] 保存中断時に失敗としてロールバックする仕組み、共有中の復元/取り消しガード、破損バックアップ内ID重複拒否を既存v50コード上で確認。古い修正PR #94/#95は closed/unmerged だが相当機能は統合ブランチ上に存在し、再実装は避ける。
- [x] 2026-11-18適用済みのレシート確定×家族除外ロックSQLとGitHub SQLの一致を確認。新規DB変更を重ねない。
- [x] 持ち物チェック（在庫非連動）、ホーム2導線、レシートOCR公開UIを非表示にするコードの存在と自動テストを確認。
- [x] 新しい認証付き画像配信 **非公開Draftコードのみ**：`supabase/functions/atokore-photo-gateway/index.ts`、`_shared/photo-gateway-handler.mjs`、`_shared/photo-gateway-policy.mjs`。実Authユーザーを再照合、現在の家族所属と対象レコードの存在を `hh_photo_access` で毎回確認し、サーバー内のsecret Storage clientだけが読み書き。POSTのみ、厳格パス/JPEG、失敗時は画像非返却、権限失効が読取中なら直前にも拒否。URLやサービスキーを返さない。
- [x] クライアントには `photoGatewayEnabled===true` の**明示的オプトイン**を実装。未有効では従来試用経路のまま（**本番不可**）。ON時のゲートエラーは**旧Storageへフォールバックしない**。
- [x] 未適用SQL草案 `supabase/proposals/atokore-photo-gateway-v50.sql`：新規private bucket、エンドユーザーの直Storageアクセスを許可するRLS policyは**作らない**、新しいBoolean RPCで `auth.uid` と世帯/レコード/同一 `photoPath` を照合。正式migrationファイルはレビュー後のSupabase CLIで作成。
- [x] ゲート単体、認可途中の家族除外、write後除外時の新規オブジェクト後始末、ブラウザ旧URLフォールバック禁止、隔離PGliteでの新バケット直読取拒否/世帯剥奪/写真参照一致の各回帰テストをGitHub Actionsへ追加。
- [ ] **最新HEADで全CI合格**とEdge Functionモジュールのデプロイ時型/依存ビルド確認（最新CI終了待ち/試用デプロイ未実施）。ソースコード作成は実通信合格ではない。

## C. 試用適用の承認前チェック（厳格な順番）

1. 影響対象：試用Supabase **`vzyxurodowpjltwbgbyc`だけ**。本番のバケット/DB/ユーザー/Secretsには触れない。GitHubの対象PRとHEAD SHA・Vercel保護済みPreviewを確認。
2. **本人の個別承認後**、新private bucket `atokore-private-photos-v2` と専用RPC `hh_photo_access` を新しいmigrationで作成し、原本/実行SQL SHA/戻し方を記録。既存テーブルや既存写真は変更しない。Storage `SELECT/INSERT/DELETE` は新バケットへの end-user ポリシーなしを照合。
3. 新Edge Functionのデプロイ前に、`ATOKORE_ALLOWED_ORIGINS` を実際の認証付き試用ドメインに**完全一致**で設定。secretはサーバー環境にのみ保持し、コミット/ログ/HTMLへ出さない。Auth方式は `withSupabase({auth:'user'})`、`verify_jwt=false` をコードで補完し、未認証/偽JWT/他世帯から呼べないことを確認。
4. 新合成A/B/Cで端末ブラウザの写真ゲートONモードを保護付き試用だけで有効化し、画像アップロード→同世帯A/B閲覧→別世帯C拒否→B除外→旧JWT/再ログイン新JWTで**同じPOSTを繰り返しても**画像取得拒否、A閲覧維持をブラウザとEdge logsの双方で測定。新バケットへの**直接GET**はA/B/Cで常に拒否。
5. 旧バケットの実オブジェクト **1件** は、個別に所有者/参照先/複製先の一致を確認する。**既存画像の自動削除は不可**。所有者が理解して承認した後、Storage APIだけで移行/旧オブジェクト削除（DBでstorage.objectsをDELETEしない）。旧直接URLの同一URL/cache:reload等でCDN HTTP200が失効したことをログ付きで再確認しない限り公開ゲートはFAIL。
6. 新しい合成データは新コホートUUIDを記録。実験後、**別途本人の削除承認**を得て対象UUID限定で削除し、Auth/DB/Storageの14カテゴリ0件を再測定。

## D. ロールバック

- **デプロイ前**：実DB・本番の変更なし。Draftブランチと実装ファイルを元へ戻すだけ。
- **新バケットとRPCだけ作成した後**：新ゲートが失敗すればフラグをOFFにするのではなく、家族共有写真を一時停止する。OFFが旧直接Storage経路を再有効化するため**公開中の回避策として使わない**。新しい写真のStorage API削除は参照/所有者を照合してから。
- **画像移行後**：旧Storage URLはCDN HITの余地があるため、移行元の旧バケットオブジェクト削除と独立なEdge計測まで再公開禁止。旧世帯・写真のバックアップと必要な復旧導線を事前設計。
- **不正なデプロイ/ブラウザ更新**：正式URL切り替え禁止/公開前ならPreview破棄、サービスワーカーのバージョン更新と保存キーの後方互換を検証。旧バケットの安易な再公開、service_roleのブラウザ配布、RLS緩和は不可。
- そもそも**ユーザーが以前に手元へ保存したJPEGの回収は不可能**。本件の安全性評価は「除外後の認可付き新規ネットワーク取得」へ限定。

## E. 本公開の残ゲート

| ID | 受入条件 | 現状 |
|---|---|---|
| P1-01 | 旧同一Storage URLの除外後HTTP200なし | FAIL。直接Storage方式不合格 |
| P1-02 | 新しいゲート経由の実HTTP試験 | 非公開Draftだけ。未実施 |
| P1-03 | 既存写真1件の移行/旧URL失効 | 未実施・個別承認条件 |
| P1-04 | 物理iPhone2台Safari/PWA | 本人希望で保留 |
| P1-05 | PWA保存・復元・同期・写真回帰 | 既存E2E合格、最終実機未了 |
| P2-01 | Supabase Advisorの既知警告/審査 | 15 SECURITY DEFINER、9 private no-policy、匿名サインイン/漏洩パスワード警告。意図と影響/対応を記録 |
| P2-02 | 独立Museセキュリティ・UX監査 | 未実施 |
| P2-03 | OCR利用者が修正不要で安全に登録可能 | 未実証。正式版入口を非表示継続 |
| P3-01 | 価格/機能/継続課金の需要検証 | 競合比較調査のみ可能。販売禁止 |
| FINAL | 依存PR統合・全CI/実通信/実機合格、ロールバック、本人承認 | 未実施 |

**PR依存**：#106（統合）→#108（OCR正式版保留・iPhone UI）→#109（写真Draft）。#107は#106上の別受入/QA枝、#102はmain向け試用公開承認待ちで、いずれもマージ禁止。統合時は差分重複や新旧キャッシュ、Vercelデプロイ先を別途照合。

**禁止維持**：本番公開、main変更、課金、PRマージ、試用Supabase Auth/RLS/Storage/Edge Functionへの実変更、実家族の画像/データ操作。本人の明示承認まで安全なソースとテストだけ進める。
