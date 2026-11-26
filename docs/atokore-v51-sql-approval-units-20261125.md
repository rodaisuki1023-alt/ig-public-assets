# あとこれ v51：SQL草案の承認単位と、独立審査用の資料（2026-11-25）

**どの草案も、実DB（試用・本番）には適用していません。**

- 承認単位は次の4つで、それぞれ別々に判断できます。どの単位も、適用済みマイグレーションだけを前提にしています。
- 単位どうしの依存は「写真A→写真B」だけです。担当・持ち物共有は、写真の単位がなくても単独で適用できます。それぞれのテストは草案を1本だけ適用して実行しています。
- 4単位すべてを次の順に1つのDBへ適用しても衝突しないことを、PGliteで確認しました（`atokore-photo-legacy-closure-v51.test.cjs`）。
  - 写真A → 担当 → 持ち物共有 → 写真B段階1

| 単位 | ファイル（適用順） | 依存 | クライアントのフラグ（既定） |
|---|---|---|---|
| 写真A：新しい写真ゲート・上限・台帳 | `atokore-photo-gateway-v50.sql` → `atokore-photo-reservation-v50.sql` → `atokore-photo-lifecycle-v50.sql` → `atokore-photo-service-v50.sql`（試用ではさらに `atokore-photo-general-trial-scope-v50.sql` と `atokore-photo-budget-v50.sql`）、Edge `photo-general-edge-v50.ts` | 適用済みマイグレーション | `photoGatewayEnabled: false` |
| 写真B：旧バケットの段階的な閉鎖 | `atokore-photo-legacy-close-writes-v51.sql`（段階1）→ 移行の完了 → `atokore-photo-legacy-close-reads-v51.sql`（段階2） | 写真A。段階2は、旧オブジェクトが0件でなければ実行を拒否します | — |
| 担当：買い物の担当と返信 | `atokore-buy-assignment-v51.sql` | 適用済みマイグレーションのみ | `buyAssignments: false` |
| 持ち物共有：準備の設定と今日のチェック | `atokore-prep-share-v51.sql` | 適用済みマイグレーションのみ | `prepSharing: false` |

**家族の同時購入（P1）について**
新しいSQLは使いません。購入ごとに別の項目として記録し、既存の `hh_push` の項目ごとの同期で合算します。
- 実PostgreSQLで2本の接続から同時に書き込み、240／再送しても240／片方の取り消しで180になることを確認しました（`tests/household/purchase-merge-postgres.cjs`）。
- どの単位の承認にも依存しません。

## 2026-11-26 追記2：Work第5回の指摘への対応（5単位。どれも実DBには未適用）

| 単位 | ファイル（適用順） | 依存 | 切り戻し | 根拠（テスト） |
|---|---|---|---|---|
| 写真A | gateway → reservation → lifecycle → **service**（`upload_sha256`）→ `atokore-photo-legacy-migrate-v51.sql` | 適用済みマイグレーション | 移行がまだ1件も実行されていなければ、関数・テーブルを削除し、v50のガードを再適用する。移行を実行した後は、旧写真が残っている間に `photo_legacy_restore_v51` で1件ずつ戻してから削除する | migrate 10件（本物の一般ゲートを使用。取得できない写真は削除しない、各段階からの復旧、別の参照の保護、復元リハーサル、範囲の制限） |
| 写真B | close-writes（段階1）→ 移行の完了と読み取り確認 → close-reads（段階2） | 写真A | 段階2の後は、v44の読み取りポリシーを再作成する | closure 8件。実PostgreSQL（読めない写真があれば拒否、同時書き込み、同時閉鎖） |
| C 担当 | `atokore-buy-assignment-v51.sql` | 適用済みマイグレーションのみ | `rollback/atokore-buy-assignment-v51.rollback.sql`（データを退避してから削除。許可リストは残す）／ `.restore.sql` | assignment 8件、rollback 4件 |
| D 持ち物 | `atokore-prep-share-v51.sql` | 適用済みマイグレーションのみ | `rollback/atokore-prep-share-v51.rollback.sql` ／ `.restore.sql` | prep 7件、rollback 4件 |
| E 取消の期限 | `atokore-purchase-undo-window-v51.sql`（別のRPC `hh_undo_purchases_v51` を追加。**既存のRPCは置き換えない**） | 適用済みマイグレーションのみ | `DROP FUNCTION public.hh_undo_purchases_v51(jsonb)` | window 5件。E2E（期限切れの表示） |

