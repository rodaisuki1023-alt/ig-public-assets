# 試用版 v30: 利用者の写真を商品アイコンに

商品詳細の「写真を設定」から撮影・選択、プレビュー後に保存。
ホーム・ストック・詳細に反映し、元のアイコンにも戻せる。
メーカー背景、3列カード、左右上の44px在庫操作は維持。

写真は試用版専用IndexedDBのみに保存し、外部送信・公開はしない。
JPEG等の識別子を確認し256px/80KB以下のJPEGへ再変換、元メタデータを持ち込まない。
在庫localStorageは画像保存で変更しない。写真保存失敗は旧写真・在庫を維持。
写真は既存JSONバックアップと家族共有の対象外。サイトデータ削除で消える制約を画面に表示。
HEICはブラウザで読める場合のみ。実機iPhoneの写真選択・HEICは未確認。

ソース: `82ebb8a5aeff039610a1a1b8a537b49ae404dafe`
ソースDraft PR #39: https://github.com/rodaisuki1023-alt/ig-public-assets/pull/39
ソースPRはmainへマージせず、公開変更はこの記録と試用版固定参照・検証値のみ。
通常版UI・在庫保存キー・家族Draft #17は対象外。

ローカル: Node回帰78件＋既存5スクリプト成功。分離ビルド成功。
初回のWebKit検証で写真の保存が失敗したため、IndexedDBにはBlobを直接保存せず、圧縮JPEGのバイト配列を保存する形式に修正。
Chromium / WebKitの320・375・390・430pxで、画像保存・中止・再読込・失敗時保護・アイコン復帰・商品分離を確認済み。
ブラウザ138件合格、WebKit未対応のSW2件はスキップ（Chromiumでは確認済み）。
CI: https://github.com/rodaisuki1023-alt/ig-public-assets/actions/runs/39574095863
権利確認の詳細はソースPRのdocs/atokore-product-photos-v30.md。
自分で撮影／使用許可のある写真を私的な在庫識別に使う範囲で実装。一般公開や無断転載の許諾を保証しない。
日本弁理士会関西会の説明では、商標権侵害は業としての使用が対象であり、家庭内使用は対象外。
https://www.kjpaa.jp/qa/46505.html
文化庁は私的使用とSNS等への一般公開を区別している。写真やパッケージ中の作品の著作権は商標と別に考える。
https://www.bunka.go.jp/seisaku/chosakuken/taisetsu/index.html

次は実機iPhoneで撮影・写真選択、再読込後の写真表示、元のアイコンへの復帰を確認する。
