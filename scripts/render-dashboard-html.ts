import Database from "better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveDatabasePath } from "../server/db/index.js";
import { MIGRATIONS } from "../server/db/migrations.js";
import { DEFAULT_ENTITY_COLORS } from "../shared/finance/colors.js";
import {
  escapeHtml,
  parseReportArgs,
  reportUsage,
} from "./report-html-common.js";
import { DOWNLOADS_DIRECTORY } from "./user-paths.js";

interface DashboardAccountRow {
  id: string;
  name: string;
  type: string;
  initial_balance: number;
  color: string | null;
  created_at: string;
}

interface DashboardCategoryRow {
  id: string;
  name: string;
  type: string;
  color: string | null;
}

interface DashboardSubcategoryRow {
  id: string;
  category_id: string;
  name: string;
  color: string | null;
}

interface DashboardTransactionRow {
  id: string;
  account_id: string;
  date: string;
  name: string;
  amount: number;
  kind: string;
  subcategory_id: string | null;
  created_at: string;
}

interface DashboardPayload {
  accounts: DashboardAccountRow[];
  categories: DashboardCategoryRow[];
  subcategories: DashboardSubcategoryRow[];
  transactions: DashboardTransactionRow[];
}

function verifyDashboardSchema(db: Database.Database): void {
  const missing =
    "Dashboard database schema is not current. Initialize or upgrade LocalFin separately before generating this report.";
  const ledger = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get();
  if (!ledger) throw new Error(missing);
  const applied = db
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number; name: string }>;
  if (applied.length !== MIGRATIONS.length) throw new Error(missing);
  for (let i = 0; i < MIGRATIONS.length; i += 1) {
    if (
      applied[i].version !== MIGRATIONS[i].version ||
      applied[i].name !== MIGRATIONS[i].name
    ) {
      throw new Error(missing);
    }
  }
}

