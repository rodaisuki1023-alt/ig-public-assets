# あとこれ v19 試用公開候補（公開前承認ゲート）｜2026-11-17

このDraft PRは**公開設定に固定しているv19試用版ソースだけ**を、統合済みの候補 `4fcbb825f8d3b893ae060a62fcaf7f4a209c0fea` に更新する提案。PR作成・本書の修正では、公開・本番・実データ・DBは変更しない。

## 実際の差分とテスト状況
- 元の試用版固定SHA：`efc11f747e1a7fdafa927350361c3a029738f552`
- 更新候補の固定SHA：`4fcbb825f8d3b893ae060a62fcaf7f4a209c0fea`（`codex/atokore-integrated-v49-review`）
- 統合PR #101 のHEAD `ec0644050cfc2bc5300f9ff7c2fcb8bb6bda81cc` は3ワークフロー全success。統合後のHEAD `4fcbb825f8d3b893ae060a62fcaf7f4a209c0fea` も「Atokore Peach UI Checks」「Atokore Baby Visuals Check」「Atokore v19 Trial Checks」の3ワークフローがsuccess（GitHub Actionsから直接取得）。
- **PR #102自身のチェックは未実行／0件**。上記の成功は、この公開設定変更を含むGitHub Pagesビルド・実配信の合格を意味しない。
- PR #102のアプリ変更はなし。Pagesワークフローの**v19固定SHAだけ**を更新し、他のプレビュー・通常版固定SHAは維持。

## 家族共有の安全上の重要な区別（2026-11-17 再監査）
- `scripts/atokore/build-preview.py` はトップレベルHTML/JSにある既知のlocalStorageキーをv19専用名へ置き換え、**旧 `family.js` のみをスタブへ置換**する。未変換の既知キー・HTMLから参照されるファイルがあればビルドを停止する。
- 一方、`index.html` は**別実装**の `household-config-v37.js`、`household-core-v37.js`、`household-google-v40.js`、`household-sync-v37.js` を読み込む。設定ファイルには試用専用Supabaseのpublishable key / URLがあり、`household-sync-v37.js` は設定が有効なら初期化され、既存セッションによっては自動同期し得る。
- よって「v19では家族同期をすべて止める」「ネットワークへ一切送らない」と**表現してはならない**。実機で試用DBを使う家族共有は機能として存在する。従来の「family sync disabled」は**旧 `family.js` に限る**。
- Pages通常版とv19試用版のlocalStorageキー分離はコード／CIの対象だが、**既存v19利用者の保存データや試用DBの内容が更新後も安全かどうか**は、CIだけでは証明できない。DBのRLS/権限と実接続の独立確認は未了。
- PR #93/#98で扱う「家族から除外」と進行中のレシート確定の競合については、隔離DB上の修正候補と実DB適用を混同しない。**現行試用DBへの反映・動作確認ができるまで、これを解消済みと断定しない**。

## 公開前ゲート
- [x] v19候補ソースの3系統CI成功（候補固定SHAを直接照合）
- [x] v19の公開固定SHA差分が1箇所のみであることを確認（PR #102パッチ）
- [x] 旧 `family.js` と新 `household-sync-v37.js` の違いを静的確認し記録
- [ ] PR #102のHEADから、**Pages公開を行わない**一時環境でワークフロー相当のビルドを実行し、差分と隔離・構文・テストを検証
- [ ] 実際のiPhone画面で、初回在庫空、保存/削除/検索、写真、復元Undo、重複ID拒否、320/375/393/430pxを**架空データだけ**で検証。新バージョンのiPhone確認は、更新候補にアクセスできる隔離試用環境が用意された後に実施
- [ ] Googleログインと家族共有について、専用の**検証世帯**でのみ、試用DBのRLS・非メンバー拒否・削除済みメンバー拒否・既存v19保存状態を照合。実世帯データでの読取/書込試験は禁止
- [ ] 現在の公開URL、既存v19データ、通常版、Pages出力を変更せずにロールバックできる手順を確認
- [ ] オーナーが**「試用版の公開」**を明示承認する

## 安全ルール
Draftのまま維持し、AI COMPANYの別の自動タスク・Claude Code・Museによる自動マージや`workflow_dispatch`を禁止する。`main`、GitHub Pages、実Supabase、実世帯、通常版、課金設定への変更は別承認。iPhoneの操作確認や実DB確認を、この文書の静的監査だけで「完了」としない。
