import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getDb } from "../server/db/index.js";
import {
  REPORT_HTML_DIRECTORY,
  escapeHtml,
  parseReportArgs,
  reportUsage,
} from "./report-html-common.js";

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

function collectDashboardPayload(): DashboardPayload {
  const db = getDb();
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
      `SELECT id, account_id, date, name, amount, kind, subcategory_id, created_at
       FROM transactions WHERE deleted_at IS NULL ORDER BY date, created_at`,
    )
    .all() as DashboardTransactionRow[];
  return { accounts, categories, subcategories, transactions };
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
var PALETTE=['#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e','#78716c','#64748b','#6b7280'];
var HEXRE=/^#[0-9a-fA-F]{6}$/;
function normColor(v){ if(v==null||v==='') return null; return (typeof v==='string'&&HEXRE.test(v))?v.toLowerCase():null; }
function colorIdx(id){ var h=0; for(var i=0;i<id.length;i++){ h=((h*31)+id.charCodeAt(i))>>>0; } return h%PALETTE.length; }
function entColor(id,c){ var n=normColor(c); return n==null?PALETTE[colorIdx(String(id))]:n; }
function esc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function fmt(n){ return Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function trunc(s){ s=String(s); return s.length>16?s.slice(0,16):s; }
function ink(hex){ var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return ((0.299*r+0.587*g+0.114*b)/255)>0.6?'#0f172a':'#ffffff'; }
function parseIso(s){ var p=String(s).split('-'); return new Date(Date.UTC(Number(p[0]),Number(p[1])-1,Number(p[2]))); }
function pad2(n){ return String(n).padStart(2,'0'); }
function toIso(d){ return d.getUTCFullYear()+'-'+pad2(d.getUTCMonth()+1)+'-'+pad2(d.getUTCDate()); }
function addMonths(d,n){ var day=d.getUTCDate(); var base=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1)); var dim=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,0)).getUTCDate(); base.setUTCDate(Math.min(day,dim)); return base; }
function diffDays(later,earlier){ function s(d){ return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()); } return Math.round((s(later)-s(earlier))/86400000); }
var MLAB=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
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
function clampStart(s){ if(!MIN_DATE) return s; return s<MIN_DATE?MIN_DATE:s; }
function computeAccounts(eff,end){
  return ACCOUNTS.map(function(a){
    var starting=Number(a.initial_balance)||0;
    var change=0;
    var rows=[];
    for(var i=0;i<SORTED.length;i++){
      var t=SORTED[i];
      if(t.account_id!==a.id) continue;
      if(t.date<eff){ starting+=t.amount; }
      else if(t.date<=end){ rows.push(t); change+=t.amount; }
    }
    var run=starting;
    var out=rows.map(function(t){
      run+=t.amount;
      var s=t.subcategory_id?subById[t.subcategory_id]:null;
      var c=s?catById[s.category_id]:null;
      return {id:t.id,date:t.date,name:t.name,amount:t.amount,run:run,sub:s?s.name:null,cat:c?c.name:null};
    });
    return {id:a.id,name:a.name,type:a.type,starting:starting,change:change,ending:starting+change,rows:out};
  });
}
function worthAt(end){
  var assets=0, liabs=0;
  for(var k=0;k<ACCOUNTS.length;k++){
    var a=ACCOUNTS[k]; var b=(Number(a.initial_balance)||0);
    for(var i=0;i<SORTED.length;i++){ var t=SORTED[i]; if(t.account_id===a.id&&t.date<=end) b+=t.amount; }
    if(a.type==='asset') assets+=b; else liabs+=b;
  }
  return {assets:assets,liabilities:liabs,net:assets-liabs};
}
function nwSeries(eff,end){
  var days=diffDays(parseIso(end),parseIso(eff));
  var g=days<28?'day':(days<180?'week':'month');
  var bs=bucketDates(eff,end,g);
  var bal={}; for(var k=0;k<ACCOUNTS.length;k++) bal[ACCOUNTS[k].id]=0;
  var pts=[]; var ti=0;
  for(var bi=0;bi<bs.length;bi++){
    var b=bs[bi];
    while(ti<SORTED.length&&SORTED[ti].date<=b){ var t=SORTED[ti]; if(bal[t.account_id]!==undefined) bal[t.account_id]+=t.amount; ti+=1; }
    var nw=0;
    for(k=0;k<ACCOUNTS.length;k++){ var a=ACCOUNTS[k]; var bl=(Number(a.initial_balance)||0)+bal[a.id]; if(a.type==='asset') nw+=bl; else nw-=bl; }
    var d=parseIso(b);
    var fl=g==='month'?(MLAB[d.getUTCMonth()]+' '+d.getUTCFullYear()):(MLAB[d.getUTCMonth()]+' '+d.getUTCDate());
    pts.push({date:b,formattedDate:fl,netWorth:nw});
  }
  return pts;
}
function nwSvg(pts){
  if(!pts.length) return '<p>No net-worth data.</p>';
  var W=720,H=220,pad=36;
  var vals=pts.map(function(p){return p.netWorth;});
  var mn=Math.min.apply(null,vals.concat([0]));
  var mx=Math.max.apply(null,vals.concat([0]));
  var span=(mx-mn)||1;
  var stepX=pts.length>1?(W-pad*2)/(pts.length-1):0;
  var coords=pts.map(function(p,i){ return {x:pad+stepX*i,y:H-pad-((p.netWorth-mn)/span)*(H-pad*2)}; });
  var line=coords.map(function(c,i){ return (i===0?'M':'L')+c.x.toFixed(1)+','+c.y.toFixed(1); }).join(' ');
  var area=line+' L'+(pad+stepX*(pts.length-1)).toFixed(1)+','+(H-pad)+' L'+pad+','+(H-pad)+' Z';
  var first=pts[0],last=pts[pts.length-1];
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Net worth over time" style="width:100%;height:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px">'
    +'<path d="'+esc(area)+'" fill="#dbeafe" stroke="none"/>'
    +'<path d="'+esc(line)+'" fill="none" stroke="#2563eb" stroke-width="2"/>'
    +'<text x="'+pad+'" y="20" font-size="12" fill="#475569">Net worth: '+esc(fmt(first.netWorth))+' to '+esc(fmt(last.netWorth))+'</text>'
    +'<text x="'+pad+'" y="'+(H-10)+'" font-size="11" fill="#64748b">'+esc(first.formattedDate)+'</text>'
    +'<text x="'+(W-pad-80)+'" y="'+(H-10)+'" font-size="11" fill="#64748b">'+esc(last.formattedDate)+'</text></svg>';
}
function sankeyModel(eff,end){
  var inc={},exp={};
  for(var i=0;i<SORTED.length;i++){
    var t=SORTED[i];
    if(t.date<eff||t.date>end||!t.subcategory_id) continue;
    var s=subById[t.subcategory_id]; if(!s) continue;
    var c=catById[s.category_id]; if(!c) continue;
    var key=c.id+'|'+s.id;
    if(t.kind==='income'&&c.type==='income'){
      if(!inc[key]) inc[key]={catId:c.id,catName:c.name,catColor:c.color,subId:s.id,subName:s.name,subColor:s.color,total:0};
      inc[key].total+=t.amount;
    } else if(t.kind==='expense'&&c.type==='expense'){
      if(!exp[key]) exp[key]={catId:c.id,catName:c.name,catColor:c.color,subId:s.id,subName:s.name,subColor:s.color,total:0};
      exp[key].total+=Math.abs(t.amount);
    }
  }
  function vals(o){ return Object.keys(o).map(function(k){return o[k];}).filter(function(r){return r.total>0;}).sort(function(a,b){return b.total-a.total;}); }
  var incRows=vals(inc),expRows=vals(exp);
  var nodes=[],seen={},links=[];
  function ensure(id,color,disp){ if(!seen[id]){ seen[id]=true; if(disp===undefined) nodes.push({id:id,nodeColor:color}); else nodes.push({id:id,displayName:disp,nodeColor:color}); } }
  var totalIncome=0,totalExpenses=0;
  var incCatTot={},incOrder=[];
  incRows.forEach(function(r){ totalIncome+=r.total; var cid='income-category:'+r.catId; if(!incCatTot[cid]){ incCatTot[cid]={name:r.catName,total:0}; incOrder.push(cid); } incCatTot[cid].total+=r.total; });
  var expCatTot={},expOrder=[];
  expRows.forEach(function(r){ totalExpenses+=r.total; var cid='expense-category:'+r.catId; if(!expCatTot[cid]){ expCatTot[cid]={name:r.catName,total:0}; expOrder.push(cid); } expCatTot[cid].total+=r.total; });
  ensure('Total Income','#676767');
  ensure('Total Expenses','#676767');
  incRows.forEach(function(r){
    var sub=''+r.subName+' (income)',cid='income-category:'+r.catId;
    ensure(sub,entColor(r.subId,r.subColor),r.subName);
    ensure(cid,entColor(r.catId,r.catColor),r.catName);
    links.push({source:sub,target:cid,value:r.total});
  });
  incOrder.forEach(function(cid){ links.push({source:cid,target:'Total Income',value:incCatTot[cid].total}); });
  var flow=Math.min(totalIncome,totalExpenses);
  if(flow>0) links.push({source:'Total Income',target:'Total Expenses',value:flow});
  var savings=0;
  if(totalIncome>totalExpenses){
    savings=totalIncome-totalExpenses;
    ensure('Savings','#090088');
    links.push({source:'Total Income',target:'Savings',value:savings});
  }
  var expRowByCat={};
  expRows.forEach(function(r){ expRowByCat['expense-category:'+r.catId]=r; });
  expOrder.forEach(function(cid){
    var cr=expRowByCat[cid];
    ensure(cid,cr?entColor(cr.catId,cr.catColor):'#6b3434',expCatTot[cid].name);
    links.push({source:'Total Expenses',target:cid,value:expCatTot[cid].total});
  });
  expRows.forEach(function(r){
    var sub=''+r.subName+' (expense)',cid='expense-category:'+r.catId;
    ensure(sub,entColor(r.subId,r.subColor),r.subName);
    links.push({source:cid,target:sub,value:r.total});
  });
  return {nodes:nodes,links:links,totalIncome:totalIncome,totalExpenses:totalExpenses,savings:savings,incRows:incRows,expRows:expRows,incCatTot:incCatTot,expCatTot:expCatTot};
}
function sankeyCol(id){
  if(id==='Total Income'||id==='Total Expenses'||id==='Savings') return 2;
  if(id.slice(-9)===' (income)') return 0;
  if(id.indexOf('income-category:')===0) return 1;
  if(id.indexOf('expense-category:')===0) return 3;
  return 4;
}
function sankeySvg(m){
  if(!m.links.length) return '<p>No flow data.</p>';
  var V={};
  m.incRows.forEach(function(r){ V[''+r.subName+' (income)']=r.total; });
  Object.keys(m.incCatTot).forEach(function(k){ V[k]=m.incCatTot[k].total; });
  V['Total Income']=m.totalIncome; V['Total Expenses']=m.totalExpenses;
  if(m.savings>0) V['Savings']=m.savings;
  m.expRows.forEach(function(r){ V[''+r.subName+' (expense)']=r.total; });
  Object.keys(m.expCatTot).forEach(function(k){ V[k]=m.expCatTot[k].total; });
  var NC={};
  m.nodes.forEach(function(n){ NC[n.id]=n.nodeColor; });
  var W=960,nodeW=140,top=28,bot=28;
  var colX=[8,204,410,616,812];
  var cols=[[],[],[],[],[]];
  m.nodes.forEach(function(n){ cols[sankeyCol(n.id)].push(n); });
  var maxN=1,ci;
  cols.forEach(function(c){ if(c.length>maxN) maxN=c.length; });
  var H=Math.max(360,28*maxN+60);
  var colH=H-top-bot;
  var maxTot=1;
  cols.forEach(function(c){ var s=0; for(var i=0;i<c.length;i++) s+=(V[c[i].id]||0); if(s>maxTot) maxTot=s; });
  var usable=colH-(maxN-1)*6; if(usable<60) usable=60;
  var scale=usable/maxTot;
  var pos={};
  cols.forEach(function(c2){
    var y=top;
    c2.forEach(function(n){
      var h=Math.max(18,(V[n.id]||0)*scale);
      pos[n.id]={x:colX[ci2(c2)],y:y,h:h};
      y+=h+6;
    });
  });
  function ci2(c2){ for(var k=0;k<cols.length;k++){ if(cols[k]===c2) return k; } return 0; }
  var out='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Income and expense flows" style="width:100%;height:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px">';
  m.links.forEach(function(l){
    var a=pos[l.source],b=pos[l.target]; if(!a||!b) return;
    var w=Math.max(1,l.value*scale);
    var col=NC[l.source]||'#64748b';
    if(sankeyCol(l.source)===2&&sankeyCol(l.target)===2){
      var x=a.x+nodeW/2,y1=a.y+a.h,y2=b.y;
      out+='<path d="M '+x+','+y1+' C '+x+','+(y1+18)+' '+x+','+(y2-18)+' '+x+','+y2+'" fill="none" stroke="'+col+'" stroke-width="'+w+'" opacity="0.35"/>';
    } else {
      var x1=a.x+nodeW,y1b=a.y+a.h/2,x2=b.x,y2b=b.y+b.h/2,mx=(x1+x2)/2;
      out+='<path d="M '+x1+','+y1b+' C '+mx+','+y1b+' '+mx+','+y2b+' '+x2+','+y2b+'" fill="none" stroke="'+col+'" stroke-width="'+w+'" opacity="0.35"/>';
    }
  });
  m.nodes.forEach(function(n){
    var p=pos[n.id]; if(!p) return;
    var label=n.displayName!==undefined?n.displayName:n.id;
    out+='<g><rect x="'+p.x+'" y="'+p.y+'" width="'+nodeW+'" height="'+p.h+'" rx="4" fill="'+n.nodeColor+'"><title>'+esc(label)+' — '+esc(fmt(V[n.id]||0))+'</title></rect>';
    out+='<text x="'+(p.x+8)+'" y="'+(p.y+Math.min(p.h/2+4,p.h-5))+'" font-size="11" fill="'+ink(n.nodeColor)+'">'+esc(trunc(label))+'</text></g>';
  });
  return out+'</svg>';
}
function catLabel(r){ if(r.cat&&r.sub) return r.cat+' › '+r.sub; if(r.sub) return r.sub; if(r.cat) return r.cat; return '—'; }
function txnTable(a,q){
  var rows=a.rows,ql=String(q||'').toLowerCase(),filt=rows;
  if(ql) filt=rows.filter(function(r){ return r.name.toLowerCase().indexOf(ql)>=0||(r.sub&&r.sub.toLowerCase().indexOf(ql)>=0)||(r.cat&&r.cat.toLowerCase().indexOf(ql)>=0); });
  var shown=filt.slice(0,500);
  var h='<table><thead><tr><th>Date</th><th>Name</th><th>Category</th><th>Amount</th><th>Balance</th></tr></thead><tbody>';
  for(var i=0;i<shown.length;i++){ var r=shown[i]; h+='<tr><td>'+esc(r.date)+'</td><td>'+esc(r.name)+'</td><td>'+esc(catLabel(r))+'</td><td>'+esc(fmt(r.amount))+'</td><td>'+esc(fmt(r.run))+'</td></tr>'; }
  h+='</tbody></table>';
  if(filt.length>shown.length) h+='<p>Showing '+shown.length+' of '+filt.length+' matching transactions.</p>';
  else if(ql) h+='<p>Showing '+filt.length+' of '+rows.length+' transactions.</p>';
  return h;
}
var openAccts={},searchQ={},LAST=null;
function accountsHtml(list,w){
  var sS=0,sC=0,sE=0,i,a;
  var h='<table><thead><tr><th>Account</th><th>Type</th><th>Starting</th><th>Change</th><th>Ending</th></tr></thead><tbody>';
  for(i=0;i<list.length;i++){ a=list[i]; sS+=a.starting; sC+=a.change; sE+=a.ending; h+='<tr><td>'+esc(a.name)+'</td><td>'+esc(a.type)+'</td><td>'+esc(fmt(a.starting))+'</td><td>'+esc(fmt(a.change))+'</td><td>'+esc(fmt(a.ending))+'</td></tr>'; }
  h+='</tbody><tfoot><tr><td><strong>Total</strong></td><td></td><td><strong>'+esc(fmt(sS))+'</strong></td><td><strong>'+esc(fmt(sC))+'</strong></td><td><strong>'+esc(fmt(sE))+'</strong></td></tr></tfoot></table>';
  h+='<p>Assets '+esc(fmt(w.assets))+' · Liabilities '+esc(fmt(w.liabilities))+' · Net worth '+esc(fmt(w.net))+'</p>';
  for(i=0;i<list.length;i++){
    a=list[i];
    var open=openAccts[a.id]?' open':'';
    h+='<details data-acct="'+esc(a.id)+'"'+open+'><summary>'+esc(a.name)+' — '+esc(fmt(a.starting))+' to '+esc(fmt(a.ending))+' ('+a.rows.length+' transactions)</summary>';
    h+='<input type="search" data-search="'+esc(a.id)+'" placeholder="Filter transactions..." value="'+esc(searchQ[a.id]||'')+'" aria-label="Filter '+esc(a.name)+' transactions">';
    h+='<div data-txns="'+esc(a.id)+'">'+txnTable(a,searchQ[a.id]||'')+'</div></details>';
  }
  return h;
}
function bindDynamic(){
  var ds=document.querySelectorAll('details[data-acct]'),i;
  for(i=0;i<ds.length;i++){
    (function(d){ d.addEventListener('toggle',function(){ var id=d.getAttribute('data-acct'); if(d.open) openAccts[id]=true; else delete openAccts[id]; }); })(ds[i]);
  }
  var ins=document.querySelectorAll('input[data-search]');
  for(i=0;i<ins.length;i++){
    (function(inp){ inp.addEventListener('input',function(){
      var id=inp.getAttribute('data-search');
      searchQ[id]=inp.value;
      var host=document.querySelector('div[data-txns="'+id+'"]');
      if(host&&LAST){ for(var k=0;k<LAST.length;k++){ if(LAST[k].id===id){ host.innerHTML=txnTable(LAST[k],inp.value||''); break; } } }
    }); })(ins[i]);
  }
}
function renderAll(){
  var si=document.getElementById('ds-start'),ei=document.getElementById('ds-end'),er=document.getElementById('range-error');
  var s=si?si.value:'',e=ei?ei.value:'';
  if(!s||!e||s>e){ if(er) er.textContent='Invalid range: start must be on or before end.'; return; }
  if(er) er.textContent='';
  var eff=clampStart(s);
  var list=computeAccounts(eff,e);
  LAST=list;
  var w=worthAt(e);
  var pts=nwSeries(eff,e);
  var sk=sankeyModel(eff,e);
  document.getElementById('accounts').innerHTML=accountsHtml(list,w);
  document.getElementById('networth').innerHTML=nwSvg(pts);
  document.getElementById('sankey').innerHTML=sankeySvg(sk);
  bindDynamic();
}
function setPreset(p){
  var si=document.getElementById('ds-start'),ei=document.getElementById('ds-end');
  var e=ei.value||toIso(new Date());
  var s=e;
  if(p==='3M') s=toIso(addMonths(parseIso(e),-3));
  else if(p==='6M') s=toIso(addMonths(parseIso(e),-6));
  else if(p==='1Y') s=toIso(addMonths(parseIso(e),-12));
  else if(p==='YTD') s=e.slice(0,4)+'-01-01';
  else if(p==='ALL') s=MIN_DATE||e;
  si.value=s; ei.value=e;
  renderAll();
}
document.addEventListener('DOMContentLoaded',function(){
  var si=document.getElementById('ds-start'),ei=document.getElementById('ds-end');
  if(si) si.addEventListener('change',renderAll);
  if(ei) ei.addEventListener('change',renderAll);
  var btns=document.querySelectorAll('button[data-preset]');
  for(var i=0;i<btns.length;i++){ (function(b){ b.addEventListener('click',function(){ setPreset(b.getAttribute('data-preset')); }); })(btns[i]); }
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
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
main{max-width:1000px;margin:0 auto;padding:24px}
header.page{margin-bottom:16px}
.controls{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:12px 0}
.controls label{margin-right:12px}
.controls button{margin:4px 4px 4px 0;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#f1f5f9;cursor:pointer}
#range-error{color:#dc2626;min-height:1.2em}
table{width:100%;border-collapse:collapse;background:#fff;margin:12px 0;font-size:.9rem}
th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left}
th{background:#f1f5f9}
tfoot td{background:#f8fafc}
input[type=search],input[type=date]{padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;margin:6px 0}
input[type=search]{width:100%;box-sizing:border-box}
details{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:12px 0}
details>summary{cursor:pointer;font-weight:700}
h2{margin-top:28px}
</style>
</head>
<body>
<main>
<header class="page">
<h1>Dashboard</h1>
<p><strong>Default view:</strong> ${escapeHtml(start)} to ${escapeHtml(end)} · <strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
<p>Full history is embedded below; change the dates to re-render instantly. No network needed.</p>
</header>
<noscript><p>This report needs JavaScript enabled.</p></noscript>
<section class="controls">
<label>Start <input type="date" id="ds-start" value="${escapeHtml(start)}"></label>
<label>End <input type="date" id="ds-end" value="${escapeHtml(end)}"></label>
<span>
<button type="button" data-preset="3M">3M</button>
<button type="button" data-preset="6M">6M</button>
<button type="button" data-preset="YTD">YTD</button>
<button type="button" data-preset="1Y">1Y</button>
<button type="button" data-preset="ALL">All</button>
</span>
<p id="range-error" role="alert"></p>
</section>
<section>
<h2>Accounts</h2>
<div id="accounts"></div>
</section>
<section>
<h2>Net worth</h2>
<div id="networth"></div>
</section>
<section>
<h2>Flows</h2>
<div id="sankey"></div>
</section>
</main>
<script type="application/json" id="dashboard-data">${json}</script>
<script>
${PAGE_JS}
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
      : path.join(REPORT_HTML_DIRECTORY, `dashboard-${start}-${end}.html`);
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
