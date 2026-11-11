/* Atokore first-party baby-item identity helpers, not wired to the running app.
   No retailer/API payloads, affiliate links, images, or user identifiers. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AtokoreBabyCatalog = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  const categories = new Set(['diaper', 'milk']);
  const allowedUnits = { diaper: new Set(['枚']), milk: new Set(['g', 'mL', '個', '本']) };

  function norm(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja');
  }

  function positiveInt(value, name) {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(name + ' must be a positive integer');
    return n;
  }

  function required(value, name) {
    const n = norm(value);
    if (!n) throw new TypeError(name + ' is required');
    return n;
  }

  function productKey(input) {
    if (!input || !categories.has(input.category)) throw new TypeError('unknown category');
    const cat = input.category;
    const brand = required(input.brand, 'brand');
    const series = norm(input.series);
    const form = required(input.form, 'form');
    const size = cat === 'diaper' ? required(input.size, 'size') : norm(input.size);
    const stage = cat === 'milk' ? norm(input.stage) : '';
    // Encode parts to prevent delimiter-based collisions.
    return [cat, brand, series, form, size, stage].map(encodeURIComponent).join('|');
  }

  function packageKey(input) {
    const key = productKey(input);
    const unit = String(input.packageUnit ?? '').trim();
    if (!allowedUnits[input.category].has(unit)) throw new TypeError('invalid package unit');
    const qty = positiveInt(input.packageQuantity, 'packageQuantity');
    const bundle = positiveInt(input.bundleCount ?? 1, 'bundleCount');
    return [key, qty, encodeURIComponent(unit), bundle].join('|');
  }

  function canMergeInventory(a, b) {
    return packageKey(a) === packageKey(b);
  }

  function unitPrice({ priceYen, shippingYen, packageQuantity, bundleCount = 1, packageUnit }) {
    if (!Number.isFinite(priceYen) || priceYen < 0 || !Number.isFinite(shippingYen) || shippingYen < 0) return null;
    if (!['枚', 'g', 'mL', '個', '本'].includes(packageUnit)) return null;
    const quantity = Number(packageQuantity), bundles = Number(bundleCount);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(bundles) || bundles < 1) return null;
    const units = quantity * bundles;
    if (!Number.isSafeInteger(units)) return null;
    const unitMultiplier = packageUnit === 'g' ? 100 : 1;
    return {
      priceYenPerUnit: (priceYen + shippingYen) / units * unitMultiplier,
      unitLabel: packageUnit === 'g' ? '100g' : packageUnit,
      totalUnits: units,
    };
  }

  function ownCatalogFields(input) {
    // Explicit allowlist: prevents merchant metadata from silently entering our permanent product master.
    if (!input || typeof input !== 'object') throw new TypeError('object required');
    const fields = ['category','brand','series','form','size','stage','packageQuantity','packageUnit','bundleCount'];
    const clean = {};
    for (const field of fields) if (input[field] !== undefined) clean[field] = input[field];
    packageKey(clean); // Validate before returning.
    return clean;
  }

  return Object.freeze({ productKey, packageKey, canMergeInventory, unitPrice, ownCatalogFields });
});
