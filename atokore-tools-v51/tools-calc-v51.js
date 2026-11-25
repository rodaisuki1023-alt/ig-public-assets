/* Atokore free tools (draft, not published): diaper days left and monthly use.
 * Pure arithmetic on the visitor's own numbers. No defaults by age, no claims about typical use. */
(function(root){
'use strict';
const n=(v,{min=0,max=99999,int=false}={})=>{const x=Number(v);return v!==''&&v!=null&&Number.isFinite(x)&&x>=min&&x<=max&&(!int||Number.isInteger(x))?x:null};
/** Days the diapers last: (bags × per bag + loose) ÷ per day. */
function daysLeft({bags,perBag,loose=0,perDay}){
 const b=n(bags,{max:999,int:true}),p=n(perBag,{min:1,max:999,int:true}),l=n(loose||0,{max:9999,int:true}),d=n(perDay,{min:0.5,max:99});
 if(b===null)return {error:'袋の数を0以上の整数で入力してください'};
 if(p===null)return {error:'1袋の枚数を1以上の整数で入力してください'};
 if(l===null)return {error:'ばらの枚数を0以上の整数で入力してください'};
 if(d===null)return {error:'1日に使う枚数を0.5〜99で入力してください'};
 const total=b*p+l;
 return {total,days:Math.floor(total/d)};
}
/** Monthly use: per day × days in the month, and how many bags that is (rounded up). */
function monthly({perDay,perBag,days=30}){
 const d=n(perDay,{min:0.5,max:99}),p=n(perBag,{min:1,max:999,int:true}),m=n(days,{min:28,max:31,int:true});
 if(d===null)return {error:'1日に使う枚数を0.5〜99で入力してください'};
 if(p===null)return {error:'1袋の枚数を1以上の整数で入力してください'};
 if(m===null)return {error:'日数は28〜31で入力してください'};
 const sheets=Math.ceil(d*m);
 return {sheets,bags:Math.ceil(sheets/p),days:m};
}
/** Powdered milk: days a can lasts = can grams ÷ (grams per feed × feeds per day). */
function milkDays({canGrams,cans=1,perFeedGrams,feedsPerDay}){
 const g=n(canGrams,{min:1,max:5000}),c=n(cans,{min:1,max:20,int:true}),f=n(perFeedGrams,{min:1,max:300}),k=n(feedsPerDay,{min:1,max:20,int:true});
 if(g===null)return {error:'1缶の内容量（g）をパッケージの表示どおりに入力してください'};
 if(c===null)return {error:'缶の数を1〜20で入力してください'};
 if(f===null)return {error:'1回に使う粉の量（g）を入力してください'};
 if(k===null)return {error:'1日の回数を1〜20で入力してください'};
 const perDay=f*k,total=g*c;
 return {perDay:Math.round(perDay*10)/10,days:Math.floor(total/perDay),total};
}
/** Date the stock runs out, from a start date and whole days. */
function runOutDate(start,days){
 const t=typeof start==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(start)?Date.parse(start+'T00:00:00Z'):NaN;
 // Date.parse rolls 2026-02-30 over to March: accept only a date that reads back the same.
 if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==start||!Number.isSafeInteger(days)||days<0)return null;
 return new Date(t+days*86400000).toISOString().slice(0,10);
}
const api=Object.freeze({daysLeft,monthly,milkDays,runOutDate});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreTools=api;
})(typeof globalThis!=='undefined'?globalThis:this);
