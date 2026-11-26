# あとこれ v50｜写真のキャッシュ残存 P1：対策提案・実測ゲート

作成：2026-11-23 JST ／ **Draft・未公開・実Supabase未改変**

## 根拠（合成Auth A/B/Cの実iPhone QA・試用Supabase edge_logs）

認証付きQAで家族AがBを招待し合成JPEGを共有、AがBを除外した後：
- Bの以前アクセスした**同じ認証付きStorage URL**を `fetch(...,{cache:'reload'})` で再取得すると **HTTP 200**。Supabase Edgeログの **`cf-cache-status=HIT`** を確認。ブラウザのローカルキャッシュだけの事象ではない。
- Bの新規nonce＋`cache:'no-store'`、除外後の新JWTでの写真GETは **HTTP 400、`cf-cache-status=BYPASS`**。DBのメンバー権限判定は新規取得で適用される。
- Cの別世帯GET拒否、新旧JWTの在庫操作RPC拒否、合成写真のアップロード/削除、JPEG SHA-256照合は確認済み。
- 試験コホート `d59b5fa73f` はオーナー承認後に完全削除し、Auth/世帯/写真など14カテゴリ残存0を確認。以前の合成ユーザーを再使用しない。

このため **正式公開のP1を未解消として保持**。元画像・URLを取得済みの相手による画像コピーの回収は技術的に不可能。

## 独立Draft PRの防御強化（候補・本番未反映）

- `household-sync-v37.js` の**新規JPEGアップロード**で `Cache-Control: private, no-store, max-age=0` を明示する。Supabase StorageのバイナリPOSTはこのヘッダーを保存しレスポンスに使用する実装（storage-js StorageFileApi / storage server uploader）。従来のPOSTに `no-cache` が混ざっていた状態から明確化。
- 写真の**GETは現状の認証付きURL**、Bearer JWT、常に異なる `?v=`、`cache:'no-store'` と `Cache-Control: no-cache` を継続。署名URLや公開URLへ変更しない。
- 参照するJSアセットを `v50.6` に更新し、Service Workerキャッシュを `atokore-pwa-v50.6` にしてiPhoneの旧スクリプト残存を防ぐ。商品状態/IndexedDB/Supabase schemaは変更しない。
- 追加ユニットガードで、新規写真のupload TTL=0・private GET・nonce・非公開経路を確認。
- Supabaseサーバーの生バイナリアップロード実装は`cache-control`ヘッダーの値を保持するため、短いTTLだけではなく**private＋no-store**も指定する。これはCDN/ブラウザにキャッシュを保存しないよう要求するためで、CDNの実挙動で確認する必要がある。
- **重要**：`max-age=0` はCDNからのデータの消滅を保証するための機構ではない。CDNの実挙動、Safari/PWA、元URLを別ユーザーが持つケースは新しい**別コホート**で実HTTP再検証が必須。

参考：
- [Supabase Storage CDN Fundamentals](https://supabase.com/docs/guides/storage/cdn/fundamentals) — private bucketはキャッシュの存在、cf-cache-statusでHIT/BYPASSの判定
- [Storage SDK Upload](https://github.com/supabase/storage-js/blob/main/src/packages/StorageFileApi.ts) — 生データPOSTの`cache-control: max-age=<cacheControl>`形式
- [Storage Server Uploader](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts) — バイナリPOSTヘッダーはファイルメタデータへ保存
- [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn) — キャッシュと削除・短いブラウザTTLの注意
- [Cache Purge](https://supabase.com/docs/guides/storage/cdn/purge-cdn-cache) — APIはsecret keyおよびProプラン以上が対象で、**無料枠前提の対策に採用しない**

## 次の合格条件（実HTTP試験ではゼロ妥協）

1. 本Draftでアップロードした合成写真について、オーナーA・参加者Bの除外前GETは200、SHA-256一致。別世帯Cは拒否。
2. Bの除外後、**同一URL**でブラウザ標準cache、`cache:reload`、`no-store`、そして**新規nonce**と新JWTの全てを計測。Safari NetworkログおよびSupabase `edge_logs` の `cf-cache-status` をセットで比較。
3. **新しくネットワークへ到達した再取得で一度でも写真をHTTP200配信した場合は FAIL（P1継続）**。単にUIから隠れた、HTTP400を返した一部ケースだけで合格としない。旧URLの同一ブラウザ内キャッシュが200でも、ソース・HTTPヘッダー・エッジログで判別する。
4. バケット内の以前にアップロードされた写真は、TTLが残る可能性がある。現在の対策では**既存写真を自動修復しない**。正式公開へ持ち込む既存写真の更新/ローテーションと削除手順を独立検証し、既に取得されたコピーは回収不能と明記する。
5. 実iPhone **2台**のSafari/PWAで、招待・オフライン同時+1・同期+2・写真追加/除外/再取得拒否を確認。
6. 独立CI/実HTTP/独立監査が成功した後、オーナーが別途PRマージ・正式公開を承認する。

## 代替案（max-age=0でも失効しない場合）

サーバー側で**毎回Authセッションと世帯所属を再照合し、レスポンスに`private,no-store`を付ける**専用写真中継を検討。Supabase Edge Functions free quotas / Vercel free limitsを確認した上で、サービスロール鍵をブラウザへ出さずに実装する。旧Storage CDNのURLがなお再利用できる問題には、既存オブジェクトへのアクセス遮断/移行または新たな隔離設計が必要で、中継導入だけで旧URLが失効するわけではない。

**本番変更・課金・試用SupabaseのRLS/Auth/Storage設定変更・合成Authの新規作成なし。現時点の公開判定：不可。**