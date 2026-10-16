import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {sendBillPdf, whatsappConfig, whatsappReadiness} from '../whatsapp.js';

const env = {WHATSAPP_ACCESS_TOKEN:'server-secret-token', WHATSAPP_PHONE_NUMBER_ID:'123456789', WHATSAPP_API_VERSION:'v99.0'};
const config = whatsappConfig(env);
const document = {id:1,type:'bill',customer:'Bill Customer',phone:'+919876543210',total:118};
const pdf = Buffer.from('%PDF-1.7\nTest invoice bytes\n%%EOF\n');
const args = {document, pdf, filename:'V31-B-0001.pdf', config};

test('WhatsApp readiness validates configuration without exposing credentials', () => {
 const missing = whatsappReadiness({});
 assert.equal(missing.configured,false);
 assert.match(missing.message,/WHATSAPP_API_VERSION/);
 assert.deepEqual(Object.keys(whatsappReadiness(env)).sort(),['configured','message','mode']);
 assert.equal(whatsappReadiness(env).mode,'document');
 assert.equal(whatsappReadiness({...env,WHATSAPP_BILL_TEMPLATE:'bill_ready'}).mode,'template');
 for (const changed of [{WHATSAPP_PHONE_NUMBER_ID:'../../bad'},{WHATSAPP_API_VERSION:'https://bad.test'},{WHATSAPP_ACCESS_TOKEN:'bad\nheader'},{WHATSAPP_BILL_TEMPLATE:'bad name'},{WHATSAPP_BILL_TEMPLATE:'bill_ready',WHATSAPP_TEMPLATE_LANGUAGE:'bad!'}]) assert.equal(whatsappReadiness({...env,...changed}).configured,false);
 assert.ok(!JSON.stringify(whatsappReadiness(env)).includes(env.WHATSAPP_ACCESS_TOKEN));
});

test('uploads actual PDF bytes and sends its media ID as a document to the saved recipient', async () => {
 const calls = [];
 const result = await sendBillPdf({...args, fetchImpl:async (url, options) => {
  calls.push({url, options});
  return Response.json(calls.length === 1 ? {id:'12345'} : {messages:[{id:'wamid.test-message'}]});
 }});
 assert.equal(calls.length,2);
 assert.equal(calls[0].url,'https://graph.facebook.com/v99.0/123456789/media');
 assert.equal(calls[0].options.headers.Authorization,'Bearer server-secret-token');
 assert.equal(calls[0].options.redirect,'error');
 assert.equal(calls[0].options.body.get('messaging_product'),'whatsapp');
 assert.equal(calls[0].options.body.get('type'),'application/pdf');
 const file = calls[0].options.body.get('file');
 assert.equal(file.name,'V31-B-0001.pdf');
 assert.equal(file.type,'application/pdf');
 assert.deepEqual(Buffer.from(await file.arrayBuffer()),pdf);
 const sent = JSON.parse(calls[1].options.body);
 assert.equal(sent.messaging_product,'whatsapp');
 assert.equal(sent.to,'919876543210');
 assert.equal(sent.type,'document');
 assert.equal(sent.document.id,'12345');
 assert.equal(sent.document.filename,'V31-B-0001.pdf');
 assert.match(sent.document.caption,/INR 118.00/);
 assert.equal(sent.document.link,undefined);
 assert.equal(sent.text,undefined);
 assert.deepEqual(result,{status:'accepted',messageId:'wamid.test-message',phone:document.phone});
});

test('approved template includes document header and three positional bill parameters', async () => {
 let payload;
 await sendBillPdf({...args,config:whatsappConfig({...env,WHATSAPP_BILL_TEMPLATE:'bill_ready',WHATSAPP_TEMPLATE_LANGUAGE:'en'}),fetchImpl:async (url, options) => {
  if (url.endsWith('/media')) return Response.json({id:'12345'});
  payload=JSON.parse(options.body);
  return Response.json({messages:[{id:'wamid.template'}]});
 }});
 assert.equal(payload.type,'template');
 assert.equal(payload.template.name,'bill_ready');
 assert.deepEqual(payload.template.language,{code:'en'});
 assert.deepEqual(payload.template.components,[
  {type:'header',parameters:[{type:'document',document:{id:'12345',filename:'V31-B-0001.pdf'}}]},
  {type:'body',parameters:[{type:'text',text:'Bill Customer'},{type:'text',text:'V31-B-0001'},{type:'text',text:'INR 118.00'}]}
 ]);
});

test('invalid PDFs, phone numbers, quotation and unconfigured sends never contact Meta', async () => {
 let calls=0;
 for (const changed of [{pdf:Buffer.from('broken')},{document:{...document,phone:'98765'}},{document:{...document,type:'quotation'}},{config:whatsappConfig({})}]) {
  await assert.rejects(sendBillPdf({...args,...changed,fetchImpl:async()=>{calls++;}}));
 }
 assert.equal(calls,0);
});

