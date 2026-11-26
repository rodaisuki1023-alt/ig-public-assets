# 写真共有 一般運用の設計・受入ゲート（2026-11-24）
状態: DRAFT。試用専用ゲートは34/34 HTTP QA合格。一般運用は未実装/未承認。合成試験後、試用RPCのauthenticated EXECUTEを解除し閉鎖。旧写真に変更なし。

## まず安全な公開範囲
- 現行クライアント household-sync-v37.js は photoGatewayEnabled=false 時に旧直接Storage通信へ戻る。既知の失効失敗があるため、一般公開候補ではこの分岐を削除する。機能OFFなら共有写真をネットワークへ送らず、端末内写真と通常の在庫/買い物/リストを保持する。未検証のゲートへ自動切り替えしない。
- 関連するローカルE2Eは household-sync-v37.spec.cjs、polish-v44.spec.cjs、w2-backup-share.spec.cjs。tests/household/emulator.cjs の旧Storageルートを利用しているため、専用POSTゲートのエミュレーションへ移し、既存の共有成功・除外後表示消去・ログアウト・復元テストを維持する。フラグOFF時に通信ゼロ、ゲート拒否時にフォールバックゼロを追加。
- 既に端末へ保存/取得された写真のコピーを遠隔回収できるとは説明しない。同期・画面再表示・権限失効時の表示消去を検証。

## 一般用オブジェクト台帳と状態遷移（実装前の契約）
- private schemaに台帳。世帯ID、商品ID、サーバー発行のUUID、操作ID、期待する旧photoPath/版、作成者、状態、予約期限、実サイズを保存。一般ユーザーへの直接CRUD権限なし。RLSと固定search_path、既存RPCに必要なauth.uid()・現存session_id・active member・非アーカイブ世帯・現商品を照合する。招待ゲストも既存の権限モデルで確認する。
- reserved → uploading → uploaded → attached → retired → purging → purged。新規パスは使い回さない。未確定/期限切れ/失敗オブジェクトも実体削除が確認できるまで容量を課金上限の見積りに含める。purgedは再添付不可。予約を発行してもアップロード成功とは表示しない。
- reserve: 世帯ロックと台帳上の実体+未確定予約を同一DBトランザクションで数える。商品に有効な予約1件のみ、操作ID同一再送は同一結果。サーバーがパスを採番し、upsert:false。失敗時の予約回収と監査可能な掃除処理。
- upload: サーバーでサイズ・真正なJPEGを検証（SOI/EOIマーカーだけは不十分。デコード上限も要確認）。権限を前後再確認。Storageからの成功/失敗を台帳へ整合。転送中に除外された場合は結果を返さず安全に回収。
- attach: 世帯ロック下で期待photoPath/版と現在値のCAS、一致するuploaded予約、所有世帯/商品、現在の権限を確認。台帳attached・商品参照の更新・旧attached→retiredを一つのDBトランザクションにする。hh_push/create/set の任意photoPath注入や旧パス再添付をサーバー側で拒否する。既存の他のフィールド更新を壊さない。
- read: 参照中のattachedのみ、毎回生存セッション・メンバー・最新photoPathを照合。認可の前後チェックを維持。POST+no-store、Storage URLを返さない。除外後の新旧JWT、同一URL、跨世帯、再ログイン、非認証、同時更新の試験。
- delete: 参照をCASで解除してretired化。purging権限は台帳のretired/無参照のオブジェクトのみに限定し、再添付を不可にしてからStorage API remove。削除済確認後purged。SQLでstorage.objectsだけ消さない（孤立実体を作る）。失敗/タイムアウト時は未確定扱い。現行参照を指す写真を消さない。旧バケットと既存写真は別承認・別手順。
- quotaの初期値は仮案: 1枚80KiB、世帯50枚（約3.9MiB）、同一商品未確定1件、世帯未確定3件、試用全体100MiB。実利用・無料枠・期限切れ掃除/失敗実測で調整。仮値は販売条件ではない。無料枠の実測転送量、Edge呼出とストレージ利用を集計し、予算上限近傍で新規共有アップロードを停止してローカル写真を保持。有料サービス自動追加禁止。

## 次の実装順と検証
1. 台帳/予約/確定/解除/削除状態遷移を隔離PGlite＋実PostgreSQL競合試験。50枚上限、同時reserve、重複op、CAS失敗、除外/失効、旧path復活、未確定/失敗掃除、二重削除、異世帯、匿名直接権限のケース。
2. 一般用サーバー実装を別Draftで作成。認証・JPEG・制限・台帳のテストを必須にする。試用の専用cohortガードを一般用として単に解除しない。
3. クライアントの旧直接アクセス分岐を完全除去し、mock POST通信に置き換えた回帰試験を通す。機能はOFFのまま。
4. 合成データだけで実HTTP検証、ブラウザCORS/PWA/実iPhone検証。旧写真移行はコピー→SHA256→CAS→新読み取り確認→旧参照削除・CDN再確認（個別承認）。
5. 公開は別承認。OCR実レシート再計測、独立UX、収益化ディープリサーチと改善のPhaseを経て最終判断。

参考: https://supabase.com/docs/guides/auth/sessions ; https://supabase.com/docs/guides/storage/management/delete-objects
