# あとこれ v50 独立監査・実環境試験引継ぎ
状態: 未承認・公開HOLD。監査依頼書であり独立監査の結果ではない。
対象 Draft PR #109、基準 fe3d31afa5df671f32eada76b2702edd27e20a1f と本コミット差分。レビュー実行時にHEADを固定する。

## 確認された事実
- fe3d31af: CI 4/5合格。実PostgreSQL job 138338974102成功、単体/SQL/localhost HTTP成功。Chromium 294合格、1失敗（route.continue already handled）、WebKit 285合格、9 skip、1失敗（write route観測タイムアウト）。前回の詳細画像表示失敗は今回再現されず、変更後テストの通信保留方法が新たな失敗点。原因断定はしない。
- 新修正: アプリfetchを試験内で一時保留し、local commit完了と通信前のphotoPath不在を確認。release後に通常の共有確認を続ける。キューの実行中に新規端末編集があった場合の再scanと再入防止。実PostgreSQLで全体通信予算の最終1枠同時取得を追加。新HEADのCI未確定。
- 既存写真ゲートの合成HTTP 34/34は一般プロトコルの実証ではない。一般プロトコルは未デプロイ。

## 独立レビューの対象
1. SQL: reservation/lifecycle/service/budgetの4 proposal。service_roleへの権限限定、JWT/live session、所属/削除/archived、競合順序、CAS、操作ID、byte hash、purgeの肯定的証拠、旧photoPath注入、tombstoneと未知upload。旧データに作用するtriggerの範囲に特に注意。
2. Edge: supabase/proposals/photo-general-edge-v50.ts と photo-general-v50.mjs。CORS allowlist、body上限とtimeout、真正JPEG decode/再encode、デコード資源制限、実際のDeno SDK型、npm固定依存とlockfile/脆弱性監査、admin adapterの引数偽装、no-storeとHTTP CDN挙動、エラー時の再送。
3. Client: household-core/sync, product-photos。IDBジャーナルを送信前に永続化、scope binding、別世帯切替、同期中の写真変更/再起動、旧outboxの保留、写真キャッシュ消去、共有OFF時にネットワークなし。未送信写真・競合時の明示的な復旧UIを評価。
4. Cost: 予算RPCは許可済み通信に限定、全組織の課金保証ではない。未認証連打、失敗・内部Storage・cleanup、プラットフォーム呼出、月境界、実使用量の監視と停止手順。
5. 試験の独立性: 既存CIの繰り返しではなく、レビュー担当が攻撃的ケースとiPhone画面を独自に再現。P0/P1は全解消、P2は理由を記録して公開判定。報告には固定HEAD、試験入力、観測結果、再現手順、重大度を記載。

## 実環境の安全な試験方針
現状の試用Supabaseに4 proposalをそのまま適用しない。特に既存recordsに対するtriggerは一般ユーザーへ波及する。完全隔離のローカルDB＋Storageの検証を先に行い、実Supabaseで検証する場合は、無料枠内の別プロジェクトまたは固定合成cohort限定の別schema/RPC・bucket・trigger scopeを別レビューで選定する。管理者以外の既存データ/写真/権限に変更なし。試験環境の作成・適用・新Authは個別承認が必要。
試験項目: A/B/C認証、A/B同一byte、C拒否、B除外前後の旧新JWT・同一URL、session消失、read中除外、二重begin、失われた応答の同一操作ID、CAS stale、detach、tombstone、実Storage削除、予算境界、CORS不許可、PWA復帰、iPhone2台の同時操作とローカル保存。終了後アクセス停止、合成データのみ照合し別承認で削除。
旧写真1枚は保全し、旧URLキャッシュの完全無効化と移行は別承認。公開・課金は保留。

## 監査担当への依頼
この文書の記載を鵜呑みにせず、固定コミットと全差分・実際のCIログを確認すること。未検証は未検証とする。実装担当の自己検証、ローカル模擬Storage、実PostgreSQL、実Supabase、物理iPhoneを区別する。独立監査未実施。