function collectDashboardPayload(): DashboardPayload {
  const dbPath = resolveDatabasePath();
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new Error(
      `Unable to open dashboard database read-only: ${dbPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const run = db.transaction(() => {
      verifyDashboardSchema(db);
      const accounts = db
        .prepare(
          `SELECT id, name, type, initial_balance, color, created_at
           FROM accounts WHERE deleted_at IS NULL ORDER BY created_at`,
        )
        .all() as DashboardAccountRow[];
      const categories = db
        .prepare(
          `SELECT id, name, type, color
           FROM categories WHERE deleted_at IS NULL ORDER BY created_at`,
        )
        .all() as DashboardCategoryRow[];
      const subcategories = db
        .prepare(
          `SELECT id, category_id, name, color
           FROM subcategories WHERE deleted_at IS NULL ORDER BY created_at`,
        )
        .all() as DashboardSubcategoryRow[];
      const transactions = db
        .prepare(
          `SELECT t.id, t.account_id, t.date, t.name, t.amount, t.kind, t.subcategory_id, t.created_at
           FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
           WHERE t.deleted_at IS NULL ORDER BY t.date, t.created_at, t.rowid`,
        )
        .all() as DashboardTransactionRow[];
      return { accounts, categories, subcategories, transactions };
    });
    return run();
  } finally {
    db.close();
  }
}

// Client-side app. No backticks or ${} inside: this is nested in the shell
// template literal below. No "</script" sequence either (would close the tag).
const PAGE_JS = `(function(){
'use strict';
var dataEl=document.getElementById('dashboard-data');
var PAY=JSON.parse(dataEl?(dataEl.textContent||'{}'):'{}');
var ACCOUNTS=PAY.accounts||[];
var CATS=PAY.categories||[];
var SUBS=PAY.subcategories||[];
var TXNS=PAY.transactions||[];
var PALETTE=__PALETTE__;
var HEXRE=/^#[0-9a-fA-F]{6}$/;
function normColor(v){ if(v==null||v==='') return null; return (typeof v==='string'&&HEXRE.test(v))?v.toLowerCase():null; }
function colorIdx(id){ var h=0; for(var i=0;i<id.length;i++){ h=((h*31)+id.charCodeAt(i))>>>0; } return h%PALETTE.length; }
function entColor(id,c){ var n=normColor(c); return n==null?PALETTE[colorIdx(String(id))]:n; }
function esc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
var USD=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
var USD_COMPACT=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1});
function sign(v){ return v<0?-1:1; }
function toCents(v){ var n=Number(v); if(!isFinite(n)) n=0; return sign(n)*Math.round((Math.abs(n)+Number.EPSILON)*100); }
function fmt(c){ return USD.format(c/100); }
function fmtPlus(c){ return (c>0?'+':'')+USD.format(c/100); }
function fmtCompact(c){ return USD_COMPACT.format(c/100); }
function lum(hex){ var r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255; function lin(c){ return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); } return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); }
function textOn(hex){ var L=lum(hex); var cw=1.05/(L+0.05); var cb=(L+0.05)/0.05; return cw>cb?'#ffffff':'#000000'; }
function parseIso(s){ var p=String(s).split('-'); return new Date(Date.UTC(Number(p[0]),Number(p[1])-1,Number(p[2]))); }
function pad2(n){ return String(n).padStart(2,'0'); }
function toIso(d){ return d.getUTCFullYear()+'-'+pad2(d.getUTCMonth()+1)+'-'+pad2(d.getUTCDate()); }
function addMonths(d,n){ var day=d.getUTCDate(); var base=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1)); var dim=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,0)).getUTCDate(); base.setUTCDate(Math.min(day,dim)); return base; }
function diffDays(later,earlier){ function s(d){ return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()); } return Math.round((s(later)-s(earlier))/86400000); }
var MLAB=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fullDate(iso){ var d=parseIso(iso); return MLAB[d.getUTCMonth()]+' '+d.getUTCDate()+', '+d.getUTCFullYear(); }
function bucketDates(s,e,g){
  var endIso=toIso(parseIso(e)); var out=[]; var cur=parseIso(s); var guard=0;
  while(toIso(cur)<=endIso){
    out.push(toIso(cur));
    var nx=g==='day'?new Date(cur.getTime()+86400000):(g==='week'?new Date(cur.getTime()+7*86400000):addMonths(cur,1));
    if(nx.getTime()<=cur.getTime()) break;
    cur=nx; guard+=1; if(guard>5000) break;
  }
  return out;
}
var k;
for(k=0;k<ACCOUNTS.length;k++){ ACCOUNTS[k].initial_balance=toCents(ACCOUNTS[k].initial_balance); }
for(k=0;k<TXNS.length;k++){ TXNS[k].amount=toCents(TXNS[k].amount); }
var acctById={}; ACCOUNTS.forEach(function(a){acctById[a.id]=a;});
var catById={}; CATS.forEach(function(c){catById[c.id]=c;});
var subById={}; SUBS.forEach(function(s){subById[s.id]=s;});
function txnCmp(a,b){
  if(a.date!==b.date) return a.date<b.date?-1:1;
  if(a.created_at!==b.created_at) return a.created_at<b.created_at?-1:1;
  return 0;
}
var SORTED=TXNS.slice().sort(txnCmp);
var MIN_DATE=SORTED.length?SORTED[0].date:null;
var ACCT_TXNS={};
for(k=0;k<ACCOUNTS.length;k++) ACCT_TXNS[ACCOUNTS[k].id]=[];
for(k=0;k<SORTED.length;k++){ var tt=SORTED[k]; if(ACCT_TXNS[tt.account_id]) ACCT_TXNS[tt.account_id].push(tt); }
function clampStart(s){ if(!MIN_DATE) return s; return s<MIN_DATE?MIN_DATE:s; }
function computeAccounts(eff,end){
  return ACCOUNTS.map(function(a){
    var txns=ACCT_TXNS[a.id]||[];
    var starting=a.initial_balance;
    var change=0;
    var rows=[];
    var i,t;
    for(i=0;i<txns.length;i++){
      t=txns[i];
      if(t.date<eff){ starting+=t.amount; }
      else if(t.date<=end){ rows.push(t); change+=t.amount; }
    }
    var run=starting;
    var out=[];
    for(i=0;i<rows.length;i++){
      t=rows[i];
      run+=t.amount;
      var s=t.subcategory_id?subById[t.subcategory_id]:null;
      var c=s?catById[s.category_id]:null;
      out.push({id:t.id,date:t.date,name:t.name,amount:t.amount,run:run,sub:s?s.name:null,cat:c?c.name:null});
    }
    return {id:a.id,name:a.name,type:a.type,starting:starting,change:change,ending:starting+change,rows:out};
  });
}
function worthAt(end){
  var assets=0, liabs=0;
  for(var kk=0;kk<ACCOUNTS.length;kk++){
    var a=ACCOUNTS[kk];
    var b=a.initial_balance;
    var txns=ACCT_TXNS[a.id]||[];
    for(var i=0;i<txns.length;i++){ if(txns[i].date<=end) b+=txns[i].amount; }
    if(a.type==='asset') assets+=b; else liabs+=b;
  }
  return {assets:assets,liabilities:liabs,net:assets-liabs};
}
function nwSeries(eff,end,req){
  var useEff=eff;
  if(useEff>end&&req&&req<=end) useEff=req;
  var days=diffDays(parseIso(end),parseIso(useEff));
  var g=days<28?'day':(days<180?'week':'month');
  var bs=bucketDates(useEff,end,g);
  if(!bs.length) bs=[end];
  if(bs[bs.length-1]!==end) bs.push(end);
  var bal={}; for(var kk=0;kk<ACCOUNTS.length;kk++) bal[ACCOUNTS[kk].id]=0;
  var pts=[]; var ti=0;
  for(var bi=0;bi<bs.length;bi++){
    var b=bs[bi];
    while(ti<SORTED.length&&SORTED[ti].date<=b){ var t=SORTED[ti]; if(bal[t.account_id]!==undefined) bal[t.account_id]+=t.amount; ti+=1; }
    var nw=0;
    for(kk=0;kk<ACCOUNTS.length;kk++){ var a=ACCOUNTS[kk]; var bl=a.initial_balance+bal[a.id]; if(a.type==='asset') nw+=bl; else nw-=bl; }
    pts.push({date:b,netWorth:nw});
  }
  return pts;
}
function hostWidth(){
  var el=document.getElementById('networth');
  var w=el&&el.clientWidth?el.clientWidth:720;
  if(w<280) w=280;
  return w;
}
function nwSvg(pts){
  if(!ACCOUNTS.length) return '<p class="empty">No account data.</p>';
  if(!pts.length) return '<p class="empty">No net-worth data.</p>';
  var W=hostWidth();
  var H=W<600?240:280;
  var padL=80,padR=16,padT=24,padB=44;
  var plotW=W-padL-padR; if(plotW<100) plotW=100;
  var plotH=H-padT-padB; if(plotH<100) plotH=100;
  var vals=pts.map(function(p){return p.netWorth;});
  var mn=Math.min.apply(null,vals.concat([0]));
  var mx=Math.max.apply(null,vals.concat([0]));
  if(mn===0&&mx===0) mx=100;
  var span=(mx-mn)||1;
  function xFor(d){
    if(pts.length===1) return padL+plotW/2;
    var sMs=parseIso(pts[0].date).getTime();
    var eMs=parseIso(pts[pts.length-1].date).getTime();
    if(eMs===sMs) return padL+plotW/2;
    return padL+((parseIso(d).getTime()-sMs)/(eMs-sMs))*plotW;
  }
  function yFor(v){ return padT+((mx-v)/span)*plotH; }
  var yZero=yFor(0);
  var out='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Net worth over time" style="width:100%;height:auto;background:#111827;border:1px solid #334155;border-radius:12px" preserveAspectRatio="xMidYMid meet">';
  var ticks=[]; var i;
  for(i=0;i<5;i++) ticks.push(mn+(mx-mn)*i/4);
  for(i=0;i<ticks.length;i++){
    var ty=yFor(ticks[i]);
    out+='<line x1="'+padL+'" y1="'+ty.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+ty.toFixed(1)+'" stroke="#334155" stroke-width="1" opacity="0.6"></line>';
    out+='<text x="'+(padL-8)+'" y="'+(ty+4).toFixed(1)+'" font-size="12" fill="#9ca3af" text-anchor="end">'+esc(fmtCompact(ticks[i]))+'</text>';
  }
  out+='<line x1="'+padL+'" y1="'+yZero.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+yZero.toFixed(1)+'" stroke="#9ca3af" stroke-width="1.5"></line>';
  if(pts.length===1){
    var cx=xFor(pts[0].date), cy=yFor(pts[0].netWorth);
    out+='<circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="6" fill="#60a5fa" aria-label="'+esc(pts[0].date+' '+fmt(pts[0].netWorth))+'"><title>'+esc(pts[0].date+' - '+fmt(pts[0].netWorth))+'</title></circle>';
    out+='<text x="'+cx.toFixed(1)+'" y="'+(cy-14).toFixed(1)+'" font-size="12" fill="#e5e7eb" text-anchor="middle">'+esc(fmt(pts[0].netWorth))+'</text>';
    out+='<text x="'+cx.toFixed(1)+'" y="'+(H-10)+'" font-size="12" fill="#9ca3af" text-anchor="middle">'+esc(fullDate(pts[0].date))+'</text>';
  } else {
    var coords=pts.map(function(p){ return {x:xFor(p.date),y:yFor(p.netWorth),p:p}; });
    var line=coords.map(function(c2,idx){ return (idx===0?'M':'L')+c2.x.toFixed(1)+','+c2.y.toFixed(1); }).join(' ');
    var area=line+' L'+coords[coords.length-1].x.toFixed(1)+','+yZero.toFixed(1)+' L'+coords[0].x.toFixed(1)+','+yZero.toFixed(1)+' Z';
    out+='<path d="'+esc(area)+'" fill="#60a5fa" opacity="0.2" stroke="none"></path>';
    out+='<path d="'+esc(line)+'" fill="none" stroke="#60a5fa" stroke-width="2"></path>';
    for(i=0;i<coords.length;i++){
      var cc=coords[i];
      out+='<circle cx="'+cc.x.toFixed(1)+'" cy="'+cc.y.toFixed(1)+'" r="3.5" fill="#60a5fa" aria-label="'+esc(cc.p.date+' '+fmt(cc.p.netWorth))+'"><title>'+esc(cc.p.date+' - '+fmt(cc.p.netWorth))+'</title></circle>';
    }
    var first=pts[0], last=pts[pts.length-1];
    out+='<text x="'+padL+'" y="16" font-size="12" fill="#e5e7eb">Net worth: '+esc(fmt(first.netWorth))+' to '+esc(fmt(last.netWorth))+'</text>';
    out+='<text x="'+padL+'" y="'+(H-10)+'" font-size="12" fill="#9ca3af">'+esc(fullDate(first.date))+'</text>';
    out+='<text x="'+(W-padR)+'" y="'+(H-10)+'" font-size="12" fill="#9ca3af" text-anchor="end">'+esc(fullDate(last.date))+'</text>';
  }
  out+='</svg>';
  return out;
}
function nwDataHtml(pts){
  var h='<details><summary>Net-worth data</summary><div class="table-scroll" tabindex="0" aria-label="Net-worth data table"><table><thead><tr><th>Date</th><th>Net worth</th></tr></thead><tbody>';
  for(var i=0;i<pts.length;i++) h+='<tr><td>'+esc(pts[i].date)+'</td><td class="num">'+esc(fmt(pts[i].netWorth))+'</td></tr>';
  h+='</tbody></table></div></details>';
  return h;
}
function sankeyModel(eff,end){
  var incMap={}, expMap={};
  var totalIncome=0, totalExpenses=0;
  for(var i=0;i<SORTED.length;i++){
    var t=SORTED[i];
    if(t.date<eff||t.date>end) continue;
    if(!acctById[t.account_id]) continue;
    if(t.kind!=='income'&&t.kind!=='expense') continue;
    var mag=Math.abs(t.amount);
    if(mag===0) continue;
    var s=t.subcategory_id?subById[t.subcategory_id]:null;
    var c=s?catById[s.category_id]:null;
    var catId,catName,catColor,subId,subName,subColor;
    if(s&&c&&c.type===t.kind){
      catId=c.id; catName=c.name; catColor=c.color; subId=s.id; subName=s.name; subColor=s.color;
    } else if(t.kind==='income'){
      catId='synthetic:income:uncategorized'; catName='Uncategorized income'; catColor=null; subId='synthetic:income:uncategorized'; subName='Uncategorized'; subColor=null;
    } else {
      catId='synthetic:expense:uncategorized'; catName='Uncategorized expenses'; catColor=null; subId='synthetic:expense:uncategorized'; subName='Uncategorized'; subColor=null;
    }
    if(t.kind==='income'){
      totalIncome+=mag;
      if(!incMap[catId]) incMap[catId]={id:catId,name:catName,color:catColor,total:0,subs:{}};
      incMap[catId].total+=mag;
      if(!incMap[catId].subs[subId]) incMap[catId].subs[subId]={id:subId,name:subName,color:subColor,total:0};
      incMap[catId].subs[subId].total+=mag;
    } else {
      totalExpenses+=mag;
      if(!expMap[catId]) expMap[catId]={id:catId,name:catName,color:catColor,total:0,subs:{}};
      expMap[catId].total+=mag;
      if(!expMap[catId].subs[subId]) expMap[catId].subs[subId]={id:subId,name:subName,color:subColor,total:0};
      expMap[catId].subs[subId].total+=mag;
    }
  }
  var surplus=totalIncome-totalExpenses;
  var fundingGap=surplus<0?-surplus:0;
  var availableFunds=totalIncome>totalExpenses?totalIncome:totalExpenses;
  function toArr(map){
    var arr=Object.keys(map).map(function(key){
      var e=map[key];
      var subs=Object.keys(e.subs).map(function(sk){ return e.subs[sk]; });
      subs.sort(function(a,b){ if(b.total!==a.total) return b.total-a.total; return a.id<b.id?-1:(a.id>b.id?1:0); });
      return {id:e.id,name:e.name,color:e.color,total:e.total,subs:subs};
    });
    arr.sort(function(a,b){ if(b.total!==a.total) return b.total-a.total; return a.id<b.id?-1:(a.id>b.id?1:0); });
    return arr;
  }
  return {totalIncome:totalIncome,totalExpenses:totalExpenses,surplus:surplus,fundingGap:fundingGap,availableFunds:availableFunds,incCats:toArr(incMap),expCats:toArr(expMap)};
}
function flowSvg(m){
  if(m.availableFunds===0) return '<p class="empty">No income or expense activity in this range.</p>';
  var wide=true;
  if(typeof window!=='undefined'&&typeof window.innerWidth==='number') wide=window.innerWidth>=1200;
  if(!wide) return '';
  var NODE_W=160;
  var XS=[24,252,480,708,936];
  var SVG_W=1120;
  var PADV=24, GAPV=12;
  var nodes=[], links=[];
  var i,cc2;
  for(i=0;i<m.incCats.length;i++){ cc2=m.incCats[i]; nodes.push({id:'income-category:'+cc2.id,name:cc2.name,color:entColor(cc2.id,cc2.color),value:cc2.total,col:0}); }
  if(m.totalIncome>0) nodes.push({id:'total-income',name:'Total income',color:'#60a5fa',value:m.totalIncome,col:1});
  if(m.fundingGap>0) nodes.push({id:'funding-gap',name:'Funding gap',color:'#fb7185',value:m.fundingGap,col:1});
  nodes.push({id:'available-funds',name:'Available funds',color:'#a78bfa',value:m.availableFunds,col:2});
  if(m.totalExpenses>0) nodes.push({id:'total-expenses',name:'Total expenses',color:'#f59e0b',value:m.totalExpenses,col:3});
  if(m.surplus>0) nodes.push({id:'surplus',name:'Surplus',color:'#34d399',value:m.surplus,col:3});
  for(i=0;i<m.expCats.length;i++){ cc2=m.expCats[i]; nodes.push({id:'expense-category:'+cc2.id,name:cc2.name,color:entColor(cc2.id,cc2.color),value:cc2.total,col:4}); }
  nodes=nodes.filter(function(n){ return n.value>0; });
  for(i=0;i<m.incCats.length;i++){ cc2=m.incCats[i]; if(cc2.total>0&&m.totalIncome>0) links.push({source:'income-category:'+cc2.id,target:'total-income',value:cc2.total}); }
  if(m.totalIncome>0) links.push({source:'total-income',target:'available-funds',value:m.totalIncome});
  if(m.fundingGap>0) links.push({source:'funding-gap',target:'available-funds',value:m.fundingGap});
  if(m.totalExpenses>0) links.push({source:'available-funds',target:'total-expenses',value:m.totalExpenses});
  if(m.surplus>0) links.push({source:'available-funds',target:'surplus',value:m.surplus});
  for(i=0;i<m.expCats.length;i++){ cc2=m.expCats[i]; if(cc2.total>0&&m.totalExpenses>0) links.push({source:'total-expenses',target:'expense-category:'+cc2.id,value:cc2.total}); }
  links=links.filter(function(l){ return l.value>0; });
  if(!links.length) return '<p class="empty">No income or expense activity in this range.</p>';
  var scale=320/m.availableFunds;
  var cols=[[],[],[],[],[]];
  nodes.forEach(function(n){ cols[n.col].push(n); });
  var colOrder1=['total-income','funding-gap'];
  var colOrder3=['total-expenses','surplus'];
  cols[1].sort(function(a,b){ return colOrder1.indexOf(a.id)-colOrder1.indexOf(b.id); });
  cols[3].sort(function(a,b){ return colOrder3.indexOf(a.id)-colOrder3.indexOf(b.id); });
  var colH=[], maxH=0;
  cols.forEach(function(c2){
    var s=0;
    c2.forEach(function(n){ n.h=Math.max(52,n.value*scale); s+=n.h; });
    if(c2.length) s+=(c2.length-1)*GAPV;
    colH.push(s);
    if(s>maxH) maxH=s;
  });
  var H=maxH+PADV*2;
  var pos={};
  cols.forEach(function(c2,ci){
    var y=PADV+(maxH-colH[ci])/2;
    c2.forEach(function(n){
      pos[n.id]={x:XS[ci],y:y,h:n.h};
      n.x=XS[ci]; n.y=y;
      y+=n.h+GAPV;
    });
  });
  var inTot={}, outTot={}, inOff={}, outOff={};
  nodes.forEach(function(n){ inTot[n.id]=0; outTot[n.id]=0; });
  links.forEach(function(l){ outTot[l.source]+=l.value; inTot[l.target]+=l.value; });
  nodes.forEach(function(n){
    var p=pos[n.id];
    inOff[n.id]=p.y+(p.h-inTot[n.id]*scale)/2;
    outOff[n.id]=p.y+(p.h-outTot[n.id]*scale)/2;
  });
  var out='<svg viewBox="0 0 '+SVG_W+' '+H+'" role="img" aria-label="Income and expense flows" style="width:1120px;min-width:1120px;height:auto;background:#111827;border:1px solid #334155;border-radius:12px" preserveAspectRatio="xMidYMid meet">';
  links.forEach(function(l){
    var a=pos[l.source], b=pos[l.target];
    if(!a||!b) return;
    var th=l.value*scale;
    var y1=outOff[l.source], y2=inOff[l.target];
    var x1=a.x+NODE_W, x2=b.x, mx=(x1+x2)/2;
    var scol='#64748b';
    for(var ni=0;ni<nodes.length;ni++){ if(nodes[ni].id===l.source){ scol=nodes[ni].color; break; } }
    out+='<path d="M '+x1.toFixed(1)+','+y1.toFixed(1)+' C '+mx.toFixed(1)+','+y1.toFixed(1)+' '+mx.toFixed(1)+','+y2.toFixed(1)+' '+x2.toFixed(1)+','+y2.toFixed(1)+' L '+x2.toFixed(1)+','+(y2+th).toFixed(1)+' C '+mx.toFixed(1)+','+(y2+th).toFixed(1)+' '+mx.toFixed(1)+','+(y1+th).toFixed(1)+' '+x1.toFixed(1)+','+(y1+th).toFixed(1)+' Z" fill="'+scol+'" opacity="0.55"><title>'+esc(l.source+' to '+l.target+' - '+fmt(l.value))+'</title></path>';
    outOff[l.source]+=th;
    inOff[l.target]+=th;
  });
  nodes.forEach(function(n){
    var p=pos[n.id];
    if(!p) return;
    var label=n.name+' - '+fmt(n.value);
    var fg=textOn(n.color);
    var fy=p.y+(p.h-32)/2;
    out+='<g role="img" aria-label="'+esc(label)+'"><title>'+esc(label)+'</title>';
    out+='<rect x="'+p.x+'" y="'+p.y.toFixed(1)+'" width="'+NODE_W+'" height="'+p.h.toFixed(1)+'" rx="6" fill="'+n.color+'"></rect>';
    out+='<foreignObject x="'+(p.x+8)+'" y="'+fy.toFixed(1)+'" width="144" height="32"><div xmlns="http://www.w3.org/1999/xhtml" style="width:144px;height:32px;display:flex;flex-direction:column;justify-content:center;"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;line-height:16px;color:'+fg+';">'+esc(n.name)+'</div><div style="font-size:12px;line-height:16px;color:'+fg+';">'+esc(fmt(n.value))+'</div></div></foreignObject>';
    out+='</g>';
  });
  out+='</svg>';
  return '<div class="flow-scroll" tabindex="0" aria-label="Cash-flow diagram scroll region">'+out+'</div>';
}
function pctStr(part,whole){ if(!whole) return '0.0%'; return (100*part/whole).toFixed(1)+'%'; }
function flowBreakdownHtml(m){
  var h='<div class="flow-totals"><p>Income '+esc(fmt(m.totalIncome))+' · Expenses '+esc(fmt(m.totalExpenses))+' · ';
  if(m.surplus>=0) h+='Surplus '+esc(fmtPlus(m.surplus));
  else h+='Deficit '+esc(fmt(m.surplus));
  h+=' · Funding gap '+esc(fmt(m.fundingGap))+' · Available funds '+esc(fmt(m.availableFunds))+'</p>';
  if(m.fundingGap>0) h+='<p class="muted">Expenses exceed income by this amount; the source of funding is not inferred.</p>';
  if(m.surplus>0) h+='<p class="muted">Surplus is unspent income, not a confirmed transfer into a savings account.</p>';
  h+='</div><div class="flow-groups">';
  h+='<h3>Income</h3>';
  if(!m.incCats.length) h+='<p class="empty">No income in this range.</p>';
  else {
    for(var i=0;i<m.incCats.length;i++){
      var c2=m.incCats[i];
      h+='<details><summary><span class="wrap">'+esc(c2.name)+'</span> <span class="num">'+esc(fmt(c2.total))+' ('+pctStr(c2.total,m.totalIncome)+')</span></summary>';
      h+='<div class="table-scroll" tabindex="0" aria-label="'+esc(c2.name)+' subcategories"><table><thead><tr><th>Subcategory</th><th>Amount</th><th>Share</th></tr></thead><tbody>';
      for(var j=0;j<c2.subs.length;j++){ var s2=c2.subs[j]; h+='<tr><td class="wrap">'+esc(s2.name)+'</td><td class="num">'+esc(fmt(s2.total))+'</td><td class="num">'+esc(pctStr(s2.total,m.totalIncome))+'</td></tr>'; }
      h+='</tbody></table></div></details>';
    }
  }
  h+='<h3>Expenses</h3>';
  if(!m.expCats.length) h+='<p class="empty">No expenses in this range.</p>';
  else {
    for(var i2=0;i2<m.expCats.length;i2++){
      var e2=m.expCats[i2];
      h+='<details><summary><span class="wrap">'+esc(e2.name)+'</span> <span class="num">'+esc(fmt(e2.total))+' ('+pctStr(e2.total,m.totalExpenses)+')</span></summary>';
      h+='<div class="table-scroll" tabindex="0" aria-label="'+esc(e2.name)+' subcategories"><table><thead><tr><th>Subcategory</th><th>Amount</th><th>Share</th></tr></thead><tbody>';
      for(var j2=0;j2<e2.subs.length;j2++){ var s3=e2.subs[j2]; h+='<tr><td class="wrap">'+esc(s3.name)+'</td><td class="num">'+esc(fmt(s3.total))+'</td><td class="num">'+esc(pctStr(s3.total,m.totalExpenses))+'</td></tr>'; }
      h+='</tbody></table></div></details>';
    }
  }
  h+='</div>';
  return h;
}
function overviewHtml(w,m){
  var h='<div class="cards">';
  h+='<div class="card"><div class="card-label">Net worth</div><div class="card-value">'+esc(fmt(w.net))+'</div><div class="card-sub">Assets '+esc(fmt(w.assets))+' · Liabilities '+esc(fmt(w.liabilities))+'</div></div>';
  h+='<div class="card"><div class="card-label">Income</div><div class="card-value">'+esc(fmt(m.totalIncome))+'</div><div class="card-sub">Selected range</div></div>';
  h+='<div class="card"><div class="card-label">Expenses</div><div class="card-value">'+esc(fmt(m.totalExpenses))+'</div><div class="card-sub">Selected range</div></div>';
  if(m.surplus>=0) h+='<div class="card"><div class="card-label">Surplus</div><div class="card-value pos">'+esc(fmtPlus(m.surplus))+'</div><div class="card-sub">Selected range</div></div>';
  else h+='<div class="card"><div class="card-label">Deficit</div><div class="card-value neg">'+esc(fmt(m.surplus))+'</div><div class="card-sub">Selected range</div></div>';
  h+='</div>';
  return h;
}
function catLabel(r){ if(r.cat&&r.sub) return r.cat+' › '+r.sub; if(r.sub) return r.sub; if(r.cat) return r.cat; return '—'; }
var PAGE_SIZE=100;
var pageByAcct={};
var openAccts={},searchQ={},LAST=null,CACHED=null,LAST_VALID=null,currentPreset='custom';
function filterRows(rows,q){
  var ql=String(q||'').toLowerCase();
  if(!ql) return rows;
  return rows.filter(function(r){ return r.name.toLowerCase().indexOf(ql)>=0||(r.sub&&r.sub.toLowerCase().indexOf(ql)>=0)||(r.cat&&r.cat.toLowerCase().indexOf(ql)>=0); });
}
function txnTable(a,q){
  var rev=filterRows(a.rows,q).slice().reverse();
  var N=rev.length;
  var pages=N===0?1:Math.ceil(N/PAGE_SIZE);
  var pg=pageByAcct[a.id]||1;
  if(pg<1) pg=1;
  if(pg>pages) pg=pages;
  pageByAcct[a.id]=pg;
  var start=(pg-1)*PAGE_SIZE;
  var e2=Math.min(start+PAGE_SIZE,N);
  var shown=rev.slice(start,e2);
  var h='<div class="table-scroll" tabindex="0" aria-label="'+esc(a.name)+' transactions"><table><thead><tr><th>Date</th><th>Name</th><th>Category</th><th>Amount</th><th>Balance</th></tr></thead><tbody>';
  for(var i=0;i<shown.length;i++){ var r=shown[i]; h+='<tr><td>'+esc(r.date)+'</td><td class="wrap">'+esc(r.name)+'</td><td class="wrap">'+esc(catLabel(r))+'</td><td class="num">'+esc(fmt(r.amount))+'</td><td class="num">'+esc(fmt(r.run))+'</td></tr>'; }
  h+='</tbody></table></div>';
  if(N===0){
    h+='<p class="empty">No matching transactions.</p>';
    h+='<div class="pager"><button type="button" data-page="prev" data-acct="'+esc(a.id)+'" disabled>Previous</button><span>Page 1 of 1</span><button type="button" data-page="next" data-acct="'+esc(a.id)+'" disabled>Next</button><span>Showing 0 of 0 transactions</span></div>';
  } else {
    h+='<div class="pager"><button type="button" data-page="prev" data-acct="'+esc(a.id)+'"'+(pg<=1?' disabled':'')+'>Previous</button><span>Page '+pg+' of '+pages+'</span><button type="button" data-page="next" data-acct="'+esc(a.id)+'"'+(pg>=pages?' disabled':'')+'>Next</button><span>Showing '+(start+1)+'–'+e2+' of '+N+' transactions</span></div>';
  }
  return h;
}
function accountsHtml(list,w){
  var aS=0,aC=0,aE=0,lS=0,lC=0,lE=0,i,a;
  for(i=0;i<list.length;i++){ a=list[i]; if(a.type==='asset'){ aS+=a.starting; aC+=a.change; aE+=a.ending; } else { lS+=a.starting; lC+=a.change; lE+=a.ending; } }
  var h='<div class="table-scroll" tabindex="0" aria-label="Account balances"><table><thead><tr><th>Account</th><th>Type</th><th>Starting</th><th>Change</th><th>Ending</th></tr></thead><tbody>';
  for(i=0;i<list.length;i++){
    a=list[i];
    var cls=a.type==='asset'?(a.change>0?'pos':(a.change<0?'neg':'')):(a.change<0?'pos':(a.change>0?'neg':''));
    var ch=a.change>0?fmtPlus(a.change):fmt(a.change);
    h+='<tr><td class="wrap">'+esc(a.name)+'</td><td>'+esc(a.type)+'</td><td class="num">'+esc(fmt(a.starting))+'</td><td class="num '+cls+'">'+esc(ch)+'</td><td class="num">'+esc(fmt(a.ending))+'</td></tr>';
  }
  var aCs=aC>0?fmtPlus(aC):fmt(aC);
  var lCs=lC>0?fmtPlus(lC):fmt(lC);
  h+='</tbody><tfoot><tr><td><strong>Asset subtotal</strong></td><td></td><td class="num"><strong>'+esc(fmt(aS))+'</strong></td><td class="num"><strong>'+esc(aCs)+'</strong></td><td class="num"><strong>'+esc(fmt(aE))+'</strong></td></tr>';
  h+='<tr><td><strong>Liability subtotal</strong></td><td></td><td class="num"><strong>'+esc(fmt(lS))+'</strong></td><td class="num"><strong>'+esc(lCs)+'</strong></td><td class="num"><strong>'+esc(fmt(lE))+'</strong></td></tr></tfoot></table></div>';
  h+='<p>Assets '+esc(fmt(w.assets))+' · Liabilities '+esc(fmt(w.liabilities))+' · Net worth '+esc(fmt(w.net))+'</p>';
  h+='<p class="muted">Positive liability balances represent debt and negative ones credit; amounts are shown as stored.</p>';
  for(i=0;i<list.length;i++){
    a=list[i];
    var open=openAccts[a.id]?' open':'';
    h+='<details data-acct="'+esc(a.id)+'"'+open+'><summary>'+esc(a.name)+' — '+esc(fmt(a.starting))+' to '+esc(fmt(a.ending))+' ('+a.rows.length+' transactions)</summary>';
    h+='<input type="search" data-search="'+esc(a.id)+'" placeholder="Filter transactions..." value="'+esc(searchQ[a.id]||'')+'" aria-label="Filter '+esc(a.name)+' transactions">';
    h+='<div data-txns="'+esc(a.id)+'">'+txnTable(a,searchQ[a.id]||'')+'</div></details>';
  }
  return h;
}
function findAcct(id){
  if(!LAST) return null;
  for(var i=0;i<LAST.length;i++) if(LAST[i].id===id) return LAST[i];
  return null;
}
function pagerHandler(ev){
  var t=ev.target||ev.srcElement;
  if(!t||!t.getAttribute) return;
  var action=t.getAttribute('data-page');
  var id=t.getAttribute('data-acct');
  if(!action||!id) return;
  var a=findAcct(id);
  if(!a) return;
  var q=searchQ[id]||'';
  var pages=Math.max(1,Math.ceil(filterRows(a.rows,q).length/PAGE_SIZE));
  var pg=pageByAcct[id]||1;
  if(action==='prev'&&pg>1) pg-=1;
  else if(action==='next'&&pg<pages) pg+=1;
  else return;
  pageByAcct[id]=pg;
  var host=null;
  if(document.querySelector) host=document.querySelector('div[data-txns="'+id+'"]');
  if(host) host.innerHTML=txnTable(a,q);
}
function searchHandler(ev){
  var t=ev.target||ev.srcElement;
  if(!t||!t.getAttribute) return;
  var id=t.getAttribute('data-search');
  if(!id) return;
  if(!acctById[id]) return;
  searchQ[id]=t.value;
  pageByAcct[id]=1;
  var host=null;
  if(document.querySelector) host=document.querySelector('div[data-txns="'+id+'"]');
  if(host&&LAST){
    var a=findAcct(id);
    if(a) host.innerHTML=txnTable(a,t.value||'');
  }
}
function bindOnce(){
  var acc=document.getElementById('accounts');
  if(acc&&!acc.__bound){
    acc.__bound=true;
    if(acc.addEventListener){
      acc.addEventListener('click',pagerHandler);
      acc.addEventListener('input',searchHandler);
      acc.addEventListener('toggle',function(ev){
        var t=ev.target;
        if(t&&t.getAttribute){
          var id=t.getAttribute('data-acct');
          if(id){ if(t.open) openAccts[id]=true; else delete openAccts[id]; }
        }
      },true);
    }
  }
  if(typeof window!=='undefined'&&window.addEventListener&&!window.__dashResize){
    window.__dashResize=true;
    window.addEventListener('resize',onResize);
  }
}
var RZ_T=null;
function redrawCharts(){
  if(!CACHED) return;
  var nwEl=document.getElementById('networth');
  if(nwEl) nwEl.innerHTML=nwSvg(CACHED.pts);
  var skEl=document.getElementById('sankey');
  if(skEl) skEl.innerHTML=flowSvg(CACHED.sk);
}
function onResize(){
  if(RZ_T) return;
  RZ_T=true;
  function doIt(){ RZ_T=null; redrawCharts(); }
  if(typeof window!=='undefined'&&window.requestAnimationFrame) window.requestAnimationFrame(doIt);
  else doIt();
}
function presetDisplay(p){
  if(p==='3M') return '3M';
  if(p==='6M') return '6M';
  if(p==='YTD') return 'YTD';
  if(p==='1Y') return '1Y';
  if(p==='ALL') return 'All';
  return 'Custom range';
}
function updatePresetUI(){
  var btns=document.querySelectorAll?document.querySelectorAll('button[data-preset]'):[];
  for(var i=0;i<btns.length;i++){
    (function(b){
      var p=b.getAttribute?b.getAttribute('data-preset'):null;
      if(b.setAttribute) b.setAttribute('aria-pressed',p===currentPreset?'true':'false');
      if(p===currentPreset){ if(b.classList&&b.classList.add) b.classList.add('selected'); }
      else { if(b.classList&&b.classList.remove) b.classList.remove('selected'); }
    })(btns[i]);
  }
  var lab=document.getElementById('preset-label');
  if(lab) lab.textContent=presetDisplay(currentPreset);
}
function formatGeneratedTime(){
  var t=document.getElementById('generated-at');
  if(!t) return;
  var iso=t.getAttribute?t.getAttribute('datetime'):null;
  if(!iso) return;
  try {
    var d=new Date(iso);
    var s=d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',timeZoneName:'short'});
    t.textContent=s;
  } catch(e){}
}
function renderAll(){
  var si=document.getElementById('ds-start'),ei=document.getElementById('ds-end'),er=document.getElementById('range-error');
  var ret=document.getElementById('range-retained');
  var s=si?si.value:'',e=ei?ei.value:'';
  if(!s||!e||s>e){
    if(er) er.textContent='Invalid range: start must be on or before end.';
    if(si&&si.setAttribute) si.setAttribute('aria-invalid','true');
    if(ei&&ei.setAttribute) ei.setAttribute('aria-invalid','true');
    if(ret) ret.hidden=false;
    return;
  }
  if(er) er.textContent='';
  if(si&&si.removeAttribute) si.removeAttribute('aria-invalid');
  if(ei&&ei.removeAttribute) ei.removeAttribute('aria-invalid');
  if(ret) ret.hidden=true;
  var eff=clampStart(s);
  pageByAcct={};
  var list=computeAccounts(eff,e);
  LAST=list;
  var w=worthAt(e);
  var pts=nwSeries(eff,e,s);
  var sk=sankeyModel(eff,e);
  CACHED={eff:eff,end:e,list:list,w:w,pts:pts,sk:sk};
  LAST_VALID={s:s,e:e};
  var ov=document.getElementById('overview');
  if(ov) ov.innerHTML=overviewHtml(w,sk);
  var ar=document.getElementById('active-range');
  if(ar) ar.textContent=s+' to '+e+' · '+presetDisplay(currentPreset);
  try { document.title='Dashboard '+s+' to '+e; } catch(e2){}
  var nw=document.getElementById('networth');
  if(nw) nw.innerHTML=nwSvg(pts);
  var nd=document.getElementById('networth-data');
  if(nd) nd.innerHTML=nwDataHtml(pts);
  var sy=document.getElementById('sankey');
  if(sy) sy.innerHTML=flowSvg(sk);
  var fb=document.getElementById('flow-breakdown');
  if(fb) fb.innerHTML=flowBreakdownHtml(sk);
  var acc=document.getElementById('accounts');
  if(acc) acc.innerHTML=accountsHtml(list,w);
  updatePresetUI();
}
function setPreset(p){
  var si=document.getElementById('ds-start'),ei=document.getElementById('ds-end');
  if(!si||!ei) return;
  var e=ei.value||toIso(new Date());
  var s=e;
  if(p==='3M') s=toIso(addMonths(parseIso(e),-3));
  else if(p==='6M') s=toIso(addMonths(parseIso(e),-6));
  else if(p==='1Y') s=toIso(addMonths(parseIso(e),-12));
  else if(p==='YTD') s=e.slice(0,4)+'-01-01';
  else if(p==='ALL') s=MIN_DATE||e;
  si.value=s; ei.value=e;
  currentPreset=p;
  renderAll();
}
document.addEventListener('DOMContentLoaded',function(){
  bindOnce();
  formatGeneratedTime();
  var si=document.getElementById('ds-start'),ei=document.getElementById('ds-end');
  if(si&&ei){
    var s0=si.value,e0=ei.value;
    if(s0&&e0&&e0.slice(0,4)+'-01-01'===s0) currentPreset='YTD';
    else currentPreset='custom';
    si.addEventListener('change',function(){ currentPreset='custom'; renderAll(); });
    ei.addEventListener('change',function(){ currentPreset='custom'; renderAll(); });
  }
  var btns=document.querySelectorAll?document.querySelectorAll('button[data-preset]'):[];
  for(var i=0;i<btns.length;i++){ (function(b){ if(b.addEventListener) b.addEventListener('click',function(){ setPreset(b.getAttribute('data-preset')); }); })(btns[i]); }
  renderAll();
});
})();`;

export function renderDashboardHtml(start: string, end: string): string {
  const payload = collectDashboardPayload();
  // Escape `<` so payload text can never break out of its script tag.
  const json = JSON.stringify(payload).replaceAll("<", "\\u003c");
  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard ${escapeHtml(start)} to ${escapeHtml(end)}</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#111827;--raised:#182235;--text:#e5e7eb;--muted:#9ca3af;--border:#334155;--accent:#60a5fa;--good:#34d399;--bad:#fb7185;--focus:#93c5fd}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:100%;overflow-x:hidden}
main{max-width:1280px;margin:0 auto;padding:24px;min-width:0}
header.page{margin-bottom:16px}
.controls{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:12px;margin:12px 0}
.controls .fields{display:flex;gap:16px;flex-wrap:wrap}
.controls .fields label{display:flex;flex-direction:column;gap:6px;min-width:200px;flex:1}
.controls .presets{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
.controls button{margin:4px 4px 4px 0;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--raised);color:var(--text);cursor:pointer;min-height:44px;min-width:56px}
.controls button.selected,.controls button[aria-pressed="true"]{background:var(--accent);color:#0b1020;border-color:var(--accent);font-weight:700}
.controls button:focus-visible,input:focus-visible,details summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
#range-error{color:var(--bad);min-height:1.2em}
#range-retained{color:var(--muted)}
#preset-label{color:var(--muted);margin-left:8px}
.cards{display:grid;gap:16px;grid-template-columns:repeat(4,1fr);margin:16px 0}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px}
.card-label{color:var(--muted);font-size:.85rem;margin-bottom:6px}
.card-value{font-size:1.4rem;font-weight:700;font-variant-numeric:tabular-nums}
.card-value.pos{color:var(--good)}
.card-value.neg{color:var(--bad)}
.card-sub{color:var(--muted);font-size:.85rem;margin-top:6px}
section.panel{background:transparent;margin:16px 0}
#overview,#active-range,#networth,#networth-data,#sankey,#flow-breakdown,#accounts{min-width:0}
table{width:100%;border-collapse:collapse;background:var(--panel);color:var(--text);margin:12px 0;font-size:.9rem}
th,td{border:1px solid var(--border);padding:8px 10px;text-align:left}
th{background:var(--raised);color:var(--text)}
tfoot td{background:var(--raised)}
td.num,th.num,.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.wrap,.wrap{overflow-wrap:anywhere;word-break:break-word}
td.pos{color:var(--good)}
td.neg{color:var(--bad)}
input[type=search],input[type=date]{padding:8px 10px;border:1px solid var(--border);border-radius:10px;margin:6px 0;background:var(--raised);color:var(--text);min-height:44px}
input[type=search]{width:100%;box-sizing:border-box}
details{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:12px;margin:12px 0;color:var(--text)}
details>summary{cursor:pointer;font-weight:700;min-height:44px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.flow-groups details summary{font-weight:600}
h2{margin-top:28px;color:var(--text)}
h3{color:var(--text);margin:20px 0 8px}
.muted{color:var(--muted)}
.empty{color:var(--muted);background:var(--panel);border:1px dashed var(--border);border-radius:12px;padding:12px}
.table-scroll,.flow-scroll{overflow-x:auto;max-width:100%;border-radius:12px}
.table-scroll:focus,.flow-scroll:focus{outline:2px solid var(--focus)}
.pager{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:8px 0;color:var(--muted)}
.pager button{min-height:44px;padding:8px 14px;border:1px solid var(--border);border-radius:8px;background:var(--raised);color:var(--text);cursor:pointer}
.pager button:disabled{opacity:.45;cursor:default}
.pager button:not(:disabled):hover{border-color:var(--accent)}
footer{color:var(--muted);font-size:.85rem;margin-top:24px;border-top:1px solid var(--border);padding-top:12px}
svg text{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
@media(max-width:999px){.cards{grid-template-columns:repeat(2,1fr)}}
@media(max-width:599px){.cards{grid-template-columns:1fr}main{padding:16px}}
</style>
</head>
<body>
<main>
<header class="page">
<h1>Dashboard</h1>
<p id="active-range">${escapeHtml(start)} to ${escapeHtml(end)}</p>
<p><strong>Generated:</strong> <time id="generated-at" datetime="${escapeHtml(generatedAt)}">${escapeHtml(generatedAt)}</time></p>
<p>Full history is embedded below; change the dates to re-render instantly. No network needed. This report is an offline snapshot.</p>
</header>
<noscript><p>This report needs JavaScript enabled.</p></noscript>
<section class="controls" aria-label="Date range controls">
<div class="fields">
<label>Start <input type="date" id="ds-start" value="${escapeHtml(start)}"></label>
<label>End <input type="date" id="ds-end" value="${escapeHtml(end)}"></label>
</div>
<div class="presets" role="group" aria-label="Range presets">
<button type="button" data-preset="3M" aria-pressed="false">3M</button>
<button type="button" data-preset="6M" aria-pressed="false">6M</button>
<button type="button" data-preset="YTD" aria-pressed="false">YTD</button>
<button type="button" data-preset="1Y" aria-pressed="false">1Y</button>
<button type="button" data-preset="ALL" aria-pressed="false">All</button>
<span id="preset-label" aria-live="polite"></span>
</div>
<p id="range-error" role="alert"></p>
<p id="range-retained" hidden>Showing the last valid range.</p>
</section>
<section class="panel" aria-label="Overview">
<div id="overview"></div>
</section>
<section class="panel">
<h2>Net worth</h2>
<div id="networth"></div>
<div id="networth-data"></div>
</section>
<section class="panel">
<h2>Cash flow</h2>
<div id="sankey"></div>
<div id="flow-breakdown"></div>
</section>
<section class="panel">
<h2>Accounts</h2>
<div id="accounts"></div>
</section>
<footer><p>Full history is embedded in this file. The selected range controls only the initial view. Generated offline with no external requests.</p></footer>
</main>
<script type="application/json" id="dashboard-data">${json}</script>
<script>
${PAGE_JS.replace("__PALETTE__", JSON.stringify(DEFAULT_ENTITY_COLORS))}
</script>
</body>
</html>`;
}

export async function renderDashboardHtmlFile(
  start: string,
  end: string,
  out: string | null,
): Promise<string> {
  const html = renderDashboardHtml(start, end);
  const outputPath =
    out != null
      ? path.resolve(out)
      : path.join(DOWNLOADS_DIRECTORY, `dashboard-${start}-${end}.html`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  return outputPath;
}

async function main(): Promise<void> {
  const args = parseReportArgs(process.argv.slice(2));
  if (!args) {
    console.error(reportUsage("report:dashboard"));
    process.exitCode = 2;
    return;
  }
  try {
    const outputPath = await renderDashboardHtmlFile(
      args.start,
      args.end,
      args.out,
    );
    console.log(`Wrote ${outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
