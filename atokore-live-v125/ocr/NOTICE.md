# レシート読み取り用の部品（端末内OCR）

このフォルダのファイルは、レシートの写真を**端末の中で**読み取るための部品です。写真は外部に送りません。
読み込みは `../receipt-ppocr-v49.js` が行います。初回だけダウンロードし（最大約38MB、非圧縮の場合）、Service Worker が別のキャッシュに保持します。
各ファイルは、ダウンロード後に下の SHA-256 で照合します。一致しないものは取り直し、2回目も一致しなければ読み取りを止めます。

## 文字認識モデル（PaddleOCR PP-OCRv6、Apache License 2.0）

| ファイル | 内容 | 元のファイル | SHA-256 |
|---|---|---|---|
| `ppocrv6-det-small-int8.onnx` | 文字の位置を見つけるモデル | RapidOCR 3.10.0 同梱 `PP-OCRv6_det_small.onnx`（SHA-256 `090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f`） | `d1de8192b9c8c0e68a4c341605604b76b7c18d15b0e6167624f49e1e484f7cdb` |
| `ppocrv6-rec-small.onnx` | 文字を読むモデル（日本語を含む多言語） | RapidOCR 3.10.0 同梱 `PP-OCRv6_rec_small.onnx`（変更なし） | `6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884` |
| `ppocrv6-dict.txt` | 文字の一覧 | 上のモデルのメタデータ `character` を書き出したもの | `f7aa897ca828a4c7c9e2739c30f9161a33306d532f020bcdb91dcfb664a5507e` |

- **変更の表示（Apache License 2.0 第4条）：** `ppocrv6-det-small-int8.onnx` は、元のモデルをあとこれの開発者が onnxruntime の `quantize_dynamic(weight_type=QuantType.QUInt8)` で8bit量子化した、改変済みのファイルです。他の2ファイルは変更していません（辞書はモデル内の文字表をそのまま書き出したもの）。
- **著作権：**
  - モデルの重み：Baidu／PaddleOCR の権利者（https://github.com/PaddlePaddle/PaddleOCR）
  - ONNX形式への変換：RapidOCR Authors（https://github.com/RapidAI/RapidOCR）
  - どちらも Apache License 2.0 です。
- **ライセンス文書（このフォルダに同梱）：**
  - `licenses/LICENSE-Apache-2.0-PaddleOCR.txt`（PaddleOCR リポジトリの LICENSE 全文）
  - `licenses/LICENSE-RapidOCR.txt`
  - `licenses/RapidOCR-MODEL_LICENSES.md`：RapidOCR のモデルの帰属表示。再配布の条件（ライセンス写しの同梱・改変の表示・帰属の保持）はここに従っています。
- PaddleOCR・RapidOCR のモデルについて、上記以外の NOTICE ファイルは確認されていません（`RapidOCR-MODEL_LICENSES.md` 第7節）。
- PaddlePaddle・PaddleOCR・RapidOCR の名称は、出所の説明のためにだけ記載しています。これらの組織が推奨・提携しているという意味ではありません。

## 実行部品（onnxruntime-web 1.30.0、MIT License、Microsoft）

| ファイル | SHA-256 |
|---|---|
| `ort.wasm.min.js` | `faece07e84faa9001f5104bbe4e5c70861d06cb2376a0dea1fa0ad33a67adc81` |
| `ort-wasm-simd-threaded.mjs` | `e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b` |
| `ort-wasm-simd-threaded.wasm` | `3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2` |

- npm パッケージ `onnxruntime-web@1.30.0` の `dist/` から、変更せずに複製しました。3ファイルとも jsDelivr が公開している同版のハッシュと一致することを確認済みです（2026-11-01）。
- **ライセンス文書：**
  - `licenses/LICENSE-onnxruntime.txt`
  - `licenses/ThirdPartyNotices-onnxruntime.txt`
  - どちらも microsoft/onnxruntime v1.30.0 のリポジトリから取得しました。
