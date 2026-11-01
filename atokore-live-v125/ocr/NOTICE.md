# レシート読み取り用モデル（端末内OCR）

このフォルダのファイルは、レシートの写真を**端末の中で**読み取るためのモデルです。写真は外部に送りません。
読み込みは `../receipt-ppocr-v49.js` が行います（初回のみダウンロードし、以後はブラウザのキャッシュから使います）。

| ファイル | 内容 | 元のファイル | SHA-256 |
|---|---|---|---|
| `ppocrv6-det-small-int8.onnx` | 文字の位置を見つけるモデル（8bit量子化） | RapidOCR 3.10.0 同梱 `PP-OCRv6_det_small.onnx`（SHA-256 `090f04ab…1ff94f`） | `d1de8192b9c8c0e68a4c341605604b76b7c18d15b0e6167624f49e1e484f7cdb` |
| `ppocrv6-rec-small.onnx` | 文字を読むモデル（日本語を含む多言語） | RapidOCR 3.10.0 同梱 `PP-OCRv6_rec_small.onnx`（変更なし） | `6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884` |
| `ppocrv6-dict.txt` | 文字の一覧（上のモデルの埋め込み文字表を書き出したもの） | 同モデルのメタデータ `character` | `f7aa897ca828a4c7c9e2739c30f9161a33306d532f020bcdb91dcfb664a5507e` |

- 量子化の手順（位置検出モデルのみ）：onnxruntime の `quantize_dynamic(..., weight_type=QuantType.QUInt8)`。
  文字を読むモデルも量子化すると、実画像で読める行が大きく減ったため（91%→62%）、元のまま使っています（`docs/atokore-receipt-quality-v49.md`）。
- PP-OCRv6 モデル：PaddlePaddle / PaddleOCR、Apache License 2.0。ONNX 形式への変換：RapidAI / RapidOCR、Apache License 2.0。
- 実行環境：onnxruntime-web 1.30.0（Microsoft、MIT License）を jsDelivr から版を固定して読み込みます。

Apache License 2.0：https://www.apache.org/licenses/LICENSE-2.0
