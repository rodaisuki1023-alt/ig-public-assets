# 一般写真ゲート 再監査・試験ゲート 2026-11-24
状態: HOLD。独立監査ではなく実装担当による再監査＋Supabase Advisor。全実DB適用・公開なし。

## 確認済み
- 26a0ac58 の Chromium系 job 138317838009 成功。一般JPEG、localhost HTTP＋PGlite＋模擬Storage、client再送テスト、期限切れ回収の合格ログあり。実PostgreSQL job 138317837464 成功。
- WebKit job 138317837906 は285 passed、9 skipped、1 failed。w2-backup-share.spec.cjs の共有中の写真設定後、5秒以内に詳細画像が表示されない。端末保存をネットワーク待ちから分離し、write通信を保留したまま詳細写真の表示を確認する回帰試験を追加。再CIは未確定。
- trial SupabaseはQA RPC EXECUTE=false、旧合成Auth0、QA写真0、旧写真1、新バケット専用ポリシー0、一般台帳未適用。Advisor は認証済み SECURITY DEFINER、旧Storageの匿名sign-in許可、漏洩パスワード保護、RLS policyなし通知。一般用 service bridgeは service_role 限定だが実環境では未検証。
- 新規のP1: 未送信変更を別世帯へ持ち越す可能性。新protocolでは保存時に世帯＋利用者へ紐付け、既存の無紐付けpendingは保留、端末のみの写真は明示的な共有開始時の扱いを維持。新旧世帯/同一世帯別ユーザー試験を追加。

## 無料枠の制御
2026-11-24 公式 https://supabase.com/pricing および https://supabase.com/docs/guides/platform/manage-your-usage/egress
Free: storage 1GB、uncached egress 5GB、Edge invocations 500000。組織全体の実使用量と請求サイクルは別途確認。
Draft: 80KiB/写真、50/世帯、100MiB/試用全体。写真の許可済みリクエスト月4000、日80/人、日120/世帯、256KiB/許可リクエストの概算予約（最大1000MiB）。失敗時に返金しない。予算RPCが失敗すればStorageへ進まない。これらは仮値。無認証・不正リクエストもEdgeの呼出として数えられ得る。Auth/DB/他サービス通信、cleanup、実転送や請求期のずれもあるため、上限はプロバイダー料金の完全な保証ではない。計測ダッシュボード、総量停止手順、cleanup予算と呼出制御は残課題。

## 実環境試験の前提
1. 最新HEADのCI全成功。一般protocol実ブラウザ/IDB再起動テスト、依存固定/監査、Deno実行時検証。独立レビューの指摘修正。
2. 試用DBの現状を再取得し、既存写真・他の世帯の変更を避ける。一般案のtriggerは既存records全体に作用するので、そのまま適用しない。隔離cohort限定の橋渡し・予算・triggerまたは完全隔離の試験DBが必要。旧バケット未変更。
3. 追加費用なしの試験環境と個別承認後に合成A/B/Cを用意。通常ユーザーに公開しない。管理者が作成した固定IDと世帯だけに許可。試験後停止＋照合のうえ別承認で削除。
4. 合成A/B/C: 認証、世帯内画像ハッシュ、跨世帯/直URL/無認証拒否、B除外後旧新JWT、read中除外、同時予約/更新、失われた応答の再送、detach/retire/実Storage purge、予算拒否、CORS、再読込。ローカル試験は代替にならない。
5. 旧写真移行、既存ユーザー権限変更、正式公開、課金は別承認。

## 公開ブロッカー
- 独立監査未実施。自己レビューとAdvisorを独立監査と呼ばない。
- 旧URL CDN失効未解決、旧写真移行未承認。
- 一般向け実Supabase HTTPは未実施。前回の合成専用ゲート34/34とは別。
- 無料枠: アプリ側の限定制御のみ。全組織実使用量は未取得。
- 新HEAD CI未確定、実iPhoneは別ゲート。
