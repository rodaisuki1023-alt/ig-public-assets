# あとこれ v50｜6工程同時進行・最終公開ゲート
対象: Draft PR #109。既存データ変更、課金、公開、実写真の削除なし。

## 1. CI
基準973b1648の直前CIは単体/SQL/localhost HTTP/実PostgreSQL合格、受信側の写真表示のみ両ブラウザで不合格。修正後CIを確認し、サーバー確定行→受信端末の同じ参照→画像のnaturalWidthまで証明する。テストをskipしない。新Deno jobで実型検査と依存監査、lock候補を生成する。候補lockは監査結果・依存差分確認後にコミットし、以降は凍結利用する。CI未確定。

## 2. 独立監査・依存
GitHub #109 reviewsは今回確認時0件。実装担当による監査を独立監査と呼ばない。固定HEADで別担当に docs/atokore-photo-independent-audit-handoff-20261124.md を渡す。jpeg-js@0.4.4 は CVE-2022-25851 の修正版、CVE-2020-8175の影響範囲外。これは全依存の安全証明ではない。
https://github.com/advisories/GHSA-xvf7-4v9q-58w6
https://github.com/advisories/GHSA-w7q9-p3jq-fmhm
https://supabase.github.io/server/
https://docs.deno.com/runtime/reference/cli/audit/
Deno 2.9.8はCI候補、実Edgeランタイム同等性は別検証。生成lockの監査合格・コミットが必要。

## 3. 実Supabase
前回合成専用ゲート34/34は一般プロトコルの実証ではない。4一般提案＋合成限定scopeの最新版を同一transactionで適用し、初期無効・非匿名3固定ID・固定商品・既存権限不変を確認する手順。最新CI/独立監査/Denoを通してから適用。合成Authは管理画面で固定3アカウントを作り、本人が秘密を入力。QAスクリプトは scripts/atokore/photo-general-http-qa-v50.py。実試験後の合成削除は別承認。

## 4. 旧写真移行
旧画像をSQLや公開URLで転送しない。旧1枚は現状保全。まずread-onlyで参照数・サイズ・所有世帯・旧path・商品seqを再照合（ログに画像/URLを出さない）。別合成画像でコピーのrehearsal。予約済新pathにupsert:false・正規化・SHA256再取得・現参照の再確認。新たな移行専用CASで新台帳と商品参照を同時変更する必要があり、一般attachは旧参照を意図的に拒否する。CAS後、A/B閲覧・C拒否・除外後同一URL拒否を確認し、失敗時は旧データを保全。旧物理削除は別承認、Storage APIのみ。旧URLのCDN/ブラウザ失効は実測し、端末に既に保存されたコピーを遠隔回収できるとは言わない。
公式 https://supabase.com/kb/troubleshooting/storage-private-bucket-files-still-accessible-after-remove-access-or-logout
https://supabase.com/docs/guides/storage/cdn/smart-cdn
Smart CDNの最大60秒の説明をFree環境の保証に転用しない。移行は未実行、rehearsalのadapterも実接続未実装。

## 5. iPhone最終受入（物理端末2台）
保護された試用URLのみ。実データ不要、合成商品/写真のみ。端末A/BでSafariとホーム画面版をそれぞれ確認。320/390px、文字拡大、写真登録→即表示→相手表示、機内モードで保存→復帰、同時数量更新、同時写真更新、除外後表示消去、再ログイン、アプリ再起動後の操作ID復旧、端末バックアップ/復元、未送信の別世帯持越し拒否、無料枠停止時の案内。所要時間/実画面/エラー/判定を記録。物理端末は本人操作が必要、シミュレータと区別する。

## 6. OCR・UX・収益化
実レシート10枚: 商品行/数量72/72、商品名57/72（79.2%）。新規実写真未入手のため95%達成を主張しない。今回の追加はラーメン/ヨーグルト等の省略された味表記の誤統合防止と合成回帰。実レシートholdoutで完全一致/誤統合/手直し時間を測る。
持ち物の在庫未登録と0を区別し、数を自動変更しない。保育園の準備中に何が足りないか分かる導線を評価。Pattoは月300円・年3000円、無料30品、在庫/AI/予測/家族共有。園の持ち物チェックリストは子ども別・曜日別・家族共有も提供。よって単なるチェックリスト/人数増加を差別化にしない。価格398円は仮説。無料の基本セットと在庫・買い物、候補有料は子ども別の繰り返し準備＋補充の判断と安全な引継ぎ。各操作の所要時間・忘れ物減少・継続利用を検証し、課金は承認前に導入しない。
https://apps.apple.com/jp/app/id6760470920
https://apps.apple.com/jp/app/id6788250608
広告・SNS・DMなし、固定費0円、公開後のSEOは別承認。
