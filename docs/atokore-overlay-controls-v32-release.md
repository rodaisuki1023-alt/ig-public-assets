# 試用版 v32: ＋／−を画像に重ねてカードを短縮

大きな写真・アイコンはそのままに、＋／−が画像に重なってもよいのでスクロールを減らしたい、という依頼への調整。
ボタン用の上余白を38pxから4pxへ減らし、カードを34px短縮する。
3列、画像高96px、左右上の44pxタップ範囲、メーカー背景、商品名・補足の2行表示を維持する。

ソース: `ad5e75ff9b1854cfa1401e0c4ae826ea8ef4c286`
ソースDraft PR #43: https://github.com/rodaisuki1023-alt/ig-public-assets/pull/43
ソースPRはmainにマージしない。公開変更は試用版の固定参照・検証値とこの記録のみ。
通常版UI、在庫保存キー、写真DB、保存済み写真、家族Draft #17に変更なし。

Node回帰78件成功。Chromium/WebKitの320・375・390・430pxでブラウザ138件成功、WebKit未対応SWの2件はスキップ（Chromiumで確認済み）。
画像高96px、画像に重なる44pxボタン、カード高246px以内、数量操作、写真保存を確認済み。
CI: https://github.com/rodaisuki1023-alt/ig-public-assets/actions/runs/39588717577
320px Chromium・390px WebKitの標準アイコンと写真付きカードのスクリーンショットを目視確認済み。
公開PR #44: https://github.com/rodaisuki1023-alt/ig-public-assets/pull/44
Pages配信成功: https://github.com/rodaisuki1023-alt/ig-public-assets/actions/runs/39589648220
配信コミット: `f5b6704f01e28c6ddf877700b1848009f903e253`
公開後のSHA-256比較で通常版16/16ファイル不変、試用版35/35ファイルが検証済みビルドと一致。
実機iPhoneの操作感は未確認。次はスクロール量と重ねたボタンの押しやすさを確認する。
