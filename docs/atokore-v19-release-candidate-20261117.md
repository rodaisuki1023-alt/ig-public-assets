# あとこれ v19 試用公開候補（公開前承認ゲート）｜2026-11-17

このDraft PRは、**v19試用版の公開元だけ**を統合候補 `4fcbb825f8d3b893ae060a62fcaf7f4a209c0fea` に変更する提案。2026-11-17時点で、公開・実DB変更・実世帯データ操作・通常版変更は行っていない。

## 差分と検証結果
- 旧v19試用版固定SHA：`efc11f747e1a7fdafa927350361c3a029738f552`
- 新v19試用版固定SHA候補：`4fcbb825f8d3b893ae060a62fcaf7f4a209c0fea`（`codex/atokore-integrated-v49-review` HEAD、PR #101統合先）
- 統合候補HEADのCIはPeach UI / Baby Visuals / v19 Trial Checksが**3系統success**（GitHub Actions runs 43892386036 / 43892386213 / 43892386072）。
- **PR #102専用の、公開を行わないCIを追加してsuccess**： [Atokore v19 Release Candidate Dry Run / run 44073871798](https://github.com/rodaisuki1023-alt/ig-public-assets/actions/runs/44073871798)（実行対象HEAD `73f8632997012f69241c5115ca31358d9715e3d8`）。固定SHA確認、候補のチェックアウト、Pagesと同じ `build-preview.py` による生成、全生成JSの構文、既知の通常版localStorageキー分離、旧family.jsスタブ、**新household-sync実装の存在**、保存・バックアップ・初回登録・いつものリスト単体回帰テストがすべてsuccess。
- PR #102内の公開設定差分はv19固定SHA1箇所のみ。別途 `.github/workflows/atokore-v19-release-dry-run.yml` と本書が追加・更新されている。通常版・他プレビュー用SHAは不変。
- **この成功はGitHub Pagesの実配信、実iPhone、実DBのRLS認証、実世帯データ保存を検証したものではない。**

## 家族共有の安全上の重要な区別
- `scripts/atokore/build-preview.py` は既知のlocalStorageキーをv19専用名へ置換し、旧 `family.js` のみをスタブ化。未変換の既知キーやHTML参照欠落はビルドで拒否する。
- しかし `index.html` は別系統の `household-config-v37.js`、`household-core-v37.js`、`household-google-v40.js`、`household-sync-v37.js` を読み込む。試用専用Supabase設定が有効で、既存セッションによっては同期が動作し得る。**「家族同期を完全に停止」「外部通信なし」とは言えない**。
- 現行のv19試用環境とDBには既存データがあり得るため、公開によって家族共有や保存済みデータを壊さない検証が必要。
- 2026-11-17の管理接続確認：Supabase `atokore-family-trial` は一覧/詳細APIで `ACTIVE_HEALTHY` と報告された一方、`execute_sql` と `list_migrations` はPostgreSQL認証失敗 (`28P01`)、`get_advisors` はhibernatedと返り**RLS/現行関数・権限は読み取り検証できなかった**。同じ確認を繰り返したり、DB権限・接続設定を自動変更しない。
- PR #93/#98で扱う「家族除外とレシート確定の競合」対策は、隔離PostgreSQLでのレビュー候補のみ。試用DBに適用済みとは言えない。現行SQLとの差分（2関数の `my_household` → `lock_member`）はGitHubソース上で確認済み。
- DB接続復旧後に**メタデータ限定の読み取り**で確認する対象：テーブルのRLS有効化・policy一覧、SECURITY DEFINER関数の`search_path`・PUBLIC/anon/authenticated EXECUTE権限、receipt claim/finishの関数定義と修正候補との差分、適用済みmigration。実世帯テーブルのレコードは照会しない。

## 公開前ゲート（記録は過大評価しない）
- [x] v19統合候補HEADの3系統CI成功
- [x] 公開用v19固定SHA差分と通常版・別プレビュー不変を静的照合
- [x] 旧 `family.js` と現役 `household-sync-v37.js` を識別
- [x] PR #102専用・非公開の候補生成、構文、保存キー分離、主要単体回帰テストがsuccess（run 44073871798）
- [ ] GitHub Pagesの公開経路全体のビルド／生成物照合（**配信なし**での独立再現が理想。実配信は未実施）
- [ ] 320 / 375 / 393 / 430pxの表示、初回在庫空、検索、写真、保存失敗、復元Undo、重複ID拒否を**iPhone実機・架空データだけ**で確認
- [ ] **検証世帯のみ**を用いた家族共有の非メンバー拒否・除外済みメンバー拒否、旧v19保存状態と同期への影響を確認。接続可能になるまで未完了
- [ ] 既存v19・通常版・他プレビューの公開ファイル/サービスワーカー/キャッシュ/保存キーを保護し、公開後の退避・復帰方法を確認。旧SHA `efc11f747e1a7fdafa927350361c3a029738f552` へのピン差し戻しは、**配信済みのデータを削除しない条件付きのロールバック手段**であり、ユーザーデータの復元を保証しない
- [ ] オーナーが「**試用版の公開**」を明示承認

## 安全ルール
本PRはDraftを維持し、本人承認なしにmainへのマージ、GitHub Pages公開、`workflow_dispatch`、実Supabase DB/実世帯データの読み書き、課金・権限変更は行わない。新規CIには`pull_request`だけを設定し、`contents: read`以外のGitHub権限、Pages・デプロイ・DB資格情報・本番接続は付与しない。試用版公開の判断は追加ゲートの完了後に行う。
