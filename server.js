// Purple Store backend: gateway key sirf yahan rehti hai (browser me kabhi nahi)
const express=require('express'),fs=require('fs'),crypto=require('crypto');
const {GRAM_KEY,ADMIN_PASS,PORT=3000}=process.env;
if(!GRAM_KEY||!ADMIN_PASS){console.error('GRAM_KEY aur ADMIN_PASS env set karo');process.exit(1)}
const BASE='https://gateway.anujbots.in/',F='db.json',RES_PRICE=299,RES_OFF=30;
const mk=()=>'PS-'+crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g).join('-');
const SEED=[
 {id:1,n:'Starter Key',d:'Chhota aur sasta plan',pl:[['12 Hours',49],['1 Day',99],['3 Days',249]],t:''},
 {id:2,n:'Pro Key',d:'Fast aur stable access',pl:[['12 Hours',79],['1 Day',149],['3 Days',349]],t:''},
 {id:3,n:'Ultra Key',d:'Full premium access',pl:[['1 Day',199],['3 Days',449],['7 Days',899]],t:''}];
let db=fs.existsSync(F)?JSON.parse(fs.readFileSync(F)):{accounts:{},sessions:{},topups:{},utr:{},products:SEED,stock:{}};
db.accounts=db.accounts||{};db.sessions=db.sessions||{};
const save=()=>{fs.writeFileSync(F+'.tmp',JSON.stringify(db));fs.renameSync(F+'.tmp',F)};
const log=(...a)=>console.log(new Date().toISOString(),...a);
const hits={};const limit=(n,ms)=>(q,r,nx)=>{const k=q.ip+q.path,t=Date.now(),a=(hits[k]||[]).filter(x=>t-x<ms);if(a.length>=n)return r.status(429).json({error:'Bahut tez, thoda ruko'});a.push(t);hits[k]=a;nx()};
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'20kb'}));
app.use((q,r,nx)=>{r.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});nx()});
app.use(express.static('public'));
const auth=(q,r,nx)=>{const t=q.get('x-token')||'',s=Object.hasOwn(db.sessions,t)&&db.sessions[t],u=s&&s.exp>Date.now()&&db.accounts[s.u];if(!u)return r.status(401).json({error:'login'});q.u=u;q.name=s.u;nx()};
const price=(u,x)=>u.res?Math.round(x*(100-RES_OFF)/100):x;
const gram=async(p,params)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),8000);
 try{return await (await fetch(BASE+p+'?'+new URLSearchParams({api_key:GRAM_KEY,...params}),{signal:c.signal})).json()}finally{clearTimeout(t)}};

// ---- robot verification (self-hosted math captcha) + accounts ----
const caps={},humans={};
const sweep=()=>{const t=Date.now();for(const k in caps)if(caps[k].e<t)delete caps[k];for(const k in humans)if(humans[k]<t)delete humans[k]};
app.get('/api/captcha',limit(20,60000),(q,r)=>{sweep();const a=1+crypto.randomInt(9),b=1+crypto.randomInt(9),o=['+','-','x'][crypto.randomInt(3)],id=crypto.randomBytes(8).toString('hex');
 caps[id]={ans:o=='+'?a+b:o=='-'?a-b:a*b,e:Date.now()+120000};r.json({id,q:a+' '+o+' '+b})});
app.post('/api/verify',limit(15,60000),(q,r)=>{const id=String(q.body.id),c=Object.hasOwn(caps,id)&&caps[id];delete caps[id];
 if(!c||c.e<Date.now()||String(c.ans)!==String(q.body.ans).trim())return r.status(400).json({error:'Jawab galat hai, dobara try karo'});
 const h=crypto.randomBytes(16).toString('hex');humans[h]=Date.now()+1800000;r.json({human:h})});
const human=(q,r,nx)=>{const h=q.get('x-human')||'';if(!(Object.hasOwn(humans,h)&&humans[h]>Date.now()))return r.status(403).json({error:'Pehle robot verification karo'});nx()};
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const sess=u=>{const t=crypto.randomBytes(24).toString('hex');db.sessions[t]={u,exp:Date.now()+30*864e5};save();return t};
app.post('/api/signup',limit(5,60000),human,(q,r)=>{const u=String(q.body.username||'').toLowerCase(),p=String(q.body.password||'');
 if(!/^[a-z0-9_]{3,20}$/.test(u))return r.status(400).json({error:'Username 3-20 letters/numbers/_ ka rakho'});
 if(p.length<6||p.length>100)return r.status(400).json({error:'Password kam se kam 6 character ka rakho'});
 if(Object.hasOwn(db.accounts,u))return r.status(409).json({error:'Ye username le liya gaya hai'});
 const s=crypto.randomBytes(16).toString('hex');db.accounts[u]={s,h:hash(p,s),wal:0,res:false,orders:[]};log('signup',u);r.json({token:sess(u),username:u})});