test('upload failures do not dispatch; provider rejection is sanitized and actionable', async () => {
 let calls=0;
 await assert.rejects(sendBillPdf({...args,fetchImpl:async()=>{calls++;return Response.json({error:{code:131053,message:'SECRET TOKEN AND CUSTOMER DATA'}},{status:400});}}), err => err.status===502 && !err.deliveryStatus && !err.message.includes('SECRET'));
 assert.equal(calls,1);
 await assert.rejects(sendBillPdf({...args,fetchImpl:async url=>url.endsWith('/media')?Response.json({id:'12345'}):Response.json({error:{code:131047,message:'SECRET'}},{status:400})}), err => err.status===502 && !err.deliveryStatus && /24-hour/.test(err.message) && !err.message.includes('SECRET'));
});

test('network failures, server errors and malformed send responses stay unknown without retrying', async () => {
 for (const response of ['network','server','invalid-json','missing-id']) {
  let calls=0;
  await assert.rejects(sendBillPdf({...args,fetchImpl:async url=>{
   calls++;
   if(url.endsWith('/media'))return Response.json({id:'12345'});
   if(response==='network')throw new Error('PRIVATE');
   if(response==='server')return Response.json({error:{code:2}},{status:500});
   if(response==='invalid-json')return new Response('invalid json');
   return Response.json({});
  }}), err=>err.deliveryStatus==='unknown' && !err.message.includes('PRIVATE'));
  assert.equal(calls,2,response);
 }
});

test('upload and response-body timeouts are bounded, with unknown status only after dispatch', async () => {
 for(const stage of ['media','messages']) {
  let calls=0;
  await assert.rejects(sendBillPdf({...args,timeoutMs:15,fetchImpl:async url=>{
   calls++;
   if(stage==='messages'&&url.endsWith('/media'))return Response.json({id:'12345'});
   return {ok:true,status:200,json:()=>new Promise(()=>{})};
  }}),err=>stage==='media'?err.status===504&&!err.deliveryStatus:err.deliveryStatus==='unknown');
  assert.equal(calls,stage==='media'?1:2);
 }
});

const temp = mkdtempSync(join(tmpdir(),'v31-whatsapp-test-'));
let server,base,adminCookie,customerCookie;
let providerCalls=[];
async function start(overrides={}) {
 providerCalls=[];
 server=spawn(process.execPath,['--import','./tests/fixtures/whatsapp-provider.js','server.js'],{
  cwd:resolve('.'),env:{...process.env,DATABASE_URL:'',POSTGRES_URL:'',POSTGRES_PRISMA_URL:'',VERCEL:'',PORT:'0',HOST:'127.0.0.1',DB_PATH:join(temp,'test.sqlite'),ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:'whatsapp-admin-password',...env,...overrides},stdio:['ignore','pipe','pipe','ipc']
 });
 server.on('message',message=>{if(message.type==='provider')providerCalls.push(message);});
 base=await new Promise((resolve,reject)=>{
  let output='',errors='';
  const timeout=setTimeout(()=>reject(new Error(`Server startup timed out: ${errors}`)),10000);
  server.stderr.on('data',chunk=>{errors+=chunk;});
  server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/running at (http:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
  server.on('error',reject);
  server.on('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exited: ${code}: ${errors}`));});
 });
}
async function stop(){if(server?.exitCode===null){const exit=once(server,'exit');server.kill();await exit;}}
async function scenario(value){
 const ready=new Promise(resolve=>{const listen=message=>{if(message.type==='ready'){server.off('message',listen);resolve();}};server.on('message',listen);});
 server.send({type:'scenario',value});
 await ready;
}
async function call(path,method='GET',data,cookie=adminCookie,extraHeaders={}) {
 const response=await fetch(base+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{}),...extraHeaders},body:data?JSON.stringify(data):undefined});
 return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function bill(extra={}) {
 const result=await call('/api/documents','POST',{type:'bill',customer:'Integration bill customer',phone:'9876543210',items:[{id:'ceramic',quantity:1,price:100}],discount:0,gstRate:18,...extra});
 assert.equal(result.status,201);
 return result.data;
}
const send=id=>call(`/api/documents?whatsapp=${id}`,'POST',{});
before(async()=>{
 await start();
 adminCookie=(await call('/api/login','POST',{email:'admin@example.test',password:'whatsapp-admin-password',role:'admin'},null)).cookie;
 customerCookie=(await call('/api/register','POST',{name:'Customer',email:'customer@example.test',password:'customer-password-2026'},null)).cookie;
});
after(async()=>{await stop();rmSync(temp,{recursive:true,force:true});});

