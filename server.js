import http from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createWorkflow, paymentSummary } from './workflow-server.js';
import { sendBillPdf, whatsappConfig, whatsappReadiness } from './whatsapp.js';

const root = dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
if(process.env.VERCEL&&!databaseUrl) throw new Error('Set DATABASE_URL in Vercel to a persistent PostgreSQL database.');
let db;
if (databaseUrl) {
 const pool = new pg.Pool({connectionString:databaseUrl,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,max:1});
 db = {
  async exec(sql) { for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await pool.query(statement); },
  prepare(sql) {
   let index=0;
   let query=sql.replace(/\?/g,()=>`$${++index}`);
   query=query.replace(/^INSERT OR IGNORE INTO/i,'INSERT INTO');
   if (/^INSERT INTO (products|meta)\b/i.test(query)) query+=' ON CONFLICT DO NOTHING';
   return {
    async get(...params) { return (await pool.query(query,params)).rows[0]; },
    async all(...params) { return (await pool.query(query,params)).rows; },
    async run(...params) {
     let statement=query;
     if(/^INSERT INTO (requests|documents)\b/i.test(statement)) statement+=' RETURNING id';
     const result=await pool.query(statement,params);
     return {lastInsertRowid:result.rows[0]?.id,changes:result.rowCount};
    }
   };
  }
 };
} else {
 const {DatabaseSync}=await import('node:sqlite');
 const dbPath=process.env.DB_PATH||resolve(root,'data/studio.sqlite');
 mkdirSync(dirname(dbPath),{recursive:true});
 const sqlite=new DatabaseSync(dbPath);
 db={exec:async sql=>sqlite.exec(sql),prepare(sql){const statement=sqlite.prepare(sql);return {get:async(...params)=>statement.get(...params),all:async(...params)=>statement.all(...params),run:async(...params)=>statement.run(...params)};}};
}
await db.exec(databaseUrl?`
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, hash TEXT, role TEXT);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires BIGINT);
 CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, data TEXT);
 CREATE TABLE IF NOT EXISTS requests(id BIGSERIAL PRIMARY KEY, user_id TEXT REFERENCES users(id), data TEXT);
 CREATE TABLE IF NOT EXISTS documents(id BIGSERIAL PRIMARY KEY, data TEXT);
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
`:`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, hash TEXT, role TEXT);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT, expires INTEGER);
 CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, data TEXT);
 CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, data TEXT);
 CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT);
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);`);
// A persistent claim prevents duplicate WhatsApp sends across tabs, restarts
// and concurrent Vercel instances. A changed bill gets a different snapshot key.
await db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_sends(
 snapshot TEXT PRIMARY KEY, document_id BIGINT, attempt TEXT, status TEXT,
 message_id TEXT, updated BIGINT
);`);
await db.exec(`CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, quote_id BIGINT UNIQUE, data TEXT);`);
await db.exec(databaseUrl?`CREATE UNIQUE INDEX IF NOT EXISTS document_job ON documents ((data::jsonb ->> 'jobId')) WHERE data::jsonb ->> 'jobId' IS NOT NULL`:`CREATE UNIQUE INDEX IF NOT EXISTS document_job ON documents (json_extract(data,'$.jobId')) WHERE json_extract(data,'$.jobId') IS NOT NULL`);
const hashPassword = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
function matches(password, hash) { const [salt, expected] = hash.split(':'); return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hashPassword(password, salt).split(':')[1], 'hex')); }
if (!await db.prepare("SELECT id FROM users WHERE role='admin'").get()) {
  if(process.env.VERCEL&&!process.env.ADMIN_PASSWORD) throw new Error('Set ADMIN_PASSWORD in Vercel before the first deployment.');
  const password = process.env.ADMIN_PASSWORD || randomBytes(15).toString('base64url');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must have at least 12 characters.');
  const email = (process.env.ADMIN_EMAIL || 'admin@gmail.com').toLowerCase();
  await db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(randomUUID(), 'Studio admin', email, hashPassword(password), 'admin');
  console.log(`First-run admin email: ${email}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`First-run admin password (save securely; shown once): ${password}`);
}
const seed = [
 ['ceramic','Ceramic Coating','Coatings',24999,'Long-lasting gloss and water-repellent protection for your paint.'],
 ['graphene','Graphene Coating','Coatings',34999,'A deep, slick finish with advanced surface protection.'],
 ['teflon','Teflon / Body Wax','Coatings',4999,'Restore shine with a fresh layer of paint protection.'],
 ['coating-maintenance','Ceramic Coating Maintenance Wash','Coatings',0,'A careful maintenance wash to help preserve the gloss and water behavior of an existing coating. Suitability and interval are confirmed for your coating.'],
 ['ppf','Paint Protection Film','Protection',85000,'Clear film to protect painted panels from everyday wear.'],
 ['ppf-spot','PPF Panel Protection','Protection',0,'Targeted paint protection film for selected high-impact panels. Panel coverage and film options are confirmed after vehicle inspection.'],
 ['paint-sealant','Paint Sealant','Protection',0,'A surface protection option for vehicles that do not need a full film installation. Preparation and durability depend on paint condition.'],
 ['windshield-film','Windshield Protection Film','Protection',0,'A clear film option for added windshield protection. Vehicle compatibility and local road-use suitability must be confirmed before installation.'],
 ['deep-clean','Deep Interior Cleaning','Deep cleaning',7999,'A thorough clean for seats, carpets, trim and touchpoints.'],
 ['exterior','Exterior Deep Clean','Deep cleaning',2999,'A careful wash and decontamination of every exterior surface.'],
 ['interior-refresh','Interior Refresh','Deep cleaning',0,'A focused cabin clean for everyday dust, touchpoints and light upholstery marks. Final scope depends on the material and condition.'],
 ['engine-bay-clean','Engine Bay Cleaning','Deep cleaning',0,'A careful engine-bay clean using a vehicle-appropriate process. Assessment is required before work begins.'],
 ['odor-treatment','Cabin Odour Treatment','Deep cleaning',0,'A cabin treatment for persistent odours after the source is identified. Results depend on the cause and materials in the vehicle.'],
 ['full-detail','V31 Signature Detail','V31 detailing',12999,'An inside-and-out detail, from the cabin to the final polish.'],
 ['paint-correction','Paint Correction','V31 detailing',15999,'Refine swirls and restore depth and clarity to the paint.'],
 ['bike-detail','Two-Wheeler Detail','V31 detailing',3999,'Dedicated cleaning and finish care for your motorcycle or scooter.'],
 ['headlight-restoration','Headlight Restoration','V31 detailing',0,'Restore clarity to weathered headlight lenses with a suitable refinement process. Lens condition and finish are assessed first.'],
 ['v31-concept','V31 Concepts Package','V31 detailing',0,'A combination of treatments tailored to your vehicle.']
];
// Keep the starter catalogue repairable if an earlier deployment marked seeding complete too soon.
for (const [id,name,category,price,description] of seed) await db.prepare('INSERT OR IGNORE INTO products VALUES(?,?)').run(id, JSON.stringify({id,name,category,price,description,kind:'Service'}));
await db.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('seeded','yes');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const string = (v, label, max=200, required=true) => { if (typeof v !== 'string' || v.length>max || (required && !v.trim())) fail(400, `Enter a valid ${label}.`); return v.trim(); };
const number = (v, label, max=10000000) => { if (typeof v !== 'number' || !Number.isFinite(v) || v<0 || v>max) fail(400, `Invalid ${label}.`); return v; };
const round = n => Math.round((n + Number.EPSILON)*100)/100;
function normalizePhone(value) {
 const message='Enter your 10-digit mobile number, or include a country code for an international number.';
 if(typeof value!=='string'||value.length>40||!value.trim()||!/^[+\d\s()-]+$/.test(value)) fail(400,message);
 let phone=value.replace(/[\s()-]/g,'');
 if(phone.startsWith('00')) phone=`+${phone.slice(2)}`;
 else if(/^0[6-9]\d{9}$/.test(phone)) phone=`+91${phone.slice(1)}`;
 else if(/^[6-9]\d{9}$/.test(phone)) phone=`+91${phone}`;
 else if(/^91[6-9]\d{9}$/.test(phone)) phone=`+${phone}`;
 if(!/^\+[1-9]\d{7,14}$/.test(phone)) fail(400,message);
 return phone;
}
function contact(b) {
 const phone=normalizePhone(b.phone);
 return {customer:string(b.customer,'customer name',100),phone,vehicle:string(b.vehicle||'','vehicle',100,false),note:string(b.note||'','note',1500,false)};
}
async function items(input, admin=false) {
 if (!Array.isArray(input) || !input.length || input.length>50) fail(400,'Choose between 1 and 50 items.');
 return Promise.all(input.map(async i=>{
  const row=await db.prepare('SELECT data FROM products WHERE id=?').get(string(i.id,'product ID'));
  if (!row) fail(400,'A selected product is no longer available.');
  const p=JSON.parse(row.data); const quantity=number(i.quantity,'quantity',100);
  if (!Number.isInteger(quantity)||quantity<1) fail(400,'Quantity must be a whole number from 1 to 100.');
  return {id:p.id,name:p.name,quantity,price:admin?round(number(i.price,'price')):p.price};
 }));
}
const attempts = new Map();
function limit(req, label, max) {
 const key=`${req.socket.remoteAddress}:${label}`, now=Date.now();
 if (attempts.size>10000) for(const [k,v] of attempts) if(v.until<now) attempts.delete(k);
 let entry=attempts.get(key); if (!entry || entry.until<now) {entry={count:0,until:now+900000}; attempts.set(key,entry);}
 if (++entry.count>max) fail(429,'Too many attempts. Please try again in 15 minutes.');
}
async function body(req) { let raw=''; for await(const c of req) {raw+=c; if(raw.length>65536) fail(413,'Request is too large.');} try {const b=JSON.parse(raw); if(!b||typeof b!=='object'||Array.isArray(b)) throw 0; return b;} catch {fail(400,'Invalid request.');} }
async function session(req) {
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('v31_session='))?.slice(12);
 if (!token) return null;
 return db.prepare('SELECT users.id,name,email,role FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(token,Date.now());
}
function admin(user) { if(user?.role!=='admin') fail(403,'Administrator access is required.'); }
const list = async table => (await db.prepare(`SELECT id,data FROM ${table} ORDER BY id DESC`).all()).map(r=>({...JSON.parse(r.data),id:r.id}));
const workflow=createWorkflow({db,admin,body,fail,string,number,round,list});
export async function handler(req,res){
 const json=(data,status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
 res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','same-origin'); res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
 try {
 const url=new URL(req.url,'http://localhost'); let path=url.pathname; const method=req.method;
 // Single-segment routes also work on hosts that do not forward nested API paths.
 if(method==='PATCH'&&['/api/documents','/api/requests'].includes(path)){
  const id=url.searchParams.get('id');
  if(!/^\d+$/.test(id||'')||!Number.isSafeInteger(Number(id))||Number(id)<1)fail(400,'Invalid record ID.');
  path+=`/${id}`;
 }
 if (path.startsWith('/api/')) {
  if (!['GET','POST','PATCH'].includes(method)) fail(405,'Method not allowed.');
  if(method!=='GET') {
   if(req.headers['sec-fetch-site']==='cross-site') fail(403,'Cross-site request rejected.');
   if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) fail(403,'Cross-site request rejected.');
   if(!req.headers['content-type']?.startsWith('application/json')) fail(415,'JSON is required.');
  }
  const user=await session(req);
  if(await workflow({path,method,url,req,user,json}))return;
  if(path==='/api/session'&&method==='GET') return json({user:user||null});
  if(path==='/api/products'&&method==='GET') return json(await list('products'));
  if(path==='/api/whatsapp'&&method==='GET') {admin(user);return json(whatsappReadiness());}
  if((path==='/api/login'||path==='/api/register')&&method==='POST') {
   limit(req,'auth',25); const b=await body(req);
   const email=string(b.email,'email').toLowerCase(), password=string(b.password,'password',128);
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'Enter a valid email address.');
   if(path==='/api/register') {
    if(password.length<12) fail(400,'Use a password with at least 12 characters.');
    const name=string(b.name,'name',100);
    if(await db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409,'An account already exists for this email.');
    await db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(randomUUID(),name,email,hashPassword(password),'customer');
   }
   const found=await db.prepare('SELECT * FROM users WHERE email=?').get(email);
   if(!found||!matches(password,found.hash)||(path==='/api/login'&&found.role!==b.role)) fail(401,'The email, password or selected login type is incorrect.');
   await db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
   const token=randomBytes(32).toString('hex'); await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,found.id,Date.now()+86400000);
   return json({user:{id:found.id,name:found.name,email:found.email,role:found.role}},200,{'Set-Cookie':`v31_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE==='true'||process.env.VERCEL?'; Secure':''}`});
  }
  if(path==='/api/logout'&&method==='POST') {const token=(req.headers.cookie||'').match(/(?:^|;\s*)v31_session=([^;]+)/)?.[1]; if(token) await db.prepare('DELETE FROM sessions WHERE token=?').run(token);return json({ok:true},200,{'Set-Cookie':'v31_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
  if(path==='/api/products'&&method==='POST') {admin(user);const b=await body(req);const p={id:randomUUID(),name:string(b.name,'product name',100),description:string(b.description,'description',700),category:string(b.category,'category',60),kind:b.kind==='Product'?'Product':'Service',price:round(number(b.price,'price'))};await db.prepare('INSERT INTO products VALUES(?,?)').run(p.id,JSON.stringify(p));return json(p,201);}
  if(path==='/api/requests'&&method==='POST') {limit(req,'requests',40);const b=await body(req);const data={...contact(b),items:await items(b.items),status:'New',date:new Date().toISOString()};const r=await db.prepare('INSERT INTO requests(user_id,data) VALUES(?,?)').run(user?.id||null,JSON.stringify(data));return json({...data,id:Number(r.lastInsertRowid)},201);}
  if(path==='/api/requests'&&method==='GET') {if(!user) fail(401,'Please log in.');return json(user.role==='admin'?await list('requests'):(await db.prepare('SELECT id,data FROM requests WHERE user_id=? ORDER BY id DESC').all(user.id)).map(r=>({...JSON.parse(r.data),id:r.id})));}
  if(/^\/api\/requests\/\d+$/.test(path)&&method==='PATCH') {admin(user);const id=Number(path.split('/').pop()), b=await body(req);if(!['New','Contacted','Confirmed','Completed','Cancelled'].includes(b.status)) fail(400,'Invalid request status.');const row=await db.prepare('SELECT data FROM requests WHERE id=?').get(id);if(!row) fail(404,'Request not found.');const data={...JSON.parse(row.data),status:b.status};await db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(data),id);return json({...data,id});}
  if(path==='/api/documents'&&url.searchParams.has('whatsapp')&&method==='POST') {
   admin(user);
   const rawId=url.searchParams.get('whatsapp');
   if(!/^\d+$/.test(rawId)||!Number.isSafeInteger(Number(rawId))||Number(rawId)<1)fail(400,'Invalid document ID.');
   await body(req);
   const id=Number(rawId),row=await db.prepare('SELECT data FROM documents WHERE id=?').get(id);
   if(!row) fail(404,'Document not found.');
   const document={...JSON.parse(row.data),id};if(document.type==='bill')Object.assign(document,paymentSummary(document));
   if(document.type!=='bill') fail(400,'Only saved bills can be sent directly through WhatsApp.');
   document.phone=normalizePhone(document.phone);
   const config=whatsappConfig();
   if(!config.configured) fail(503,config.message);
   const snapshot=createHash('sha256').update(JSON.stringify(document)).digest('hex'),attempt=randomUUID();
   await db.prepare('INSERT INTO whatsapp_sends(snapshot,document_id,attempt,status,message_id,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(snapshot) DO NOTHING').run(snapshot,id,attempt,'sending',null,Date.now());
   const claim=await db.prepare('SELECT attempt,status,message_id,updated FROM whatsapp_sends WHERE snapshot=?').get(snapshot);
   if(claim.attempt!==attempt) {
    if(claim.status==='accepted') return json({status:'accepted',messageId:claim.message_id,phone:document.phone,alreadySent:true},202);
    const pending=claim.status==='sending'&&Date.now()-Number(claim.updated)<30000;
    return json({error:pending?'This bill is already being sent. Wait for the result before trying again.':'A previous send has an unconfirmed outcome. Check WhatsApp before sending this bill again.',status:pending?'sending':'unknown'},409);
   }
   let accepted;
   try {
    const {createDocumentPdf,documentNumber}=await import('./invoice-pdf.js');
    const pdf=await createDocumentPdf(document);
    accepted=await sendBillPdf({document,pdf,filename:`${documentNumber(document)}.pdf`,config});
    await db.prepare('UPDATE whatsapp_sends SET status=?,message_id=?,updated=? WHERE snapshot=? AND attempt=?').run('accepted',accepted.messageId,Date.now(),snapshot,attempt);
   } catch(err) {
    if(accepted || err.deliveryStatus==='unknown') {
     // Even if this write fails, the original durable claim still prevents a
     // second messages POST. Never clear a possibly accepted send.
     try {await db.prepare('UPDATE whatsapp_sends SET status=?,updated=? WHERE snapshot=? AND attempt=?').run('unknown',Date.now(),snapshot,attempt);} catch {}
     return json({error:accepted?'WhatsApp accepted the bill, but its local record could not be updated. Check WhatsApp before sending it again.':err.message,status:'unknown'},502);
    }
    await db.prepare('DELETE FROM whatsapp_sends WHERE snapshot=? AND attempt=?').run(snapshot,attempt);
    throw err;
   }
   return json(accepted,202);
  }
  // Keep downloads on the same single-segment API route as document history.
  // Retain the original nested route for older browser clients.
  if((path==='/api/documents'&&url.searchParams.has('pdf')||/^\/api\/documents\/\d+\/pdf$/.test(path))&&method==='GET') {
   admin(user);
   const rawId=path==='/api/documents'?url.searchParams.get('pdf'):path.split('/')[3];
   if(!/^\d+$/.test(rawId)||!Number.isSafeInteger(Number(rawId))||Number(rawId)<1)fail(400,'Invalid document ID.');
   const id=Number(rawId);
   const row=await db.prepare('SELECT data FROM documents WHERE id=?').get(id);
   if(!row) fail(404,'Document not found.');
   const document={...JSON.parse(row.data),id};if(document.type==='bill')Object.assign(document,paymentSummary(document));
   // A PDF dependency failure must not prevent access to existing records.
   const {createDocumentPdf,documentNumber}=await import('./invoice-pdf.js');
   const pdf=await createDocumentPdf(document);
   if(!Buffer.isBuffer(pdf)||pdf.subarray(0,5).toString()!=='%PDF-'||!pdf.subarray(-1024).toString('latin1').trimEnd().endsWith('%%EOF'))fail(500,'Unable to generate a complete PDF. Please retry.');
   res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${documentNumber(document)}.pdf"`,'Content-Length':pdf.length,'Cache-Control':'no-store'});
   return res.end(pdf);
  }
  if(path==='/api/documents'&&method==='GET') {admin(user);return json(await list('documents'));}
  if(path==='/api/documents'&&method==='POST') {
   admin(user);const b=await body(req);if(!['quotation','bill'].includes(b.type)) fail(400,'Invalid document type.');
   const lines=await items(b.items,true), subtotal=round(lines.reduce((sum,i)=>sum+i.quantity*i.price,0)),discount=round(number(b.discount,'discount',subtotal)),gstRate=number(b.gstRate,'GST rate',100),gst=round((subtotal-discount)*gstRate/100);
   let requestId;
   if(b.requestId){const request=await db.prepare('SELECT data FROM requests WHERE id=?').get(number(Number(b.requestId),'request ID'));if(!request)fail(404,'Request not found.');requestId=Number(b.requestId);}
   const data={...contact(b),...(requestId?{requestId}:{}),type:b.type,items:lines,subtotal,discount,gstRate,gst,total:round(subtotal-discount+gst),date:new Date().toISOString(),status:b.type==='bill'?'Unpaid':'Draft'};
   const result=await db.prepare('INSERT INTO documents(data) VALUES(?)').run(JSON.stringify(data));return json({...data,id:Number(result.lastInsertRowid)},201);
  }
  if(/^\/api\/documents\/\d+$/.test(path)&&method==='PATCH') {admin(user);const id=Number(path.split('/').pop()),b=await body(req),row=await db.prepare('SELECT data FROM documents WHERE id=?').get(id);if(!row) fail(404,'Document not found.');const data=JSON.parse(row.data),states=data.type==='bill'?['Unpaid','Paid']:['Draft','Accepted','Declined'];if(!states.includes(b.status)) fail(400,'Invalid document status.');if(data.type==='bill')fail(409,'Payment status follows recorded payments. Open payment history.');data.status=b.status;await db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify(data),id);return json({...data,id});}
  fail(404,'Not found.');
 }
 if(method!=='GET'&&method!=='HEAD') fail(405,'Method not allowed.');
 // Explicit allowlist prevents exposing database, credentials, source, or Git files.
 const file=path==='/'?'index.html':path.slice(1);
 if(!['index.html','styles.css','premium.css','premium.js','app.js','workflow.js','assets/images/company_logo.jpeg','assets/images/studio-car.jpg'].includes(file)) fail(404,'Not found.');
 const bytes=readFileSync(resolve(root,file));const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.jpeg':'image/jpeg','.jpg':'image/jpeg'};
 res.writeHead(200,{'Content-Type':`${mime[extname(file)]}; charset=utf-8`,'Cache-Control':file.startsWith('assets/')?'public, max-age=86400':'no-cache'});res.end(method==='HEAD'?undefined:bytes);
 }catch(err){json({error:err.status?err.message:'Something went wrong. Please try again.'},err.status||500);if(!err.status)console.error(err);}
}
if(!process.env.VERCEL){
 const server=http.createServer(handler);
 server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`V31 Concepts running at http://${process.env.HOST||'127.0.0.1'}:${server.address().port}`));
}
export default handler;