- 5つの単位は、それぞれ単独で適用できます（`atokore-sql-units-rollback-v51.test.cjs`）。
- 合成世帯の許可リスト（`trial_households_v51`）は、どの単位も `IF NOT EXISTS` で作り、共有しています。どの単位を切り戻しても、許可リストは残ります。
- 詳しい内容は `docs/atokore-v51-safety-20261126.md` にあります。

## 2026-11-26 追記：Work第4回の指摘への対応（どれも実DBには未適用）

| 単位 | 追加・変更したファイル | 主な変更 | 根拠（テスト） |
|---|---|---|---|
| 写真A | `atokore-photo-legacy-migrate-v51.sql`（新規）、`photo-orphan-worker-v51.mjs`（新規） | 旧参照から新台帳への移行（begin → コピー → SHA照合 → CASで切り替え → 旧オブジェクトの削除 → finish）。どの段階も再実行できる。コピー中に商品が変わったら移行を中止し、コピーは孤児として回収する。孤児回収の1回分の処理：期限切れの予約の退役、退役済みの写真の削除、台帳にない古いオブジェクトの削除（削除の直前にロックを取って再確認し、参照中のものは消さない）。止まったアップロードは報告だけする | `atokore-photo-legacy-migrate-v51.test.cjs`（5件） |
| 写真B | `atokore-photo-legacy-close-reads-v51.sql`（段階2を変更） | 閉鎖の条件に次を追加：旧参照が0件（削除済みの商品の参照も数える）／未完了の移行がない／台帳・参照・実体が一致している。条件はアドバイザリーロックとSHAREロックの下で確認する | `atokore-photo-legacy-closure-v51.test.cjs`（8件）、実PostgreSQL `tests/household/photo-legacy-close-postgres.cjs`（CIに追加） |
| 担当 | `atokore-buy-assignment-v51.sql` | NULL・空白・前後に空白がある返信・未知の語を拒否（`NULL NOT IN (...)` がNULLになって素通りしていた）。家族から抜けたときは、担当の解除・その人が出した未回答の依頼の取り下げ・未送信の通知の破棄を行う（membersのトリガー）。`notify_due_v51` は送信の直前に、所属と担当の一致を確認し直す（送信はしない）。合成世帯の許可リストに入っている世帯しか使えない | `atokore-buy-assignment-v51.test.cjs`（8件） |
| 持ち物共有 | `atokore-prep-share-v51.sql` | 文書全体をサーバー側で検証（必須項目の欠落・空白の名前・IDの形式と重複・存在しない子ども・未知のキー・不正な日付）。比較はすべてNULLを安全に扱う。チェックは「この世帯の、その日の行」だけを受け付ける（作ったIDや別の世帯の行は拒否）。合成世帯の許可リストで制限する | `atokore-prep-share-v51.test.cjs`（7件） |
| 購入の取り消し期限（新規の小さな単位） | `atokore-purchase-undo-window-v51.sql` | `hh_undo_purchases` に、サーバーの時計で10分の期限を追加（10:00以降は `purchase_undo_expired` を返し、何も変えない）。既に取り消し済みのものの再送には、従来どおり応答する | `atokore-purchase-undo-window-v51.test.cjs`（3件。9:59は取り消せる・10:00と10:01は拒否・まとめて送ったうちの1件が期限切れなら全体を戻す） |

- **変異テスト**：次の修正をそれぞれ1つずつ元に戻すと、対応するテストが失敗することを確認しました。
  - 写真Bの旧参照の確認
  - 実PostgreSQLのLOCK
  - 写真Aのコピー照合
  - 担当のNULL返信の拒否
- **確認できていないこと**
  - 旧URLがCDNから消えたかどうか（A1）。隔離環境のSQL試験に合格しても、それだけでは合格にしません。
  - 実HTTPでの受入、Storage APIを使うワーカーの実環境での動作、通知の実送信。いずれも未実施で、別の承認が必要です。

## 写真A：Workの前回指摘への対応

