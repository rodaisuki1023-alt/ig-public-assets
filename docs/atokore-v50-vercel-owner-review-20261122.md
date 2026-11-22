# あとこれ v50｜iPhone実機受入用・独立Vercelサイト構成（未デプロイ）

- 基準アプリ: Draft PR #106 HEAD `b82add14b2f75f17db78dc378961d04a1a98e1b8`
- 本ブランチ: `chatgpt/atokore-v50-iphone-acceptance-site-20261122`。PR #106 / main / 本番・既存試用版は不変更。
- サイトの性質: **家族共有無効・Googleログイン無効・端末内のみ**の合成データ検証用。
- **実Supabase Storageの失効・2端末家族共有の検証には使えない。**
- 費用: Vercel Hobby無料枠のみ。有料Password Protection、Pro、外部有料監視・新ドメインは禁止。
- 配信: オーナーの承認を得たときだけ。Vercel認証 **All Deployments** を先に有効化。レビューサイトに実家族情報を入力しない。

## ビルド

リポジトリルートの `vercel.json` に以下を設定:

- framework: `null` (静的サイト)
- buildCommand: `python3 -I scripts/atokore/build-local-review.py atokore-live-v125 _local_review 19 && python3 -I scripts/atokore/verify-iphone-review-build.py _local_review`
- outputDirectory: `_local_review`

既存の安全なローカルビルダーを再使用し、通常の家族共有設定を `null` にする。新設した検証ガードが出力パス、共有無効、試用Supabase URL/秘密キー文字列、PWA・アセット存在を検査。検証失敗時はビルド失敗にする。

**注意**：この「ビルド時検証」は、Vercel上の認証保護の代替にはならない。`vercel.json` の検索エンジン無効化ヘッダーも認証の代替ではない。

## Vercelでの安全なサイト作成・検証

1. GitHubからこのレビュー用ブランチのコードを読み込める**正しいオーナーのVercelアカウント/チーム**で、新しい独立プロジェクトを作成する。既存の試用サイト・AI COMPANYのプロジェクトを流用しない。
2. **配信前**にプロジェクト `Security > Deployment Protection > Vercel Authentication > All Deployments` を有効化。Vercel Hobbyで可能（2026-09-09以降、全デプロイ保護が追加料金なし）。パスワード課金やProアップグレードは行わない。
3. リポジトリの**本ブランチだけ**をレビュー元として使う。自動的にmainの通常版をデプロイしてしまわないよう、最初のデプロイ対象ブランチとビルド設定を確認する。自動ビルドを有効にする場合は別途設定意図を確認。
4. VercelのBuild Logsで `PASS: private review output is isolated...` を確認し、Review URLとデプロイのGit SHAを記録。
5. オーナーで認証していないブラウザから静的ファイルを取得できないことを確認。サービスワーカー、PWAアイコンやモデルファイルも含めて保護されること。既存本番/試用URLが変わっていないことを確認。
6. iPhoneのSafariで認証後、ホーム画面に追加して同一URLでPWAを起動。架空の20商品・持ち物チェック・レシートの合成画像・写真選択を試験。Safari/PWA別のブラウザ保存領域を混同しない。
7. Safari/PWAでそれぞれオフライン再起動・数量更新・復帰後の保持、バックアップ/復元、画面幅・横スクロール、OCR処理時間とメモリ落ちを実測。**デプロイメント保護を有効にしたままPWAオフライン動作が可能か要測定**。

### できないこと

ローカル限定ビルドにはSupabase家族共有が一切含まれない。2台で同じ家族在庫を同期することも、実Storage写真アクセスの失効試験も**合格扱いにできない**。これらには、別途アクセス制限付きで合成アカウント・合成世帯・合成画像だけを扱う実Supabaseテスト用導線が必要。環境を準備して**HTTPで除外後の旧キャッシュ/新規GETを分離実測**しない限り、公開不可を維持。

## 事故対応とロールバック

- 意図せず公開状態になった場合: URLを共有せずVercelプロジェクトへのアクセスを停止し、Security設定で全デプロイの保護を確認。保護できなければデプロイを削除。
- ビルドに失敗した場合: アプリ本体には触れずこのレビュー用ブランチだけで原因を調べる。家族共有設定を有効化して回避しない。
- 旧オリジンとのIndexedDB/localStorage競合を避けるため、新しい独立オリジン以外には配信しない。
- 本番/既存試用/PR #106のマージ・Supabase Auth/RLS/Storage変更・課金は別承認が必要。

## 2026-11-22 現時点の障害

Vercel接続先チーム `rodaisuki1023-4199` はHobbyだが、`create_project` 操作が **403 Forbidden (You don't have permission to create the project)**。現在の接続からは新規プロジェクトの作成・デプロイができない。接続アカウントの変更またはWork内のオーナー認証を確認する必要がある。**受入URLは発行済みではない。**

正式公開ゲートは引き続き Issue #96。

## 2026-11-23｜既存Vercel検証サイト（作成済み）と実Storage試験の分離

- 認証付きHTTPS：https://atokore-v50-owner-review-20261122.vercel.app
- GitHub VercelデプロイのREADY成功と、Workによる未認証302→Vercel Authenticationを確認。設定のAll Deployments維持が前提。
- **トップのiPhone用アプリは引き続き家族共有無効**で、端末内の架空データを操作するだけ。検証版が実家族アカウントに接続することはない。
- 別の `/qa/atokore-v50-auth-qa.html` をQA専用としてビルドに同梱する。こちらに限り`atokore-family-trial` の公開可能なpublishableキーで合成Auth A/B/Cの実HTTPS RPC/Storageをテストできる。**ページを配信しただけではアカウントも世帯も写真も作成しない。**
- QAの許可オリジンはVercelの上記正規ホストと固定の`/qa/atokore-v50-auth-qa.html`のみ。RawGitHack/GitHub Pages/別Vercelホストではボタンを無効にする。実家族データ、既存アカウント、実写真/実レシート、service_roleキーは使用しない。
- **起動条件**：Vercel Deployment Protection / All Deployments をWorkブラウザで最新デプロイ含め再確認。未認証でルート・QAの両方が302で認証に転送されることを確認してから、合成Authアカウント作成・QAを進める。認証保護が検証できなければQAページを開いてもパスワードを入力しない。
- 元のGitHub Pages版は`example.invalid` A/B/C 3件のAuth管理UIでの事前作成が必須。メール検証等で追加の有料サービスは使わない。アカウント未作成なら結果は**未実施**、無関係な認証ユーザーで代用しない。
- 一度実行したら結果の合成UUID等で写真・世帯・Authを識別して削除し、後片付け0件を確かめる。削除は照合結果に基づき対象だけに限定し、既存家族や他ユーザーを削除しない。
- 外部ストレージの**cache:default 200**と**新しいnonce + no-storeの新規通信**を区別して受け入れ評価する。古いコピーをすべて回収することはできない。
- このQA導線は公開後の家族共有付き2台実機テストを意味しない。家族のSafari/PWA確認は別途行う。
- レシートOCRは今回の正式版では非表示（再精度検証まで保留）。過去のOCR検証手順は製品の受入条件から外し、研究用のみ。
