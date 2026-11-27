#!/usr/bin/env node
// Atokore v51 第12回: JS bundle PROTOTYPE (isolated; owner approval 2026-11-28 for local trial and speed
// comparison only). It never changes the sources or the live delivery: it reads a built site directory and
// writes a separate one.
//
//   node scripts/atokore/bundle-proto.cjs <siteDir> <outDir> --mode=chunks|single|inline [--acorn=<path>]
//
// Modes (all keep the CSS, the inline scripts' code and the order in which every script runs):
//   chunks  each run of consecutive external scripts (not separated by an inline script) becomes one file;
//           inline scripts stay where they are. Order, the OCR loader (document.write before receipt.js) and
//           head/body timing are unchanged. 4 requests instead of 49.
//   single  one file at the first body script: the head scripts, every inline body script and every external
//           script, in document order. The head scripts then run after the body markup is parsed (later than
//           now). OCR on is not supported (its loader writes scripts that would run after the file): the page
//           falls back to the unbundled copy then.
//   inline  every external script's code is written into the HTML at its place (no script requests at all).
//
// What concatenation changes, and how it is handled:
//   - Each file used to be its own Script: a throw at its top level stopped only that file. In a chunk, a
//     file whose top level has no declarations (an IIFE etc.) is wrapped in try/catch, so a throw still stops
//     only that file (it is re-thrown asynchronously, so window.onerror / pageerror still see it). Files with
//     top-level declarations are not wrapped (a block would change them); they are listed in the report.
//   - A program-level "use strict" would apply to the rest of a chunk: refused (the build stops).
//   - Two files declaring the same top-level let/const/class: refused (the build stops).
//   - document.currentScript: refused if any file uses it.
//   Analysis needs acorn (an existing local copy; path via --acorn or ACORN). Without it the build refuses.
// Cache and fallback:
//   - Chunk names carry a content hash; service-worker.js precaches them and its CACHE_VERSION gets the hash.
//   - The unbundled page is kept as index-src.html. If a chunk fails to load, the page goes there once.
// Output: bundle-map.json (chunk -> files, line ranges, sha256) next to index.html.
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

