# 試用版 v31: 写真・商品アイコンを拡大

「写真を入れても小さくて分かりづらい」というフィードバックに対応。
ストックは44px固定から内幅いっぱい・高さ96px、ホームは48px、詳細写真は224px、設定プレビューも224pxへ拡大。
3列・メーカー背景・画像上の44pxの＋／−操作範囲を維持する。
画像全体を表示し、保存済み写真の切り抜きやデータ変更はしない。
画像を拡大した分の高さは増えるが、下部の操作行を増やさず商品名・補足は2行を継続する。

ソース: `4a692f733a02bbf78c10221a0f5d112c0c2b650b`
ソースDraft PR #41: https://github.com/rodaisuki1023-alt/ig-public-assets/pull/41
ソースPRはmainへマージしない。公開変更は試用版固定参照・検証値とこの記録のみ。
通常版UI・写真DB・保存済み写真・在庫保存キー・家族Draft #17は変更しない。

Node回帰78件成功。Chromium/WebKitの320・375・390・430pxで画像サイズ・重なり・カード高・保存保護を確認済み。
ブラウザ138件合格。WebKit未対応のSW2件はスキップ（Chromiumで確認済み）。
CI: https://github.com/rodaisuki1023-alt/ig-public-assets/actions/runs/39585038168
初回検証で、標準アイコンの内側のラッパーが小さい幅を保つ箇所を検出。
画像だけでなく `.bf-baby-icon` / `.qa-icon` の枠もカード内幅へ広げて修正した。
公開PR #42: https://github.com/rodaisuki1023-alt/ig-public-assets/pull/42
Pages配信成功: https://github.com/rodaisuki1023-alt/ig-public-assets/actions/runs/39585866333
配信コミット: `273768a489a6d883d9fab565c3dc38477f932e3c`
公開後のSHA-256比較で通常版16/16ファイル不変、試用版35/35ファイルが検証済みビルドと一致。
公開ブラウザでも3列、画像高96px、拡大用CSS v31を確認済み。在庫や写真を変更していない。
実機での見分けやすさは未確認。次はiPhoneで写真付きカードの見やすさを確認する。
