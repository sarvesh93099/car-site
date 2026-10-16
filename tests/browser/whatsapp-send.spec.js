import {test,expect} from '@playwright/test';

const ready={configured:true,mode:'template',message:'Ready to send bills through WhatsApp.'};
const accepted={status:'accepted',messageId:'wamid.browser-test',phone:'+919876543210'};

async function openDocument(page,{customer,type='bill',configuration=()=>ready,send}={}){
 const sends=[];
 await page.route('**/api/whatsapp',route=>route.fulfill({json:configuration()}));
 // Every direct-send request is intercepted. These tests never contact WhatsApp.
 await page.route(url=>url.pathname==='/api/documents'&&url.searchParams.has('whatsapp'),async route=>{
  const request=route.request();
  sends.push({url:new URL(request.url()),method:request.method(),data:request.postDataJSON()});
  if(send)return send(route,sends.length);
  return route.fulfill({status:500,json:{error:'Unexpected send in this browser test.'}});
 });
 const login=await page.request.post('/api/login',{data:{email:'admin@example.test',password:'browser-admin-password-2026',role:'admin'}});
 expect(login.ok()).toBe(true);
 const response=await page.request.post('/api/documents',{data:{type,customer,phone:'9876543210',items:[{id:'ceramic',quantity:1,price:100}],discount:0,gstRate:18}});
 expect(response.status()).toBe(201);
 const document=await response.json();
 await page.goto('/');
 await page.locator('#admin-nav').click();
 await page.getByRole('button',{name:type==='bill'?'Billing':'Quotations',exact:true}).click();
 const record=page.locator('.record').filter({hasText:customer});
 await record.getByRole('button',{name:'View & share'}).click();
 await expect(page.locator('#view-dialog')).toBeVisible();
 return {document,record,sends};
}

test('sends the saved bill ID once, waits for acceptance, and keeps submitted bills disabled when reopened',async({page})=>{
 let finishSend;
 const pending=new Promise(resolve=>{finishSend=resolve;});
 const downloads=[],popups=[];
 page.on('download',download=>downloads.push(download));
 page.on('popup',popup=>popups.push(popup));
 const {document,record,sends}=await openDocument(page,{customer:'Direct bill accepted',send:async route=>{
  await pending;
  await route.fulfill({status:202,json:accepted});
 }});
 await page.evaluate(()=>{
  window.nativeShareCalls=0;
  Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{window.nativeShareCalls++;}});
 });
 const sendButton=page.locator('#send-whatsapp');
 await expect(sendButton).toBeEnabled();
 await expect(sendButton).toHaveText('Send bill via WhatsApp');
 await sendButton.click();
 await expect.poll(()=>sends.length).toBe(1);
 await expect(sendButton).toBeDisabled();
 await expect(page.locator('#whatsapp-status')).toHaveAttribute('role','status');
 await expect(page.locator('#whatsapp-status')).toContainText(/sending|submitting/i);
 await sendButton.evaluate(button=>{button.click();button.click();});
 expect(sends).toHaveLength(1);
 expect(sends[0].method).toBe('POST');
 expect(sends[0].data).toEqual({expectedStatus:document.status});
 expect([...sends[0].url.searchParams]).toEqual([['whatsapp',String(document.id)]]);
 finishSend();
 await expect(page.locator('#whatsapp-status')).toContainText('PDF submitted to WhatsApp');
 await expect(page.locator('#whatsapp-status')).toContainText(accepted.phone);
 await expect(page.locator('#whatsapp-status')).toContainText('Delivery is not yet confirmed');
 await expect(sendButton).toBeDisabled();
 await page.locator('#view-dialog [data-close]').click();
 await record.getByRole('button',{name:'View & share'}).click();
 await expect(sendButton).toBeDisabled();
 await expect(page.locator('#whatsapp-status')).toContainText('PDF submitted to WhatsApp');
 expect(sends).toHaveLength(1);
 expect(downloads).toHaveLength(0);
 expect(popups).toHaveLength(0);
 expect(await page.evaluate(()=>window.nativeShareCalls)).toBe(0);
});

