# あとこれ家族共有 v40：専用DBとGoogleログインの接続準備

## 対象と現在の公開状態

- 試用版専用Supabase：`atokore-family-trial` / `vzyxurodowpjltwbgbyc` / Tokyo / PostgreSQL17。作成時の費用見積もりは月$0。
- 試用版：https://rodaisuki1023-alt.github.io/ig-public-assets/preview-baby-v19/
- 通常版、Threads用DB、旧家族共有Draft PR17には変更しない。
- ブラウザの `ATOKORE_HOUSEHOLD_CONFIG` は引き続き **null**。設定完了まで家族共有メニュー・バックエンドへの通信は出さない。
- ソースはDraft PRで保持し、mainへマージしない。公開する場合はPagesワークフローの試用版ソースSHAだけを更新する。

## 2026-10-22に実施したこと

既存2つのマイグレーションを変更せず、Supabase CLIで新規作成した `20261022065854_atokore_household_hardening.sql` を追加。専用プロジェクトへ3本を順に適用した。

| リポジトリのファイル | Hosted migration version |
|---|---|
| `20261022000000_atokore_household.sql` | `20261022070846` |
| `20261022000100_atokore_entitlements.sql` | `20261022070856` |
| `20261022065854_atokore_household_hardening.sql` | `20261022070857` |

MCP適用時にサーバー側の時刻で履歴番号が付くため、ファイル名と履歴番号は異なる。今後CLIでこのプロジェクトにpushする前に履歴を照合し、既適用SQLを再実行しないこと。

修正した問題：

- 不完全な操作（kind/fields欠落）で正常な商品までバッチ全体が巻き戻る。
- 買い物完了の在庫登録が拒否されても、買い物行だけ削除済みになる。
- 世帯ロック待ちの間に外されたメンバーが、待機解除後に更新・招待・利用回数消費を行える。
- 外されたメンバーが作った招待が残る。招待と参加が逆順にロックして待ち合う。
- 拒否された操作を受信後、サーバーの一覧で端末データを置き換え、未共有の商品が消える。
- 共有データの保存後に同期用の保存だけが失敗し、再読み込み後に受信した数量を端末の追加操作と誤認して二重加算する。
- 参加時の「数量を足す」が保存失敗・応答消失後に再実行され、数量をもう一度足す。
- オフライン中の同期がawait前に失敗すると処理中のPromiseが残り、オンラインへ戻っても同期を再試行できない。

拒否時は端末内容と拒否操作を残して同期を停止。本人が確認した場合だけ、端末の控えを保存してから共有内容に合わせる。控えの保存が失敗すれば再開しない。拒否の応答が失われて再送された場合も、元の拒否結果を返す。

在庫と同期情報は別々に保存するため、在庫を書き換える前に保存途中の記録を永続化する。再読み込み時はその記録を先に復旧し、新しい差分や通信を作らない。途中で端末が編集されていたら自動で上書きせず停止し、控えを残した本人確認後だけ再開する。参加の確定済み内容は元の操作IDと数量を使って再送し、同じボタンを再度押しても合算を組み直さない。

Google認証はSupabase AuthのPKCE（S256）。試用版専用の保存キー、同じパスに戻るURL、使い捨ての試行情報、期限確認を使う。ブラウザには公開キーだけを置く。Googleのクライアントシークレットは置かない。Auth用コード・エラー・予期しないトークン断片はURLから除く。GoogleのDrive/Sheets権限は要求しない。

## 検証の区別