const [, , siteDir, outDir, ...flags] = process.argv;
const opt = Object.fromEntries(flags.map(f => f.replace(/^--/, '').split('=')));
const mode = opt.mode || 'chunks';
if (!siteDir || !outDir || !['chunks', 'single', 'inline'].includes(mode)) {
  console.error('usage: bundle-proto.cjs <siteDir> <outDir> --mode=chunks|single|inline [--acorn=<path>]'); process.exit(2);
}
const acornPath = opt.acorn || process.env.ACORN;
let acorn = null;
try { acorn = require(acornPath || 'acorn'); } catch (_) { acorn = null; }
if (!acorn) { console.error('acorn is required for the safety analysis (pass --acorn=<path to node_modules/acorn>)'); process.exit(3); }

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(siteDir, outDir, { recursive: true });
const htmlPath = path.join(outDir, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
fs.writeFileSync(path.join(outDir, 'index-src.html'), html);

// ---- parse the script tags in document order --------------------------------------------------------
const tagRe = /<script([^>]*)>([\s\S]*?)<\/script>/g;
const scripts = [];
for (let m; (m = tagRe.exec(html));) {
  const src = /\ssrc="([^"]+)"/.exec(m[1]);
  scripts.push({ start: m.index, end: tagRe.lastIndex, attrs: m[1], src: src ? src[1] : null, code: src ? null : m[2] });
}
const bodyAt = html.indexOf('<body');
const fileOf = src => path.join(outDir, src.replace(/^\.\//, '').replace(/[?#].*$/, ''));
for (const s of scripts) if (s.src) { s.file = src2rel(s.src); s.code = fs.readFileSync(fileOf(s.src), 'utf8'); }
function src2rel(src) { return src.replace(/^\.\//, '').replace(/[?#].*$/, ''); }

// ---- safety analysis ------------------------------------------------------------------------------------
const report = { mode, files: [], refused: [] };
const lexical = new Map();
for (const s of scripts) {
  let ast;
  try { ast = acorn.parse(s.code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }); }
  catch (e) { report.refused.push(`${s.file || 'inline@' + s.start}: does not parse (${e.message})`); continue; }
  const directives = ast.body.filter(n => n.type === 'ExpressionStatement' && n.directive).map(n => n.directive);
  const decls = [];
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') decls.push({ kind: n.type === 'ClassDeclaration' ? 'class' : 'function', name: n.id.name });
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) for (const id of names(d.id)) decls.push({ kind: n.kind, name: id });
  }
  s.directives = directives; s.decls = decls; s.wrappable = !decls.length && !directives.length;
  if (/document\.currentScript/.test(s.code)) report.refused.push(`${s.file || 'inline'}: uses document.currentScript`);
  if (s.src && directives.includes('use strict')) report.refused.push(`${s.file}: program-level "use strict" would apply to the rest of a chunk`);
  for (const d of decls) if (d.kind !== 'var' && d.kind !== 'function') {
    if (lexical.has(d.name)) report.refused.push(`top-level ${d.kind} ${d.name} declared in ${lexical.get(d.name)} and ${s.file || 'inline'}`);
    lexical.set(d.name, s.file || 'inline@' + s.start);
  }
  report.files.push({ file: s.file || `inline@${s.start}`, bytes: Buffer.byteLength(s.code), directives, topLevel: decls.map(d => d.kind + ' ' + d.name), wrappedInTryCatch: !!s.src && s.wrappable });
}
function names(p) { if (!p) return []; if (p.type === 'Identifier') return [p.name]; if (p.type === 'ObjectPattern') return p.properties.flatMap(q => names(q.value || q.argument)); if (p.type === 'ArrayPattern') return p.elements.flatMap(names); if (p.type === 'AssignmentPattern') return names(p.left); if (p.type === 'RestElement') return names(p.argument); return []; }
if (report.refused.length) { fs.writeFileSync(path.join(outDir, 'bundle-report.json'), JSON.stringify(report, null, 1)); console.error('REFUSED:\n' + report.refused.join('\n')); process.exit(4); }

// ---- build -----------------------------------------------------------------------------------------------
const escapeInline = code => code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
function piece(s) {
  const head = `/* ---- ${s.file || 'inline'} ---- */\n`;
  if (!s.src || !s.wrappable) return head + s.code + '\n;\n';
  // A throw at this file's top level stops only this file, as when it was its own <script>.
  return head + 'try{\n' + s.code + '\n}catch(__atkBundleError){setTimeout(function(){throw __atkBundleError},0)}\n;\n';
}
const map = { mode, chunks: [] };
const fallback = "(function(){try{if(sessionStorage.getItem('atkBundleFallback'))return;sessionStorage.setItem('atkBundleFallback','1')}catch(_){}location.replace('./index-src.html'+location.search+location.hash)})()";
function writeChunk(list, n) {
  let code = '', line = 1; const files = [];
  for (const s of list) {
    const p = piece(s); const lines = p.split('\n').length - 1;
    files.push({ file: s.file || 'inline', from: line, to: line + lines - 1, sha256: sha(s.code) }); line += lines; code += p;
  }
  const h = sha(code).slice(0, 10), name = `atk-chunk-${n}.${h}.js`;
  fs.writeFileSync(path.join(outDir, name), code);
  map.chunks.push({ name, bytes: Buffer.byteLength(code), files });
  return `<script src="./${name}" onerror="${fallback.replace(/"/g, '&quot;')}"></script>`;
}
let out = '';
if (mode === 'inline') {
  let at = 0;
  for (const s of scripts) { out += html.slice(at, s.start); at = s.end; out += s.src ? `<script>${escapeInline(piece(s))}</script>` : html.slice(s.start, s.end); }
  out += html.slice(at);
} else if (mode === 'chunks') {
  // External scripts separated only by whitespace/CSS links form one run. The links met inside a run are
  // written right after its chunk (their relative order, and so the cascade, is unchanged).
  let at = 0, run = [], gapAfter = '', n = 0;
  const flush = () => { if (run.length) { out += writeChunk(run, ++n) + gapAfter; run = []; gapAfter = ''; } };
  for (const s of scripts) {
    const gap = html.slice(at, s.start);
    if (s.src && run.length && !/\S/.test(gap.replace(/<link[^>]*>/g, ''))) gapAfter += gap;
    else { flush(); out += gap; }
    if (s.src) run.push(s); else out += html.slice(s.start, s.end);
    at = s.end;
  }
  flush(); out += html.slice(at);
} else {
  // single: one file at the first body script; head scripts and inline body scripts move into it.
  const firstBody = scripts.find(s => s.start > bodyAt);
  const moved = scripts.filter(s => s.src || s.start > bodyAt);
  const ocrLoader = s => !s.src && /ATOKORE_RECEIPT_EXPERIMENTAL===true\)document\.write/.test(s.code);
  const list = moved.map(s => ocrLoader(s) ? { ...s, code: "if(window.ATOKORE_RECEIPT_EXPERIMENTAL===true)" + fallback + ";", wrappable: false } : s);
  let at = 0;
  for (const s of scripts) {
    if (!moved.includes(s)) continue;
    out += html.slice(at, s.start); at = s.end;
    if (s === firstBody) out += writeChunk(list, 1);
  }
  out += html.slice(at);
}
fs.writeFileSync(htmlPath, out);

// ---- service worker: precache the chunks, new cache version ---------------------------------------------
const swPath = path.join(outDir, 'service-worker.js');
if (fs.existsSync(swPath) && map.chunks.length) {
  let sw = fs.readFileSync(swPath, 'utf8');
  const tag = sha(map.chunks.map(c => c.name).join(',')).slice(0, 8);
  sw = sw.replace(/const CACHE_VERSION = '([^']+)';/, (_, v) => `const CACHE_VERSION = '${v}-${mode}-${tag}';`);
  sw = sw.replace(/(const APP_SHELL\s*=\s*\[)/, `$1\n  ${map.chunks.map(c => `'./${c.name}',`).join('\n  ')}\n  './index-src.html',`);
  fs.writeFileSync(swPath, sw);
}
map.report = report.files;
fs.writeFileSync(path.join(outDir, 'bundle-map.json'), JSON.stringify(map, null, 1));
const extBefore = scripts.filter(s => s.src).length, scriptReqAfter = mode === 'inline' ? 0 : map.chunks.length;
console.log(JSON.stringify({ mode, externalScriptsBefore: extBefore, scriptRequestsAfter: scriptReqAfter, chunks: map.chunks.map(c => ({ name: c.name, files: c.files.length, bytes: c.bytes })), unwrapped: report.files.filter(f => f.topLevel.length && !/^inline/.test(f.file)).map(f => f.file + ' [' + f.topLevel.join(', ') + ']') }, null, 1));
