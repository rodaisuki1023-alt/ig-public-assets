# 写真ゲート v2｜合成実通信前の必須安全ゲート（2026-11-24）

## 検証済みの事実
- 前回HEAD `59acdba8`：5/5 GitHub Actions成功。Cloud Shell HTTP QAのオフラインself-testを含む。
- 試用DBの `auth.sessions` に id(uuid), user_id(uuid), not_after(timestamptz) の存在を読み取り確認。
- 公式資料: https://supabase.com/docs/guides/auth/sessions 、https://supabase.com/docs/guides/functions/auth 。JWTが期限内であってもログアウト等の失効を厳格に確認するにはsession_idと現存セッションを照合する。
- 稼働中の写真Functionは旧v1。一般公開/製品としての安全性は未証明。v1のまま合成アップロードも実行しない。

## 今回のDraft修正
- `photo-gateway-trial-guard.mjs`：初期状態は拒否。サーバー環境変数 ATOKORE_PHOTO_QA_ENABLED=true と ATOKORE_PHOTO_QA_USERS=A,B,C の相異なる3つの実UUIDがなければ503 qa_disabled。Originは本人確認の代用にしない。
- 確認済みAuthユーザー、JWT sub、session_id、非匿名・確認済みの合成メール、許可UUIDがすべて一致することを要求。A以外のアップロード/削除は拒否。
- 試用対象はf8a63d1e92のみ。商品ID qa_f8a63d1e92_item と固定ファイルID 5ca20f26-739f-4c19-8a75-56e09319af82 の組に限定。upsert:falseで同じ試験パスを繰り返し増やさない。
- 別SQL提案 `atokore-photo-gateway-trial-session-v50.sql` は既存公開boolean RPCに現存セッション、未期限切れ、合成世帯名/所有者/確認済みメール/現商品参照の照合を追加。旧バケット・既存RLS/世帯・Auth設定・写真は変更しない。
- 新モジュールの隔離JSチェック11件合格。追加Node/PGliteテストをCIに登録。最新CI合格は未確定。
- 新v2は正式な一般ユーザー用実装ではない。全実運用に必要なアップロード予約・世帯ごとのクォータ・参照CAS・安全な削除・真正JPEG検証・セッション失効・無料枠対策は別設計が必要。JWT/DB/Storageの独立チェックと実HTTPを省略しない。

## 再開順（承認必要）
1. 最新CIの結果とv2 SQL/Functionの整合を確認し、試用の新写真RPCとFunctionだけを更新する承認を取得する。まず無効状態（envを有効にしない）でデプロイしてJWT検証ONと拒否を確認。旧バケットや既存ユーザーには触れない。
2. 固定メール3件のAuth新規作成について別途承認を得る。本人の管理画面直接入力と各アカウントのUUID照合。パスワード/トークンはチャットやログに載せない。新コホートの既存データが0件であることを確認してから、承認済みUUIDのみサーバー環境に登録する。
3. 認証保護されたブラウザQAまたはCloud Shell版のどちらか一方で一回だけ実HTTP試験。Cloud ShellはVercelを不要にするが、CORS/実iPhone UXの代わりにはならない。結果とEdgeログを照合。
4. 試験後はゲートの有効化を解除する。合成データは対象UUIDを照合して別承認後に削除・残存0確認。
5. 一般運用の写真ゲート設計と実装・実証が終わるまで既存写真移行も正式公開もHOLD。既存旧URLのCDN再取得問題を解決済みと表示しない。

本ターンはDraftのみ。試用DB変更・Function再配置・Auth作成・秘密設定・費用・既存写真操作なし。