| 指摘 | 対応 | 根拠（テスト） | 残り |
|---|---|---|---|
| 確定時の再認可 | `photo_attach_v50` は確定のたびに、品目のロック・会員かどうか・期待revision・ストレージに実在するかを確認します | `photo-lifecycle`：「stale revision and removed member cannot attach」 | 実HTTPは未実施 |
| 予約後の解約 | **v51で追加**：写真がない商品に新しく写真を確定するとき、世帯のプランの上限を確認し直します。超えていれば `photo_plan_limit` で拒否します。差し替えは枠を使わず、確定済みの写真は消しません | `photo-lifecycle`：「confirm re-checks the plan …」 | — |
| 予約の期限切れ | 期限切れの予約は確定できません（`photo_attach_conflict`）。枠を使ったまま残り、信頼できるワーカーだけが `photo_retire_expired_v50` で退役させます | `photo-reservation`：「expired reservations remain charged」、`photo-lifecycle` | ワーカー本体は未作成 |
| 孤児ファイルの回収 | 退役 → `photo_claim_purge_v50` → Storage APIで削除 → `photo_finish_purge_v50`（`p_api_confirmed=true` のときだけ purged） | `photo-lifecycle`：「attach, replace, detach … confirmed purge」、`photo-general-http` | ワーカー本体と実Storageは未実施 |
| 旧台帳の取り込み | 台帳にない旧参照は `photo_legacy_hold` で止めて、上書きしません。コピーは `photo-legacy-migration-rehearsal-v50.mjs`（SHA照合・CASの前に停止）で行います | `photo-migration-rehearsal`、`photo-lifecycle` | CASで切り替えるRPCは未作成（下記） |
| 同期・復元との互換 | 管理モードでは `photoPath` を `hh_push` から送りません（`wireFields`）。新しく作るレコードは null の項目を持ちません。端末内の写真はバックアップに含まれ、共有の枠は使いません | `household-core`、`atokore-photo-gateway-browser`、w2-backupのE2E | 復元した写真を共有に再登録する導線は未設計 |
| ゲートから旧Storageへのフォールバック禁止 | 出荷するコードにStorageのURLも旧バケット名もありません。ゲートでエラーになっても旧経路は使いません | `photo-legacy-closure`（静的検査）、`atokore-photo-gateway-browser`：「NEVER falls back」 | — |

## 写真B：旧URL（A1）

- **段階1**
  - 旧バケットへの新しい追加を止めます。
  - service_role 専用の一覧（参照中の写真と孤児の写真）を用意します。
  - 家族は、移行が終わるまで旧写真を見られます。除外したメンバーはオリジン側で拒否されます。
- **段階2**
  - 旧オブジェクトが残っているとき、または段階1が未適用のときは、実行を拒否します。
  - 実行すると、クライアントからの読み取り・削除の経路をすべて閉じます。
- **合格していない点**
  - CDNに残った旧URLは、実プロジェクトで時間を置いて測るまでFAILのままです（無料プランにはpurgeがありません）。
  - 隔離試験に合格しても、それだけでは合格にしません。
- **未作成**
  - 移行用のCASで切り替えるRPC（service_role専用。期待seqと旧パスを確認して、新しい台帳行と同時に確定する）
  - Storage APIで削除するワーカー
  - どちらも別の承認・レビューが必要です。

## 担当・持ち物共有（写真とは別に承認）

- どちらも次の手順で処理します。
  - `lock_member` で世帯をロックし、会員かどうかを確認し直す。
  - revisionを比較する（持ち物のチェックは冪等）。
  - RLSを有効にし、テーブルへの直接の権限は与えない。
- ロールバック：関数とテーブルを削除します。中身は担当の状態と準備の設定だけで、在庫・買い物・写真は含みません。
- テスト：`atokore-buy-assignment-v51.test.cjs`（JSの方針との一致を含む）、`atokore-prep-share-v51.test.cjs`、エミュレーターでの2台のE2E。

## 審査者へのお願い（未確認の点）
- Supabase実環境の `auth.sessions`、Storageのポリシー、Edgeの実行時の挙動。
- 写真Aのワーカー（期限切れ・孤児の回収）と、移行用CAS RPCの設計レビュー。
- 無料枠への影響（Edgeの呼び出し回数・転送量）の実測。
