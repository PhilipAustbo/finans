
// ------- Storage Helpers (IndexedDB for transactions & snapshots, localStorage for settings) -------
const DB_NAME = 'portfolioDB';
const DB_VER = 1;
let db;
function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains('transactions')){
        const os = d.createObjectStore('transactions', {keyPath:'id', autoIncrement:true});
        os.createIndex('bySymbol','symbol',{unique:false});
        os.createIndex('byDate','date',{unique:false});
      }
      if(!d.objectStoreNames.contains('snapshots')){
        const ss = d.createObjectStore('snapshots', {keyPath:'ts'}); // ts ISO string
      }
    };
    req.onsuccess = ()=>{ db = req.result; resolve(); };
    req.onerror = ()=>reject(req.error);
  });
}
function idb(store, mode='readonly'){ return db.transaction(store, mode).objectStore(store) }
function addTx(tx){ return new Promise((res,rej)=>{ const r=idb('transactions','readwrite').add(tx); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }) }
function getAll(store){ return new Promise((res,rej)=>{ const r=idb(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }) }
function putSnapshot(s){ return new Promise((res,rej)=>{ const r=idb('snapshots','readwrite').put(s); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }) }
function clearStore(name){ return new Promise((res,rej)=>{ const r=idb(name,'readwrite').clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }) }

// ------- Settings -------
const Settings = {
  get(){
    const s = JSON.parse(localStorage.getItem('pf_settings')||'{}');
    return Object.assign({ provider:'alphavantage', apiKey:'', refreshSec:60, startingCash:100000 }, s);
  },
  set(p){ localStorage.setItem('pf_settings', JSON.stringify(p)); }
}

// ------- Pricing Provider (Alpha Vantage: GLOBAL_QUOTE) -------
async function fetchQuoteAlphaVantage(symbol, apiKey){
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url);
  if(!resp.ok) throw new Error('Network error');
  const data = await resp.json();
  const q = data['Global Quote'] || {};
  const price = parseFloat(q['05. price']);
  const prevClose = parseFloat(q['08. previous close']);
  if(!price) throw new Error('No price for '+symbol);
  return { price, prevClose: isNaN(prevClose)? null : prevClose };
}

async function fetchQuotes(symbols){
  const {provider, apiKey} = Settings.get();
  const out = {};
  if(provider==='alphavantage'){
    const throttle = 13000; // ~5/min safety
    for(let i=0;i<symbols.length;i++){
      const s = symbols[i];
      try{
        out[s] = await fetchQuoteAlphaVantage(s, apiKey);
      }catch(err){ console.warn('Quote error', s, err.message); }
      if(i<symbols.length-1) await new Promise(r=>setTimeout(r, throttle));
    }
  }
  return out;
}

// ------- Portfolio Engine -------
function computeHoldings(transactions){
  const lots = {}; // symbol -> {qty, cost, avgCost}
  transactions.sort((a,b)=> new Date(a.date) - new Date(b.date));
  for(const t of transactions){
    const s = t.symbol.toUpperCase();
    lots[s] = lots[s] || { qty:0, cost:0 };
    const sign = t.side==='BUY' ? 1 : -1;
    const qtyBefore = lots[s].qty;
    lots[s].qty += sign * t.qty;
    const price = t.price;
    if(t.side==='BUY'){
      lots[s].cost += t.qty * price;
    } else {
      // Reduce cost basis proportionally (simple average method)
      const avg = qtyBefore>0 ? (lots[s].cost/qtyBefore) : 0;
      lots[s].cost -= Math.min(qtyBefore, t.qty) * avg;
    }
    if (Math.abs(lots[s].qty) < 1e-9) { lots[s].qty=0; lots[s].cost=0; }
  }
  const holdings = Object.entries(lots)
    .filter(([_,v])=> v.qty>0)
    .map(([symbol,v])=>({ symbol, qty:v.qty, avgCost: v.qty? v.cost/v.qty:0 }));
  return holdings;
}

function computeCash(transactions, starting=100000){
  let cash = starting;
  for(const t of transactions){
    const sign = t.side==='BUY' ? -1 : 1;
    cash += sign * (t.qty * t.price);
  }
  return cash;
}