test('admin route validates permissions, IDs, content type, origin and saved bill type', async()=>{
 const saved=await bill();
 for(const cookie of [null,customerCookie]) {
  assert.equal((await call('/api/whatsapp','GET',null,cookie)).status,403);
  assert.equal((await call(`/api/documents?whatsapp=${saved.id}`,'POST',{},cookie)).status,403);
 }
 const ready=await call('/api/whatsapp');
 assert.equal(ready.data.configured,true);
 assert.equal(ready.data.mode,'document');
 assert.ok(!JSON.stringify(ready.data).includes(env.WHATSAPP_ACCESS_TOKEN));
 for(const id of ['', 'invalid','-1','0','1.5','9007199254740993']) assert.equal((await send(id)).status,400);
 assert.equal((await send(999999)).status,404);
 assert.equal((await send((await bill({type:'quotation'})).id)).status,400);
 assert.equal((await call(`/api/documents?whatsapp=${saved.id}`,'POST',{},adminCookie,{Origin:'https://evil.test'})).status,403);
 assert.equal((await call(`/api/documents?whatsapp=${saved.id}`,'POST',{},adminCookie,{'Content-Type':'text/plain'})).status,415);
 assert.equal(providerCalls.length,0);
});

test('saved PDF is accepted once; duplicate prevention survives restart and permits an updated bill',async()=>{
 const saved=await bill();
 const accepted=await send(saved.id);
 assert.equal(accepted.status,202);
 assert.equal(accepted.data.status,'accepted');
 assert.equal(accepted.data.phone,'+919876543210');
 assert.equal(providerCalls.length,2);
 assert.deepEqual(providerCalls[0].data,{filename:`V31-B-${String(saved.id).padStart(4,'0')}.pdf`,type:'application/pdf'});
 assert.equal(providerCalls[1].data.to,'919876543210');
 assert.equal(providerCalls[1].data.type,'document');
 const duplicate=await send(saved.id);
 assert.equal(duplicate.data.alreadySent,true);
 assert.equal(providerCalls.length,2);
 await stop();await start();
 assert.equal((await send(saved.id)).data.alreadySent,true);
 assert.equal(providerCalls.length,0);
 assert.equal((await call(`/api/documents/${saved.id}`,'PATCH',{status:'Paid'})).status,200);
 assert.equal((await send(saved.id)).status,202);
 assert.equal(providerCalls.length,2);
});

test('recipient and PDF always come from the saved bill, never the send request body',async()=>{
 const saved=await bill();
 const sent=await call(`/api/documents?whatsapp=${saved.id}`,'POST',{phone:'+14155550123',total:0,pdf:'fake-pdf'});
 assert.equal(sent.status,202);
 assert.equal(providerCalls.at(-1).data.to,'919876543210');
 assert.match(providerCalls.at(-1).data.document.caption,/INR 118.00/);
});

test('concurrent clicks issue only one provider message',async()=>{
 const saved=await bill();
 await scenario('slow');
 const dispatch=new Promise(resolve=>{const listen=message=>{if(message.type==='provider'&&message.stage==='messages'){server.off('message',listen);resolve();}};server.on('message',listen);});
 const pending=send(saved.id);
 await dispatch;
 const duplicate=await send(saved.id);
 assert.equal(duplicate.status,409);
 assert.equal(duplicate.data.status,'sending');
 server.send({type:'release'});
 assert.equal((await pending).status,202);
 await scenario('success');
});

test('known upload or customer-window failure permits an explicit later retry',async()=>{
 for(const failure of ['upload-failure','window']) {
  const saved=await bill();
  await scenario(failure);
  const rejected=await send(saved.id);
  assert.equal(rejected.status,502);
  assert.equal(rejected.data.status,undefined);
  assert.ok(!rejected.data.error.includes('PRIVATE')&&!rejected.data.error.includes('SECRET'));
  await scenario('success');
  assert.equal((await send(saved.id)).status,202);
 }
});

test('ambiguous sends remain blocked across restart and never retry automatically',async()=>{
 const saved=await bill();
 await scenario('unknown');
 const count=providerCalls.length;
 const unknown=await send(saved.id);
 assert.equal(unknown.status,502);
 assert.equal(unknown.data.status,'unknown');
 assert.equal(providerCalls.length,count+2);
 await scenario('success');
 assert.equal((await send(saved.id)).status,409);
 assert.equal(providerCalls.length,count+2);
 await stop();await start();
 const duplicate=await send(saved.id);
 assert.equal(duplicate.status,409);
 assert.equal(duplicate.data.status,'unknown');
 assert.equal(providerCalls.length,0);
});

test('unconfigured deployment returns clear readiness and 503 without sending',async()=>{
 const saved=await bill();
 await stop();await start({WHATSAPP_ACCESS_TOKEN:''});
 const ready=await call('/api/whatsapp');
 assert.equal(ready.status,200);
 assert.equal(ready.data.configured,false);
 const rejected=await send(saved.id);
 assert.equal(rejected.status,503);
 assert.match(rejected.data.error,/configured on the server/);
 assert.equal(providerCalls.length,0);
});