app.post('/api/login',limit(8,60000),human,(q,r)=>{const u=String(q.body.username||'').toLowerCase(),a=Object.hasOwn(db.accounts,u)&&db.accounts[u];
 if(!a||!crypto.timingSafeEqual(Buffer.from(hash(String(q.body.password||''),a.s)),Buffer.from(a.h))){log('bad login',u);return r.status(401).json({error:'Username ya password galat'})}
 r.json({token:sess(u),username:u})});
app.post('/api/logout',(q,r)=>{delete db.sessions[q.get('x-token')];save();r.json({})});
app.get('/api/products',(q,r)=>r.json({products:db.products,resPrice:RES_PRICE,resOff:RES_OFF}));
app.get('/api/me',auth,(q,r)=>r.json({wal:q.u.wal,res:q.u.res,orders:q.u.orders}));

app.post('/api/topup',limit(5,60000),auth,async(q,r)=>{
 const a=Number(q.body.amount);if(!(a>=1&&a<=10000)||Math.round(a*100)!==a*100)return r.status(400).json({error:'Amount 1 se 10000 ke beech daalo'});
 try{const j=await gram('autoqr.php',{amount:a.toFixed(2),note:'wallet topup'});
  if(j.status!=='success')throw new Error(j.message);const d=j.data;
  db.topups[d.order_id]={user:q.name,amount:a,done:false,t:Date.now()};save();
  log('topup created',d.order_id,a);
  r.json({order_id:d.order_id,qr_url:d.qr_url,amount:d.amount,payment_url:d.payment_url,seconds:d.valid_seconds})
 }catch(e){log('qr error',e.message);r.status(502).json({error:'Gateway abhi available nahi'})}});

app.get('/api/topup/:id',limit(30,60000),auth,async(q,r)=>{
 const t=db.topups[q.params.id];if(!t||t.user!==q.name)return r.status(404).json({error:'Order nahi mila'});
 if(t.done)return r.json({status:'PAID',wal:q.u.wal});
 try{const j=await gram('autoverify.php',{order_id:q.params.id}),d=j.data||{};
  if(t.done)return r.json({status:'PAID',wal:q.u.wal});
  if(d.status==='PAID'&&d.order_id===q.params.id&&!(d.utr&&db.utr[d.utr])){
   t.done=true;if(d.utr)db.utr[d.utr]=q.params.id;q.u.wal+=t.amount;save();log('credited',q.params.id,t.amount);
   return r.json({status:'PAID',wal:q.u.wal})}
  r.json({status:d.status||'PENDING'})
 }catch(e){r.json({status:'PENDING'})}});

app.post('/api/buy',limit(10,60000),auth,(q,r)=>{
 const p=db.products.find(x=>x.id==q.body.pid),x=p&&p.pl.find(y=>y[0]===q.body.plan);
 if(!x)return r.status(400).json({error:'Plan nahi mila'});
 const c=price(q.u,x[1]),k=p.id+'|'+x[0],s=db.stock[k]||[];
 if(q.u.wal<c)return r.status(402).json({error:'Balance kam hai',need:c});
 if(!s.length)return r.status(409).json({error:'Is plan ki keys stock mein nahi hain'});
 const key=s.shift();db.stock[k]=s;q.u.wal-=c;q.u.orders.unshift({n:p.n,d:x[0],p:c,k:key,t:Date.now()});save();
 log('buy',p.n,x[0],c);r.json({wal:q.u.wal,orders:q.u.orders})});

app.post('/api/reseller',auth,(q,r)=>{
 if(q.u.res)return r.json({wal:q.u.wal,res:true});
 if(q.u.wal<RES_PRICE)return r.status(402).json({error:'Balance kam hai',need:RES_PRICE});
 q.u.wal-=RES_PRICE;q.u.res=true;save();log('reseller bought');r.json({wal:q.u.wal,res:true})});

const adm=(q,r,nx)=>{const a=Buffer.from(q.get('x-admin')||''),b=Buffer.from(ADMIN_PASS);
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b)){log('bad admin');return r.status(403).json({error:'no'})}nx()};
app.post('/api/admin/stock',limit(20,60000),adm,(q,r)=>{const{k,keys,generate}=q.body;
 const a=generate?Array.from({length:Math.min(+generate,100)},mk):(Array.isArray(keys)?keys:[]).slice(0,500).map(x=>String(x).slice(0,100));db.stock[k]=(db.stock[k]||[]).concat(a);save();r.json({stock:db.stock[k].length})});
app.get('/api/admin/stats',adm,(q,r)=>r.json({stock:Object.fromEntries(Object.entries(db.stock).map(([k,v])=>[k,v.length])),users:Object.keys(db.accounts).length,topups:Object.keys(db.topups).length}));

// pehli baar chalne par har plan ki 5 keys
if(!Object.keys(db.stock).length){db.products.forEach(p=>p.pl.forEach(x=>db.stock[p.id+'|'+x[0]]=Array.from({length:5},mk)));save()}
app.listen(PORT,()=>log('Purple Store on',PORT));
