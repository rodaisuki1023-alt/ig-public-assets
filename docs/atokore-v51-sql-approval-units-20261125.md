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
