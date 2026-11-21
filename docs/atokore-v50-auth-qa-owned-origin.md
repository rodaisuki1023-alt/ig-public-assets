# あとこれ v50：正式Auth/Storage QAのホスト・証拠・配信ゲート

2026-11-20。Workによるコホート d59b5fa73f の初回試験はRawGitHack External Content Noticeで停止。Auth作成0件・実HTTP 0件・試験データ残存0件。停止した結果をPASSとみなさない。

## 安全な実行オリジン

- RawGitHackはGitHubのQAソースを配信する第三者であり、Workが資格情報の入力を止めた判断は正しい。RawGitHackへ新旧問わずパスワードを入力しない。
- QAページは厳密な allowlist を設け、https://rodaisuki1023-alt.github.io/ig-public-assets/tests/manual/atokore-v50-auth-qa.html だけでログイン処理が進む。別ドメイン・別パスではボタンを無効化する。
- 上記GitHub PagesのQAパスは現時点で配信未確認。GitHub mainのtreeには tests/manual/atokore-v50-auth-qa.html がなく、現HEADのソースはDraftにしかない。URLを勝手に生きたものとして案内しない。
- GitHub Pagesの既存ルートを壊さず、対象QAページのみを配信するには、公開範囲・SHA・切り戻しを明示してオーナーの別途承認が必要。ソースをDraftへ置いただけでは公開されない。
- ページには公開可能なpublishable API keyのみ。service_role鍵・JWT・パスワードはコード・URL・ログ・GitHub・永続ストレージへ書かない。秘密鍵をチャットで受領しない。

## Workが指摘した3点の対応

1. 同世帯Bのhh_changesが合成商品IDを含むことを正例で確認し、別世帯Cのhh_changesに合成商品IDが現れないことを負例で確認。
2. 旧JWTでのRPC拒否はHTTP403とPostgREST SQLSTATE42501の両一致でのみPASS。HTTP400/401/404/429/5xx、ネットワークエラーはPASSにしない。
3. 合成JPEGへのStorageアクセスは、所有者Aの200応答を正例として、別世帯/除外後GETのHTTPステータスと非秘密キャッシュヘッダーを取得。既存URLと新規nonce URLをそれぞれ測定。403/401と、A=200が確認済みの既存オブジェクトへの明示NotFound応答を区別して記録。500等の障害を拒否成功として扱わない。Storage API削除後はAからの新規URLで不存在を確認。ブラウザやCDNの全キャッシュ消去まで保証するものではない。

## 再試験・クリーンアップ

- A/B/Cは今回の合成コホートで事前に存在しないことを別途確認する。QA画面のテストボタンは一度だけ押す。再試行は二重作成を検出して停止。
- 結果画面の非機密テキストと合成UUID/世帯IDだけを取り出す。作成したAuthユーザーは正規のAuth管理UIで厳密なUUID照合のうえ削除。
- JPEGはStorage APIで削除。household/records/ops/invites/receipts等は対象世帯UUID・ユーザーUUID・コホートの全一致を確認したトランザクションでのみ削除する。削除後に0件readback。
- 完了判定には実HTTPSのAuth/RPC/Storage実測、実iPhone Safari/PWA、Muse独立監査、本人の公開承認を個別に必要とする。CI合格のみでは本番OKではない。
