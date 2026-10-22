# あとこれ試用版 Googleログイン v41

2026-10-23 JST。試用版ソース `22cc9b86419bb4789be62c8ecdfe604b255483a8` の配信準備記録。
ソースの `docs/atokore-google-v41-activation.md` と PR60 にある「OAuth未作成・無効・CI待ち」は過去時点の記録。本書の実サービス確認結果がその後の状態です。

## 現在確認したこと

- 専用プロジェクト `atokore-family-trial`（ref `vzyxurodowpjltwbgbyc`、東京）は ACTIVE_HEALTHY。
- 公開キーによる `/auth/v1/settings` で `external.google: true`。クライアントシークレットは取得・出力していない。
- `/auth/v1/authorize?provider=google` からGoogleへHTTP302。GoogleクライアントIDの末尾は `ehhvk3i2b27ddn3499ea69l2tafbiud9.apps.googleusercontent.com`、callbackは専用プロジェクトの `/auth/v1/callback`、scopeは `email profile`。Drive/Sheets権限はない。
- Googleの「ログイン」画面まで到達。ログイン先表示はSupabaseのプロジェクトホスト名。実アカウントのログイン・Google同意・アプリへの復帰は未実施。
- ソース最終CI `39866488068` は成功。Chromium/WebKitの重要34件＋残り220件＝254件成功、WebKitのService Worker未対応2件スキップ。Node回帰と実PostgreSQL競合ジョブも成功。表示確認のCI `39866488046` と `39866488135` も成功。
- Supabase管理画面のブラウザはサインインが必要なため、今回Google Audience/Testing・テストユーザー一覧・ブランド設定の管理画面での再確認は行っていない。以前のSite URL/試用版限定redirect保存は過去の記録。現在の認証入口とcallbackは上記HTTP応答で確認。

## 配信変更

Pagesワークフローの `preview-baby-v19` 固定ソースSHAだけをv41へ更新し、配信時のガードを専用バックエンドの公開設定とSW v41に合わせる。アプリソースPR60はDraftのままmainへマージしない。通常版のソースは変更しない。

公開される設定は公開publishable keyだけ。Google Client SecretはSupabase内に留める。認証入口を開いただけでは在庫を変更せず、認証前のバックエンド通信なし・キャンセル時の保存保持をソースCIで確認済み。世帯作成・参加・在庫取り込みは利用者の確認操作後だけ。

## 公開後に確認すること

1. Pages配信成功と、試用版の全ファイルが隔離ビルドと一致すること。通常版は公開前のファイルと比較する。
2. 試用版の「マイページ」→家族共有→「Googleでログイン」から実Google画面へ到達すること。
3. 本人のアカウントでログインを完了し、同じ試用版へ戻ること。在庫を取り込む前に保存内容を確認する。
4. 家族の別アカウント・スマホ2台で招待、同時数量変更、買い物完了、オフライン復帰を確認する。
5. iOSホーム画面PWAでGoogle認証から戻っても保存領域とログインが継続すること。

実Googleログイン完了・実機2台・iOS PWAは未確認。写真共有・決済・有料APIは追加していない。公開の成否やファイル比較結果は実行後の事実だけを追記する。
