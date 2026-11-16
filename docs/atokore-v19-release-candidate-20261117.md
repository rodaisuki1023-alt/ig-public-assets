# あとこれ v19 試用公開候補（公開前承認ゲート）｜2026-11-17

このDraft PRは**公開設定に固定しているv19試用版ソースだけ**を、統合済みの候補`4fcbb825f8d3b893ae060a62fcaf7f4a209c0fea`へ更新する提案。PR作成時点で公開・本番・データ変更はしない。

## 根拠（GitHubで直接取得した記録）
- 元の固定SHA：`efc11f747e1a7fdafa927350361c3a029738f552`
- 新しい固定SHA：`4fcbb825f8d3b893ae060a62fcaf7f4a209c0fea`（`codex/atokore-integrated-v49-review` HEAD）
- 統合PR #101 のHEAD `ec0644050cfc2bc5300f9ff7c2fcb8bb6bda81cc` は、Chromium / WebKit の実ブラウザ・PGlite/PostgreSQL並行処理・単体・UIチェックを含む3ワークフロー全部success。統合後HEAD`4fcbb825f8d3b893ae060a62fcaf7f4a209c0fea`でもPeach UI / Baby Visuals / v19 Trial Checksの3ワークフローすべてsuccess。
- v19のGitHub Pagesビルドは`scripts/atokore/build-preview.py`で別storage keyへ分離しfamily syncを止める設計。**設計の記述とテスト成功は実際の配信/実世帯データの安全性の独立証明ではない**。

## 本人の公開前確認（必須）
- [ ] GitHub Actionsの最新HEADで試用プレビューのビルドと隔離確認（参照SHAが一致）
- [ ] 実端末iPhoneで、v19試用版の初回在庫が空・保存/削除/検索・写真・復元Undo/重複IDの動作・レイアウト（320/375/393/430px）を**架空データで**確認
- [ ] 現行の通常版・試用版の公開先URL、Pagesワークフロー出力を記録し、ロールバックできることを確認
- [ ] 公開操作により実家族データを消したり上書きしないことを確認。実世帯データの読取や書込検証は禁止
- [ ] オーナーが「試用版の公開」を**明示承認**する

## 安全ルール
このPRはDraftのまま保留すること。AI COMPANYの別の自動タスク、Claude Code、Museによる自動mergeや`workflow_dispatch`禁止。`main`変更・GitHub Pages公開は別承認。通常版のv12.5mや他プレビュー用SHAは変更しない。
