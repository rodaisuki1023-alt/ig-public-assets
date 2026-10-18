# あとこれ：データモデル設計 v1（DB未適用）

## 0. 移行前の注意
- 今の atokore-live-v125 は localStorage の atokoreTrialV4（items,buys,routines）を使う。旧データを直接上書きしない。DB移行も未実施。
- この文書は型の契約。将来Supabaseを使う場合は、認証とRLS、監査ログを含む専用のマイグレーションを別PRで設計・適用する。
- 楽天の商品API、アフィリエイト広告ID、API画像、取得価格はこのモデルに一切持たせない。

## 1. 独自商品マスター（first-party database）

| Entity | フィールド例 | 主な制約 |
|---|---|---|
| catalog_products | product_id(UUID), category, brand, series, form, size, stage, display_name, origin | category enum; origin user_input/editorial; brand/form必須; diaper.size必須 |
| catalog_packages | package_id(UUID), product_id(FK), package_quantity, package_unit, bundle_count, jan_optional, package_label | quantity, bundle_count は正の整数; unit適合性; 商品のサイズ変更は別 product_id |
| product_aliases | alias_id, product_id, raw_name, normalized_name, source | OCR誤認は自動確定不可; family/private の別名は家族側で管理 |
| product_photos | photo_id, product_id, origin, storage_key, license_record | origin=user_photo/licensed_asset/first_party_icon; 不明素材を公開しない |

**ベビー用品の識別**
- `product_key = category | normalized_brand | normalized_series | normalized_form | normalized_size | normalized_stage`。
- `package_key = product_key | quantity | unit | bundle_count`。
- ブランド違い・サイズ違い・パンツ/テープ違い・内容量違いを自動統合しない。カナ表記などの同義辞書は人が承認してから適用。
- 商品/包装のIDは安定したUUID。キーの仕様変更時に既存IDを再利用しない。

例：

| product | package | 正しい在庫表示 |
|---|---|---|
| パンパース / さらさらケア / パンツ / M | 60枚×1パック | 未開封2パック、開封中18枚 |
| 同じ製品 | 72枚×1パック | 別の包装SKUとして未開封1パック |
| グーン / プラス / テープ / S | 68枚×1パック（例） | 他メーカー・他サイズと分離 |
| 明治 / ほほえみ / 缶 / 0か月から | 800g×1缶（例） | 缶数＋開封中の残g（概算） |
| 明治 / ほほえみ / キューブ / 0か月から | 1個等の包装情報を明示入力 | 缶とは互換換算しない |

上記枚数・容量は例示であり、メーカーの全商品仕様を確約するものではない。

## 2. 家族情報（private, RLS必須）

| Entity | フィールド例 | 意味 |
|---|---|---|
| households | household_id, display_name, created_at | 家族単位 |
| household_members | household_id, user_id, role, invited_at, joined_at | オーナー/家族、招待による参加。家族コードだけを認証としない |
| household_items | household_item_id, household_id, package_id, custom_name, photo_id, min_quantity, notification_enabled | 家族固有の商品設定 |
| stock_lots | lot_id, household_item_id, package_count_unopened, units_opened_remaining, location, expires_at, version | 包装と開封中を分け、同時編集に対応 |
| inventory_events | event_id, lot_id, delta_packages, delta_units, actor_id, request_id, created_at | イベントの二重適用防止・履歴 |
| shopping_items | shopping_item_id, household_id, package_id, desired_package_count, state, added_by, updated_at | 商品のサイズ/包装を固定 |
| purchase_records | record_id, household_id, package_id, total_jpy, price_origin, purchased_at, retailer_label | ユーザーの実際の購入データ。楽天API価格とは別 |
| household_custom_aliases | household_id, raw_receipt_text, catalog_package_id, confidence, approved_by | 個別レシートの名寄せ学習。世帯外に公開しない |

**RLSの要件**：全CRUDで `household_id` のメンバーシップ確認。所有者の変更と招待の権限は別チェック。個人の写真・履歴・購入価格をpublic schemaに匿名公開しない。秘密鍵はクライアント非公開。

**同時編集**：全状態のlast-write-winsコピーは採用しない。`inventory_events` で原子的に数量を更新し、同じ request_id の再送は一度しか反映しない。競合時の合算とユーザーへの確認を設計する。

## 3. 広告情報（別の公開サービス・公開データのみ）

- 公開記事データ：`public_article`（記事本文、ブランド・サイズに関する独自解説、広告表記、公開日時）
- 短期API表示キャッシュ：`merchant_display_cache`（API商品ID、タイトル、価格、画像URL、affiliateUrl、fetched_at、expires_at、source, public_page_id）
- 公開媒体に匿名閲覧だけを許可。ログイン専用データから広告向けの自動抽出をしない。
- `merchant_display_cache` は楽天APIの規約に従って期限管理。価格と販売可能情報は原則24時間、その他は原則3か月まで。保存期間を理由なく延長しない。
- アフィリエイトリンクは広告媒体の登録後にのみ有効化。規約の改定や広告提携停止時は機能フラグで即停止できる。
- 家族ID・会員ID・レシート本文・子どもの月齢を公開記事のURLクエリに含めない。行動追跡には同意・プライバシー方針が必要。
- 利用規約が認めない場合、商品API機能を破棄して公式に許諾された広告素材のみで運営できるようにする。

## 4. 移行アルゴリズム（実装前の検証仕様）
1. localStorage `atokoreTrialV4` を読み、JSONが不正なら読み取り専用の復旧案内。
2. 旧items全件を変更なしで暗号化バックアップまたは端末ダウンロードへ。ユーザーの同意なく外部送信しない。
3. 旧 `name="オムツ"` など属性不明の商品は `legacy_unresolved` として保持。勝手にパンパースMなどへ変換しない。
4. メーカー・種類・サイズ・容量のわかる商品だけ、レビュー確認後にcatalogに紐付け。
5. 移行済みID対応表を保持。買い物リスト・履歴から古い在庫IDへの参照を確実に新IDへ変換。
6. 互換読み取り期間を設ける。新規スキーマへロールバックした時、ユーザーの書き込みを失わないことをテスト。
7. 旧共有P2Pとクラウドの双方への自動二重書きは避け、段階的に切り替える。

## 5. 開発時の最小検証データ
- パンパース/パンツ/M/60枚 と グーン/パンツ/M/60枚：別商品。
- パンパース/パンツ/M/60枚 と パンパース/テープ/M/60枚：別商品。
- パンパース/パンツ/M/60枚 と パンパース/パンツ/M/72枚：同product別package。
- ほほえみ/粉ミルク缶/800g と ほほえみ/液体ミルク/200mL：別商品。100g単価にmL価格を混ぜない。
- レシートOCRに商品名だけあるケース：候補選択を求め、サイズ不明の在庫を上書きしない。
- 複数人同時に『−1』：在庫が2→0（片方の操作が消失しない）。
- 画像の権利が未確認のケース：汎用アイコンのみ表示。
- 楽天APIが停止/規約変更しても、無料の在庫・買い物機能と有料の独自分析は使い続けられる。

## 6. 依存禁止の契約
`first_party_catalog` は `affiliate` モジュールをimportしない。`household` は `merchant_display_cache` の取得を必須にしない。`public_affiliate` は `household` のprivateデータへのDB権限を持たない。この境界の破りをCI・コードレビューで検出する。