import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { inflateSync } from 'node:zlib';
import { createDocumentPdf } from '../invoice-pdf.js';

function pdfText(bytes){
 const raw=bytes.toString('latin1');
 return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap(match=>{
  try{return [...inflateSync(Buffer.from(match[1],'latin1')).toString().matchAll(/<([\da-f]+)>/gi)].map(m=>Buffer.from(m[1],'hex').toString('latin1'));}catch{return [];}
 }).join('');
}

const temp=mkdtempSync(join(tmpdir(),'v31-test-'));
let server,base,adminCookie,customerCookie,requestId,documentId;
async function start(){
 server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',HOST:'127.0.0.1',DB_PATH:join(temp,'test.sqlite'),ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:'test-admin-password-2026'},stdio:['ignore','pipe','pipe']});
 base=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),10000);server.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/running at (http:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});server.on('error',reject);server.on('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exited: ${code}`));});});
}
async function stop(){if(server?.exitCode===null){const exit=once(server,'exit');server.kill();await exit;}}
async function call(path,method='GET',data,cookie,headers={}){const response=await fetch(base+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers},body:data?JSON.stringify(data):undefined});const payload=await response.json();return {status:response.status,data:payload,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};}
before(start);
after(async()=>{await stop();rmSync(temp,{recursive:true,force:true});});

test('public catalogue works, private files and admin data stay private',async()=>{
 assert.equal((await fetch(base)).status,200);
 const products=await call('/api/products');assert.equal(products.data.length,10);
 assert.equal((await call('/api/documents')).status,403);
 for(const path of ['/data/studio.sqlite','/server.js','/.git/config','/README.md'])assert.equal((await call(path)).status,404);
 assert.equal((await call('/api/products','POST',{name:'Unauthorized'})).status,403);
});
test('guest requests use authoritative catalogue prices and validate quantity',async()=>{
 const data={customer:'Guest',phone:'+919876543210',vehicle:'Test car',items:[{id:'ceramic',quantity:2,price:1}]};
 const result=await call('/api/requests','POST',data);assert.equal(result.status,201);requestId=result.data.id;assert.equal(result.data.items[0].price,24999);
 assert.equal((await call('/api/requests')).status,401);
 assert.equal((await call('/api/requests','POST',{...data,items:[{id:'ceramic',quantity:-1}]})).status,400);
 assert.equal((await call('/api/requests','POST',{...data,phone:'98765'})).status,400);
 assert.equal((await call('/api/requests','POST',{...data,items:[{id:'missing',quantity:1}]})).status,400);
});
test('customer registration cannot grant admin privileges and request history is private',async()=>{
 const result=await call('/api/register','POST',{name:'Customer',email:'customer@example.test',password:'a-customer-password-2026',role:'admin'});assert.equal(result.status,200);assert.equal(result.data.user.role,'customer');customerCookie=result.cookie;
 assert.match(result.headers.get('set-cookie'),/HttpOnly/);assert.match(result.headers.get('set-cookie'),/SameSite=Strict/);
 assert.deepEqual((await call('/api/requests','GET',null,customerCookie)).data,[]);
 assert.equal((await call('/api/documents','GET',null,customerCookie)).status,403);
 assert.equal((await call('/api/documents','POST',{},customerCookie)).status,403);
 assert.equal((await call('/api/products','POST',{},customerCookie)).status,403);
 assert.equal((await call(`/api/requests/${requestId}`,'PATCH',{status:'Completed'},customerCookie)).status,403);
 await call('/api/requests','POST',{customer:'Customer',phone:'+919876543210',items:[{id:'ppf',quantity:1}]},customerCookie);
 assert.equal((await call('/api/requests','GET',null,customerCookie)).data.length,1);
});
test('login verifies role, credentials, and rejects cross-site writes',async()=>{
 assert.equal((await call('/api/login','POST',{email:'admin@example.test',password:'wrong',role:'admin'})).status,401);
 assert.equal((await call('/api/login','POST',{email:'admin@example.test',password:'test-admin-password-2026',role:'customer'})).status,401);
 const result=await call('/api/login','POST',{email:'admin@example.test',password:'test-admin-password-2026',role:'admin'});assert.equal(result.status,200);adminCookie=result.cookie;
 assert.equal((await call('/api/session','GET',null,adminCookie)).data.user.role,'admin');
 assert.equal((await call('/api/products','POST',{},adminCookie,{Origin:'https://untrusted.test'})).status,403);
});
test('admin manages catalogue and request status',async()=>{
 const result=await call('/api/products','POST',{name:'Microfibre cloth',description:'Soft detailing cloth.',kind:'Product',category:'Car care',price:249.5},adminCookie);assert.equal(result.status,201);
 assert.ok((await call('/api/products')).data.some(p=>p.id===result.data.id));
 const result2=await call(`/api/requests/${requestId}`,'PATCH',{status:'Confirmed'},adminCookie);assert.equal(result2.data.status,'Confirmed');
 assert.equal((await call('/api/requests','GET',null,adminCookie)).data.length,2);
 assert.equal((await call('/api/products','POST',{name:'Bad',description:'Test',category:'Care',price:-1},adminCookie)).status,400);
});
test('documents calculate rounded totals, reject invalid discounts, and preserve line snapshots',async()=>{
 const data={type:'quotation',customer:'Bill customer',phone:'+919876543210',items:[{id:'ceramic',quantity:2,price:100.25}],discount:10,gstRate:18,total:1};
 const quote=await call('/api/documents','POST',data,adminCookie);assert.equal(quote.status,201);assert.equal(quote.data.subtotal,200.5);assert.equal(quote.data.gst,34.29);assert.equal(quote.data.total,224.79);
 assert.equal((await call('/api/documents','POST',{...data,discount:201},adminCookie)).status,400);
 assert.equal((await call('/api/documents','POST',{...data,items:[]},adminCookie)).status,400);
 assert.equal((await call('/api/documents','POST',{...data,gstRate:101},adminCookie)).status,400);
 const bill=await call('/api/documents','POST',{...data,type:'bill'},adminCookie);assert.equal(bill.status,201);assert.notEqual(bill.data.id,quote.data.id);documentId=bill.data.id;
 assert.equal((await call(`/api/documents/${documentId}`,'PATCH',{status:'Paid'},adminCookie)).data.status,'Paid');
 assert.equal((await call(`/api/documents/${documentId}`,'PATCH',{status:'Accepted'},adminCookie)).status,400);
});
test('PDF endpoint protects private bills and exports saved totals and payment status',async()=>{
 const path=`/api/documents/${documentId}/pdf`;
 for(const cookie of [undefined,customerCookie])assert.equal((await call(path,'GET',null,cookie)).status,403);
 assert.equal((await call('/api/documents/999999/pdf','GET',null,adminCookie)).status,404);
 const response=await fetch(base+path,{headers:{cookie:adminCookie}});
 assert.equal(response.status,200);
 assert.equal(response.headers.get('content-type'),'application/pdf');
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('content-disposition'),`attachment; filename="V31-B-${String(documentId).padStart(4,'0')}.pdf"`);
 const bytes=Buffer.from(await response.arrayBuffer());
 assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 assert.ok(bytes.toString('latin1').trimEnd().endsWith('%%EOF'));
 const content=pdfText(bytes);
 for(const value of ['BILL','Bill customer','Ceramic Coating','INR 200.50','INR 10.00','INR 34.29','INR 224.79','Paid'])assert.ok(content.includes(value),value);
});