test('an unconfigured connection shares the PDF through the device and can be checked again after setup',async({page})=>{
 let configuration={configured:false,mode:null,message:'Configure the WhatsApp Business connection on the server to send bills directly.'};
 const {sends}=await openDocument(page,{customer:'Direct bill setup',configuration:()=>configuration});
 await expect(page.locator('#send-whatsapp')).toBeVisible();
 await expect(page.locator('#send-whatsapp')).toBeEnabled();
 await expect(page.locator('#send-whatsapp')).toHaveText('Share bill PDF to WhatsApp');
 await page.evaluate(()=>{
  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{
   const file=data.files[0];
   window.sharedBill={name:file.name,type:file.type,size:file.size,header:await file.slice(0,5).text()};
  }});
 });
 await page.locator('#send-whatsapp').click();
 await expect.poll(()=>page.evaluate(()=>window.sharedBill)).toMatchObject({type:'application/pdf',header:'%PDF-'});
 expect(await page.evaluate(()=>window.sharedBill.size)).toBeGreaterThan(100);
 await expect(page.locator('#whatsapp-status')).toContainText(/configure|connect|setup|set up/i);
 await expect(page.locator('#retry-whatsapp-config')).toBeVisible();
 expect(sends).toHaveLength(0);
 configuration=ready;
 await page.locator('#retry-whatsapp-config').click();
 await expect(page.locator('#send-whatsapp')).toBeEnabled();
 expect(sends).toHaveLength(0);
});

test('a definite rejection allows an explicit retry without downloading or opening WhatsApp',async({page})=>{
 const downloads=[],popups=[];
 page.on('download',download=>downloads.push(download));
 page.on('popup',popup=>popups.push(popup));
 const {sends}=await openDocument(page,{customer:'Direct bill rejected',send:(route,attempt)=>route.fulfill(attempt===1?
  {status:502,json:{error:'WhatsApp rejected this bill. Check the approved template before retrying.'}}:
  {status:202,json:accepted})});
 await expect(page.locator('#send-whatsapp')).toBeEnabled();
 await page.locator('#send-whatsapp').click();
 await expect(page.locator('#whatsapp-status')).toContainText('WhatsApp rejected this bill');
 await expect(page.locator('#send-whatsapp')).toBeEnabled();
 expect(sends).toHaveLength(1);
 expect(downloads).toHaveLength(0);
 expect(popups).toHaveLength(0);
 await page.locator('#send-whatsapp').click();
 await expect(page.locator('#whatsapp-status')).toContainText('PDF submitted to WhatsApp');
 expect(sends).toHaveLength(2);
});

for(const failure of ['network','unknown']){
 test(`${failure} send outcome prevents a duplicate retry, including after reopening`,async({page})=>{
  const {record,sends}=await openDocument(page,{customer:`Direct bill ${failure}`,send:route=>failure==='network'?
   route.abort('failed'):
   route.fulfill({status:502,json:{error:'WhatsApp acceptance is unknown. Check the business account before retrying.',status:'unknown'}})});
  await expect(page.locator('#send-whatsapp')).toBeEnabled();
  await page.locator('#send-whatsapp').click();
  await expect(page.locator('#whatsapp-status')).toContainText(/unknown|confirm|check/i);
  await expect(page.locator('#send-whatsapp')).toBeDisabled();
  await page.locator('#view-dialog [data-close]').click();
  await record.getByRole('button',{name:'View & share'}).click();
  await expect(page.locator('#send-whatsapp')).toBeDisabled();
  await expect(page.locator('#whatsapp-status')).toContainText(/unknown|confirm|check/i);
  expect(sends).toHaveLength(1);
 });
}

test('quotations retain sharing without displaying the direct bill action',async({page})=>{
 const {sends}=await openDocument(page,{customer:'Direct quotation excluded',type:'quotation'});
 await expect(page.locator('#send-whatsapp')).toBeHidden();
 await expect(page.locator('#whatsapp-status')).toBeHidden();
 await expect(page.locator('#retry-whatsapp-config')).toBeHidden();
 await expect(page.locator('#share-document')).toBeVisible();
 expect(sends).toHaveLength(0);
});
