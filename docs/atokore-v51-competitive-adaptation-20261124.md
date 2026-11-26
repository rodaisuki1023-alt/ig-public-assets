# 競合の良い点から差別化へ（2026-11-24）
公開説明からの調査。実機で競合を利用した結果ではない。
- 園の持ち物チェックリスト https://apps.apple.com/jp/app/id6788250608 : 子ども・曜日・カレンダー・複製。あとこれは複数児の必要品を同一単位/商品IDに限定して合算し、不足→買い物→補充へ。
- 買っとく？ https://apps.apple.com/jp/app/id6782334148 : 担当・履歴・ありがとう。担当通知と完了後の任意の感謝（催促や競争ランキングは設けない）。
- カイモノ https://apps.apple.com/jp/app/id6824344633 : 招待リンクでブラウザ参加。既存の家族招待を活かし、インストール強制なし。
- OurList https://play.google.com/store/apps/details?hl=ja&id=com.zaparo.ourlist : 定番を再登録、追加通知。準備テンプレと不足数量を連動。
- 共有 買い物リスト https://apps.apple.com/jp/app/id6799037640 : 担当と通知。自分/相手/全員フィルタを簡単に切り替える。
- Apple https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers : iOS 16.4以降のホーム画面Webアプリ、ユーザー操作と明示許可、サーバーに購読情報。Developer Program加入はWeb Push自体には不要。
## 試作
proposals/atokore-family-prep-demo-v51.html は合成データ専用、noindex、既存アプリとは別、永続保存・ネットワーク・実通知なし。ローカルHTTPで .cjs をJavaScript MIMEとして配信する。準備チェック、子ども切替、必要量と不足、購入予定、担当フィルタ、通知の文例、補充、ありがとうの流れを確認する。既存の買い物行は長くしない。将来の通知・購入・感謝イベントはサーバーの原子的な状態変更、権限、冪等性、送信前再照合を要する。試作のクライアント内処理は本番の承認処理には使わない。
採用判断: 同等のシナリオで時間・操作数・誤操作・7日継続・支払意向を計測。既存競合より便利だと断定しない。
## 検証
キャッシュ更新のテスト期待値を50.8に追随。写真共有のChromiumコンテキスト消失は未解決。無条件リトライで隠さない。公開ゲートは維持。