test('long PDFs paginate and retain the last item, totals and notes',async()=>{
 const bytes=await createDocumentPdf({id:123,type:'bill',date:'2026-10-15T12:00:00Z',customer:'Long bill',phone:'+919876543210',vehicle:'Test vehicle',status:'Unpaid',items:Array.from({length:50},(_,i)=>({name:`Service ${i+1}: ${'Detailed cleaning '.repeat(4)}`,quantity:100,price:10000000})),subtotal:50000000000,discount:0,gstRate:18,gst:9000000000,total:59000000000,note:'Long note. '.repeat(150)});
 const content=pdfText(bytes);
 assert.ok(content.includes('Service 50:'));
 assert.ok(content.includes('INR 59,00,00,00,000.00'));
 assert.ok(content.includes('Long note.'));
 assert.ok(content.includes('Page 2 of'));
});

test('data and sessions survive restart; logout revokes server access',async()=>{
 await stop();await start();
 assert.equal((await call('/api/products')).data.length,11);
 const docs=await call('/api/documents','GET',null,adminCookie);assert.equal(docs.status,200);assert.equal(docs.data.length,2);assert.equal(docs.data.find(d=>d.id===documentId).status,'Paid');
 assert.equal((await call('/api/requests','GET',null,adminCookie)).data.length,2);
 await call('/api/logout','POST',{},adminCookie);assert.equal((await call('/api/documents','GET',null,adminCookie)).status,403);
 assert.equal((await call(`/api/documents/${documentId}/pdf`,'GET',null,adminCookie)).status,403);
 assert.equal((await call('/api/session','GET',null,adminCookie)).data.user,null);
});
test('requests and documents accept familiar mobile formats and save WhatsApp-ready numbers',async()=>{
 const login=await call('/api/login','POST',{email:'admin@example.test',password:'test-admin-password-2026',role:'admin'});
 const cookie=login.cookie;
 const data={customer:'Phone formats',items:[{id:'ceramic',quantity:1,price:100}],type:'quotation',discount:0,gstRate:0};
 const formats=[
  ['9876543210','+919876543210'],
  ['09876 543210','+919876543210'],
  ['91 98765-43210','+919876543210'],
  ['+91 (98765) 43210','+919876543210'],
  ['(98765) 43210','+919876543210'],
  ['00 91 98765 43210','+919876543210'],
  ['+1 (415) 555-0123','+14155550123'],
  ['0044 7700 900123','+447700900123']
 ];
 for(const path of ['/api/requests','/api/documents']) {
  const saved=[];
  for(const [phone,expected] of formats) {
   const result=await call(path,'POST',{...data,phone},cookie);
   assert.equal(result.status,201,`${path}: ${phone}`);
   assert.equal(result.data.phone,expected);
   saved.push({id:result.data.id,phone:expected});
  }
  for(const phone of ['', '98765', '1234567890', '987654321', 'call9876543210', '++919876543210', '91+9876543210', '+1234567890123456', '009876', 9876543210]) {
   const result=await call(path,'POST',{...data,phone},cookie);
   assert.equal(result.status,400,`${path}: ${phone}`);
   assert.match(result.data.error,/10-digit mobile number/);
  }
  const records=(await call(path,'GET',null,cookie)).data;
  for(const item of saved) assert.equal(records.find(record=>record.id===item.id)?.phone,item.phone);
 }
});
