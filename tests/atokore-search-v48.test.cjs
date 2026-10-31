// W2 items 5 and 9: search normalisation, AND words, sizes kept apart, and "もしかして" suggestions.
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../atokore-live-v125/search-v48.js');
const names=['パンパース さらさらケア おむつ テープ M','パンパース さらさらケア おむつ テープ L','パンパース さらさらケア おむつ パンツ M',
 'メリーズ ファーストプレミアム テープ S','キユーピー ベビーフード 7ヶ月','キユーピー ベビーフード 9ヶ月','牛乳','ＢＯＸティッシュ 5箱','ｵｼﾘﾌｷ 詰替','ベビーローション ML'];
const find=q=>names.filter(n=>S.matches(n,q));
test('kana, width and case differences find the same product; the shown name is untouched',()=>{
 assert.deepEqual(find('ぱんぱーす てーぷ m'),['パンパース さらさらケア おむつ テープ M']);
 assert.deepEqual(find('ﾊﾟﾝﾊﾟｰｽ ﾃｰﾌﾟ Ｍ'),['パンパース さらさらケア おむつ テープ M']);
 assert.deepEqual(find('box てぃっしゅ'),['ＢＯＸティッシュ 5箱']);
 assert.deepEqual(find('おしりふき'),['ｵｼﾘﾌｷ 詰替']);
 assert.deepEqual(find('Pampers テープ L'),['パンパース さらさらケア おむつ テープ L']);
});
test('spaces of any width are ignored at the ends and between words; several words must all match',()=>{
 assert.deepEqual(find('　パンパース　　M '),['パンパース さらさらケア おむつ テープ M','パンパース さらさらケア おむつ パンツ M']);
 assert.deepEqual(find('パンパース パンツ'),['パンパース さらさらケア おむつ パンツ M']);
 assert.deepEqual(find('パンパース 牛乳'),[]);
 assert.equal(S.matches('牛乳','   '),true,'an empty search shows everything');
});
test('sizes, tape/pants and months stay apart',()=>{
 assert.ok(!find('パンパース M').some(n=>n.endsWith(' L')),'M never finds L');
 assert.ok(!find('M').includes('ベビーローション ML'),'M is not part of ML');
 assert.ok(!find('M').includes('メリーズ ファーストプレミアム テープ S'),'M is not the m of メリーズ (katakana) or "mamy"');
 assert.deepEqual(find('テープ M'),['パンパース さらさらケア おむつ テープ M']);
 assert.deepEqual(find('キユーピー 7ヶ月'),['キユーピー ベビーフード 7ヶ月']);
});
test('confirmed brand spellings are the same: キユーピー / キューピー',()=>{
 assert.deepEqual(find('キューピー 9ヶ月'),['キユーピー ベビーフード 9ヶ月']);
 assert.deepEqual(find('きゅーぴー'),['キユーピー ベビーフード 7ヶ月','キユーピー ベビーフード 9ヶ月']);
});
test('long vowels and small kana are not folded by search, but are offered as suggestions (max 3)',()=>{
 assert.deepEqual(find('ぱんぱす'),[],'search itself does not guess');
 assert.deepEqual(S.suggestions('ぱんぱす',names),['パンパース']);
 assert.deepEqual(S.suggestions('てぃしゅ',names),['ＢＯＸティッシュ'].map(x=>x.normalize('NFKC')));
 assert.ok(S.suggestions('おむ',names).length<=3);
 assert.deepEqual(S.suggestions('zzzz',names),[]);
 assert.deepEqual(S.suggestions('ぱ',names),[],'one character is too short to guess');
});

test('month searches do not match longer numbers and accept common month spellings',()=>{
 for(const q of ['7ヶ月','7か月','７カ月','7ヵ月','7箇月']) {
  assert.equal(S.matches('離乳食 7ヶ月頃から',q),true,q);
  for(const n of ['17ヶ月','27ヶ月','107ヶ月'])assert.equal(S.matches('離乳食 '+n,q),false,q+' vs '+n);
 }
 assert.equal(S.matches('離乳食 17か月','17ヶ月'),true);
 assert.equal(S.matches('離乳食 17か月','7ヶ月'),false); // Full-size ケ (common on packaging) is the same spelling.
 assert.equal(S.matches('キユーピー にんじん 7ケ月頃から','7ヶ月'),true);
 assert.equal(S.matches('キユーピー 7ヶ月','7ケ月'),true);
 assert.equal(S.matches('キユーピー 17ケ月','7ケ月'),false);
 // Half-typed month ages already keep the digit boundary.
 for(const q of ['7ヶ','7か','7ケ','7ヵ']){assert.equal(S.matches('離乳食 7ヵ月',q),true,q);assert.equal(S.matches('離乳食 17ヵ月',q),false,q)}
 // Ranges and ages written with years still match the month itself.
 assert.equal(S.matches('5〜7ヶ月頃','7ヶ月'),true);
 assert.equal(S.matches('1歳4ヶ月','4ヶ月'),true);
 // Plain numbers, sizes, brands and several words are unchanged.
 assert.equal(S.matches('離乳食 17ヶ月','7'),true);
 assert.equal(S.matches('パンパース テープ M','ぱんぱーす m'),true);
 assert.equal(S.matches('キユーピー 7ヶ月 にんじん','キューピー 7か月 にんじん'),true);
 assert.equal(S.matches('キユーピー 17ヶ月 にんじん','キューピー 7か月 にんじん'),false);
 assert.equal(S.norm('７カ月 7ケ月 7ヵ月 7箇月 7か月'),'7ゖ月 7ゖ月 7ゖ月 7ゖ月 7ゖ月');
});