- ローカル：従来のNode回帰テストと、SQL・同期・PKCEの追加テスト。
- ブラウザ：Google画面から戻る部分は模擬リダイレクト。実際のGoogleアカウントでのログインを確認したものではない。
- 通信障害：端末を実際にオフラインにする確認に加え、模擬サーバーが対象ユーザーの更新リクエストを受けてからSQL適用前にTCP接続を切る。受信回数、共有側の数量が変わらないこと、端末の未送信操作IDが再読み込み後も同じこと、再開後に1回だけ反映することを検証する。ブラウザの通信差し止めの観測回数には依存しない。
- Hosted PostgreSQL17：合成IDで作成・参加・数量変更、不完全なバッチ、買い物完了のロールバック、脱退後の拒否、権限閉鎖をトランザクション内で確認しROLLBACK。
- Hostedの2接続競合：MCP経由の実行は順番になり、ロック待ちを再現できなかった。成功扱いにしない。
- CIに別ジョブを追加：使い捨てPostgreSQL17を2接続で動かし、実際のロック待ちを確認してからメンバーを外す。更新・招待作成・招待無効化・利用回数消費の拒否、参加失敗の同時レート制限、同時数量変更を検証。
- セキュリティ診断：privateテーブル9つの「RLSにポリシーなし」は直接アクセスを全拒否する設計。公開RPC12個のSECURITY DEFINER警告は意図した入口で、各RPCは本人・世帯権限を検証する。警告ゼロとは表現しない。

Hostedで競合を試す際に使った合成世帯IDは `3039ea10-2645-4bae-b23c-bfc968c5510c`、名前は `__atokore_v40_qa_revocation__`。実利用者・写真・在庫は含まない。物理削除の接続ツールがInvalid or expired requestStateを返したため、通常の脱退RPCで全員が抜けた状態にして世帯をアーカイブした。確認結果：稼働世帯0、稼働メンバー0、在庫レコード0、実アカウント0、アーカイブ済み合成世帯1。広い条件で削除しない。

CI `39770260491` のPostgreSQL17.11別接続テストは6項目成功：ロック待ち中の更新・招待作成・招待無効化・利用回数消費の4項目で脱退後の拒否、12件同時の参加失敗は10件まで、2人が同時に1つずつ減らすと在庫3→1。

## 所有者が行うGoogle側設定

この環境のコネクタにはGoogle Cloud OAuthクライアント作成とSupabase Auth設定更新の機能がない。設定前に公開キーをアプリへ入れて共有を有効化しない。

1. https://console.cloud.google.com/auth/overview を開き、あとこれ用プロジェクトを選択または作成する。
2. Google Auth PlatformのBrandingでアプリ名「あとこれ」と連絡先を設定する。試用中はAudienceをTestingにして、利用する本人・家族をTest usersへ登録する。
3. Clientsで **Web application** のOAuthクライアントを作成する。
4. Authorized JavaScript origins：`https://rodaisuki1023-alt.github.io`
5. Authorized redirect URIs：`https://vzyxurodowpjltwbgbyc.supabase.co/auth/v1/callback`
6. https://supabase.com/dashboard/project/vzyxurodowpjltwbgbyc/auth/providers を開き、Googleを有効化。Client IDとClient Secretを **Supabaseの設定画面へ直接** 入力して保存する。Secretをチャット・GitHubへ貼らない。
7. SupabaseのURL Configuration：https://supabase.com/dashboard/project/vzyxurodowpjltwbgbyc/auth/url-configuration 。Site URLを試用版URLに設定する。追加Redirect URLは試用版のパスに限定し、`?atokore_auth=<ランダム値>` を受け付けるパターンを設定・検証する（候補：`https://rodaisuki1023-alt.github.io/ig-public-assets/preview-baby-v19/**`）。同じオリジン全体を許可するワイルドカードは追加しない。
8. 完了したら「Google側を設定した」と伝える。Secretの共有は不要。公開設定の到達確認後に、試用版設定を `{url, anonKey: 公開キー, google: true, email: false}` にして検証・公開する。

Googleログインを使う場合は独自SMTPを先に契約する必要はない。メールログインは、別途メール送信を設定・検証するまで公開しない。

## 公開前に残る確認

Google Auth設定とリダイレクト許可の実サービス確認、実アカウントでのログイン成功・キャンセル、スマホ2台での共有、iOSのホーム画面PWA→Google→ブラウザの保存領域継続。特にアプリ内ブラウザではGoogleログインが制限される場合があるため、Safariでも確認する。

参考（公式）：

- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/sessions/pkce-flow
- https://supabase.com/docs/guides/auth/redirect-urls
- https://developers.google.com/identity/protocols/oauth2/web-server
