# 試用版 v29: ストックを3列・短いカードへ

ユーザーの実機フィードバック「大きすぎる」「＋／−を画像の左右上」「3列」に対応。
画像の左上に−、右上に＋を配置。タップ範囲は44pxを維持。
メーカー別背景とくまの商品画像を維持し、数量は画像の下へまとめた。
商品名・補足は最大2行、詳細画面では全文を確認できる。

ソース: `157f4ea738caa3c44a07400f91b09c407f4028a3`
ソースPR: https://github.com/rodaisuki1023-alt/ig-public-assets/pull/37
ソースPRはDraftのまま。通常版ソースを含むためmainへはマージしない。

公開変更は、この記録と `.github/workflows/atokore-pages.yml` の試用版参照・検証値のみ。
通常版UI・保存データのキー・試用版家族同期無効化・既存版とのSW分離は維持。
家族共有PR #17は対象外。

ローカルNode回帰75件と従来5スクリプト、分離ビルド・公開時assertionは成功。
Chromium / WebKit、320 / 375 / 390 / 430pxのテストとスクリーンショットを確認済み。
ブラウザ124件合格、WebKitで対応していないSWテスト2件はスキップ（Chromiumでは検証済み）。
CI: https://github.com/rodaisuki1023-alt/ig-public-assets/actions/runs/39560498762
3列・カード高240px以下、左右上の44px操作範囲、数量増減、詳細、編集、再読込、複数選択を確認。
初回は−操作による既存の消費回数更新をテスト期待値に含めていなかったため失敗し、テストを修正して再実行成功。
公開PR #38: https://github.com/rodaisuki1023-alt/ig-public-assets/pull/38
Pages配信成功: https://github.com/rodaisuki1023-alt/ig-public-assets/actions/runs/39561269429
配信コミット: `b111a01ec586dd2f03f367bc4454dcabf24f66ea`
公開後のSHA-256比較は、通常版16/16ファイルが変更前と同一、試用版33/33ファイルが確認済みビルドと同一。
公開画面でも3列、baby-flow v29、左右上の44×44pxボタン、残り数量を読み取り確認済み。
公開確認では実際の在庫を変更していない。

実機iPhoneの操作感とSafariツールバー開閉時の見え方は未確認。
次は実機で3列の読みやすさと＋／−の押しやすさを確認する。
