import https from 'https';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://coffee-erp-git.pages.dev';
function req(path, opts={}) {
  return new Promise((res, rej) => {
    const o = { method: opts.method||'GET', headers: { 'User-Agent': UA, ...(opts.headers||{}) } };
    const r = https.request(BASE+path, o, (resp)=>{ let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>res({status:resp.statusCode,body:d})); });
    r.on('error', rej); if(opts.body) r.write(opts.body); r.end();
  });
}
const HQ_U='hq', HQ_P='199699';
const login = await req('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:HQ_U, password:HQ_P})});
console.log('LOGIN status:', login.status, 'body:', login.body.slice(0,200));
const tk = (JSON.parse(login.body).token)||'';
const base = await req('/api/bs?scope=base', {headers:{'Authorization':'Bearer '+tk}});
const data = JSON.parse(base.body);
const mats = data.materials || [];
console.log('物料总数:', mats.length);
const milk = mats.filter(m => /奶|乳|牛|milk|明治|味全|光明|鲜|箱/.test(m.name||'') || (m.pack_unit||'')==='箱');
console.log('--- 匹配 ---');
for (const m of milk) console.log(JSON.stringify({id:m.id,name:m.name,unit:m.unit,pack_unit:m.pack_unit,pack_qty:m.pack_qty,pack_price:m.pack_price,stk_unit:m.stk_unit,stk_qty:m.stk_qty,min_order:m.min_order}));
