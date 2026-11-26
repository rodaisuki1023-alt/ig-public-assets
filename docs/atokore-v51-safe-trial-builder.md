# あとこれ v51：安全な試用版のビルド（Work向けの手順）

| 項目 | 内容 |
|---|---|
| ビルド | `ATOKORE_BUILD_SHA=<固定するコミット> python3 -I scripts/atokore/build-safe-trial.py atokore-live-v125 <出力先> 19` |
| 確認 | `node scripts/atokore/check-safe-trial.cjs <配信ルート> <配信ルートから見たパス>`（320／393／430px） |
| 配信 | **別の承認が必要です**。認証付き、noindex、Supabaseに接続しない環境に限ります |

## どこから配信しても写真が使えます（Work第5回の指摘への対応）
- 以前は、写真の部品が配信パス（`/preview-baby-v19/`）を見て起動するかどうかを決めていました。そのため、READMEに書いた標準パスで配信すると、写真が使えませんでした。
- 今は、**ビルド時に入る印**（`#atkBuildInfo` の `data-build="trial-v19-<sha>"`）で決めます。配信パスには左右されません。
- 本番用のコピー（印が `__ATOKORE_BUILD__` のまま）では、写真は使えないままです。
- CIでは、`/some/other/review/` という普段使わないパスから配信して、次の流れを毎回確認しています。
  - ストック → 商品 → 写真を設定 → カウンター → 試用表示
- 試用版ごとに、写真DB・保存領域・Service Workerのキャッシュを分けています（`atokoreSafeTrial…` ／ `atokore-safe-trial-*`）。そのため、同じオリジンにほかの試用版があっても混ざりません。

## 安全のために必ず入れていること
- 接続設定は `null` です。SupabaseのURL・キーは入れず、家族共有・クラウド写真・ログインはOFFです。
- OCRは表示しません。
- 外部への通信は禁止しています（CSPの `connect-src 'self'`）。noindex の設定と、配信時のヘッダー（`_headers`・`vercel.json`：X-Robots-Tag、CSP、`frame-ancestors 'none'`）を入れています。
- `SAFE_TRIAL_MANIFEST.json` に、ビルド元のコミットと全ファイルのSHA-256を記録します。
- 接続設定・鍵のような文字列・古い保存名・OCRをONにする設定が残っていると、ビルドを中止します。

## 固定成果物の扱い
- Workが試用している `c87d83f` の配信用ZIPと環境は、このブランチから変更しません。
- 新しいHEADで試用版を作る場合は、別のZIP・別の配信先とし、別の承認を受けてください。