// ------- UI & App Logic -------
let CHART;
async function render(){
  const settings = Settings.get();
  document.querySelector('#refreshLabel').textContent = `refresh ${settings.refreshSec}s`;
  document.querySelector('#startingCash').value = settings.startingCash;

  const tx = await getAll('transactions');
  const holdings = computeHoldings(tx);
  const symbols = holdings.map(h=>h.symbol);

  // Get quotes (skip if no API key)
  let quotes = {};
  if(settings.apiKey && symbols.length){
    quotes = await fetchQuotes(symbols);
  }

  // Build holdings table
  const tbody = document.querySelector('#holdingsTable tbody');
  tbody.innerHTML = '';
  let totalValue = 0, totalCost = 0, dayChangeValue=0;
  for(const h of holdings){
    const q = quotes[h.symbol];
    const last = q? q.price : h.avgCost;
    const prev = q? (q.prevClose ?? last) : last;
    const value = h.qty * last;
    totalValue += value;
    totalCost += h.qty * h.avgCost;
    dayChangeValue += h.qty * (last - prev);

    const pl = value - (h.qty * h.avgCost);
    const plPct = (pl / (h.qty * h.avgCost)) * 100;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${h.symbol}</td>
      <td>${formatNum(h.qty)}</td>
      <td>${formatMoney(h.avgCost)}</td>
      <td>${q? formatMoney(last): `<span class="muted">n/a</span>`}</td>
      <td>${formatMoney(value)}</td>
      <td class="${pl>=0?'gain':'loss'}">${fmtSignedMoney(pl)}</td>
      <td class="${pl>=0?'gain':'loss'}">${(isFinite(plPct)? plPct:0).toFixed(2)}%</td>
      <td><button class="ghost" onclick="sellAllAtMarket('${h.symbol}')">Sell All @Mkt</button></td>
    `;
    tbody.appendChild(tr);
  }

  const cash = computeCash(tx, settings.startingCash);
  const portValue = cash + totalValue;
  document.querySelector('#k_value').textContent = formatMoney(portValue);
  document.querySelector('#k_pl').textContent = fmtSignedMoney(totalValue - totalCost);
  document.querySelector('#k_cash').textContent = formatMoney(cash);
  document.querySelector('#k_day').textContent = fmtSignedMoney(dayChangeValue);

  // Timeline
  const tWrap = document.querySelector('#timeline');
  tWrap.innerHTML='';
  document.querySelector('#txCount').textContent = `${tx.length} transaction${tx.length===1?'':'s'}`;
  for(const t of tx.sort((a,b)=> new Date(b.date) - new Date(a.date))){
    const when = new Date(t.date).toLocaleString();
    const item = document.createElement('div');
    item.className='titem';
    item.innerHTML = `
      <div class="muted">${when}</div>
      <div>
        <h4>${t.side} ${t.qty} ${t.symbol} @ ${formatMoney(t.price)}</h4>
        ${t.notes? `<div class="muted">${escapeHtml(t.notes)}</div>`:''}
      </div>`;
    tWrap.appendChild(item);
  }

  // Chart
  const snaps = await getAll('snapshots');
  const labels = snaps.map(s=> new Date(s.ts));
  const data = snaps.map(s=> s.value);
  if(!CHART){
    const ctx = document.getElementById('chart').getContext('2d');
    CHART = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[{ label:'Portfolio Value', data, tension:.25 }] },
      options:{
        responsive:true,
        plugins:{ legend:{ display:false } },
        scales:{ x:{ ticks:{ color:'#9aa4b2' } }, y:{ ticks:{ color:'#9aa4b2' } } }
      }
    });
  } else {
    CHART.data.labels = labels; CHART.data.datasets[0].data = data; CHART.update();
  }

  // take lightweight snapshot (no quotes? still snapshot)
  await putSnapshot({ ts: new Date().toISOString(), value: portValue });
}

async function sellAllAtMarket(symbol){
  const settings = Settings.get();
  const apiKey = settings.apiKey;
  let price = 0;
  try{
    if(apiKey){ const q = await fetchQuotes([symbol]); price = q[symbol]?.price || 0; }
  }catch{ /* ignore */ }
  if(!price){ alert('No market price available. Enter a manual price.'); return; }
  const tx = await getAll('transactions');
  const holdings = computeHoldings(tx);
  const h = holdings.find(x=>x.symbol===symbol);
  if(!h) return;
  await addTx({ symbol, side:'SELL', qty:h.qty, price, date:new Date().toISOString(), notes:'Sell all @ market (quick)' });
  await render();
}

// ------- Event Handlers -------
document.querySelector('#addTx').addEventListener('click', async ()=>{
  const side = document.querySelector('#side').value;
  const symbol = document.querySelector('#symbol').value.trim().toUpperCase();
  const qty = parseFloat(document.querySelector('#qty').value);
  let price = parseFloat(document.querySelector('#price').value);
  const date = document.querySelector('#date').value ? new Date(document.querySelector('#date').value).toISOString() : new Date().toISOString();
  if(!symbol || !qty){ alert('Symbol and quantity are required'); return; }

  if(!price){
    const s = Settings.get();
    if(!s.apiKey){ alert('No API key set. Enter a price or add an API key in Settings.'); return; }
    try{
      const q = await fetchQuotes([symbol]);
      price = q[symbol]?.price;
    }catch(e){ console.error(e); }
    if(!price){ alert('Could not fetch market price. Enter a manual price.'); return; }
  }

  await addTx({ symbol, side, qty, price, date });
  document.querySelector('#txForm').reset();
  await render();
});

document.querySelector('#exportCSV').addEventListener('click', async ()=>{
  const tx = await getAll('transactions');
  const snaps = await getAll('snapshots');
  const txCsv = ['id,date,side,symbol,qty,price,notes'];
  tx.forEach(t=> txCsv.push([t.id,t.date,t.side,t.symbol,t.qty,t.price,JSON.stringify(t.notes||'')].join(',')));
  const sCsv = ['ts,value']; snaps.forEach(s=> sCsv.push([s.ts,s.value].join(',')));
  const blob = new Blob([`Transactions\n${txCsv.join('\n')}\n\nSnapshots\n${sCsv.join('\n')}`],{type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='portfolio_export.csv'; a.click();
});

document.querySelector('#snapshotNow').addEventListener('click', async ()=>{
  const settings = Settings.get();
  const tx = await getAll('transactions');
  const holdings = computeHoldings(tx);
  const symbols = holdings.map(h=>h.symbol);
  let quotes={};
  if(settings.apiKey && symbols.length){ quotes = await fetchQuotes(symbols); }
  let total= computeCash(tx, settings.startingCash);
  for(const h of holdings){ const last = quotes[h.symbol]?.price || h.avgCost; total += h.qty * last; }
  await putSnapshot({ ts: new Date().toISOString(), value: total });
  await render();
});

// Settings modal
const settingsEl = document.querySelector('#settings');
document.querySelector('#openSettings').addEventListener('click', ()=> settingsEl.classList.add('active'));
document.querySelector('#closeSettings').addEventListener('click', ()=> settingsEl.classList.remove('active'));
document.querySelector('#saveSettings').addEventListener('click', ()=>{
  const refreshSec = parseInt(document.querySelector('#refreshInt').value)||60;
  const startingCash = parseFloat(document.querySelector('#startingCash').value)||100000;
  Settings.set({ provider: document.querySelector('#provider').value, apiKey: document.querySelector('#apiKey').value.trim(), refreshSec, startingCash });
  settingsEl.classList.remove('active');
  boot();
});
document.querySelector('#resetAll').addEventListener('click', async ()=>{
  if(!confirm('This will delete all transactions and snapshots (keeps settings). Continue?')) return;
  await clearStore('transactions');
  await clearStore('snapshots');
  await render();
});

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]) ) }
const formatMoney = (n)=> new Intl.NumberFormat(undefined,{style:'currency', currency:'USD', maximumFractionDigits:2}).format(n||0);
const fmtSignedMoney = (n)=> `${n>=0?'+':''}${formatMoney(n||0)}`;
const formatNum = (n)=> new Intl.NumberFormat(undefined,{maximumFractionDigits:4}).format(n||0);

let refreshTimer;
async function boot(){
  clearInterval(refreshTimer);
  const s = Settings.get();
  document.querySelector('#apiKey').value = s.apiKey || '';
  document.querySelector('#refreshInt').value = s.refreshSec;
  document.querySelector('#provider').value = s.provider;
  document.querySelector('#startingCash').value = s.startingCash;

  await render();
  document.querySelector('#statusDot').style.color = '#ffd166';
  refreshTimer = setInterval(async ()=>{
    document.querySelector('#statusDot').style.color = '#ffd166';
    await render();
    document.querySelector('#statusDot').style.color = '#22c55e';
  }, Math.max(15000, (s.refreshSec||60)*1000));
  document.querySelector('#statusDot').style.color = '#22c55e';
}

openDB().then(boot);