import {test,expect} from '@playwright/test';

test('admin corrects paid bills without losing receipts; stale and anonymous changes are rejected',async({page,playwright})=>{
 await page.request.post('/api/login',{data:{email:'admin@example.test',password:'browser-admin-password-2026',role:'admin'}});
 const bill=await (await page.request.post('/api/documents',{data:{type:'bill',customer:'Status correction customer',phone:'9876543210',items:[{id:'ceramic',quantity:1,price:100}],discount:0,gstRate:0}})).json();
 await page.request.post('/api/payments',{data:{documentId:bill.id,key:'original-receipt',amount:100,method:'Cash',date:'2026-10-29',reference:'Original receipt'}});
 await page.goto('/');await expect(page.locator('#admin-nav')).toBeVisible();
 await page.evaluate(()=>showDesk('bill'));
 const badge=page.locator(`[data-payment-status="${bill.id}"]`);
 await expect(badge).toContainText('Paid');await badge.click();
 await page.locator('#payment-status-form [name=reason]').fill('Payment was recorded against the wrong bill');
 await page.locator('#payment-status-form button[type=submit]').click();
 await expect(badge).toContainText('Unpaid');
 let saved=(await (await page.request.get('/api/documents')).json()).find(d=>String(d.id)===String(bill.id));
 expect(saved.payments).toHaveLength(2);
 expect(saved.payments[0].amount).toBe(100);expect(saved.payments[1].amount).toBe(-100);
 expect(saved.payments[1].recordedBy).toBeTruthy();
 const correction={documentId:bill.id,key:'mark-paid-correction',version:2,previousStatus:'Unpaid',status:'Paid',reason:'Payment confirmed'};
 const anonymous=await playwright.request.newContext({baseURL:'http://127.0.0.1:3107'});
 expect((await anonymous.patch('/api/payments',{data:correction})).status()).toBe(403);await anonymous.dispose();
 expect((await page.request.patch('/api/payments',{data:correction})).ok()).toBeTruthy();
 expect((await page.request.patch('/api/payments',{data:correction})).ok()).toBeTruthy();
 expect((await page.request.patch('/api/payments',{data:{...correction,key:'stale-change',status:'Unpaid'}})).status()).toBe(409);
 saved=(await (await page.request.get('/api/documents')).json()).find(d=>String(d.id)===String(bill.id));
 expect(saved.payments).toHaveLength(3);expect(saved.status).toBe('Paid');
});

test('cart shows complete photos and usable controls on small phones',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Add Ceramic Coating to your request',exact:true}).click();
 await page.locator('#basket-open').click();
 for(const width of [390,320]){
  await page.setViewportSize({width,height:740});
  const image=page.locator('#basket-items .cart-photo');
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
  expect(await image.evaluate(img=>getComputedStyle(img).objectFit)).toBe('contain');
  expect(await page.locator('#basket-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
 }
 await page.locator('#basket-items [data-step="1"]').click();
 await expect(page.locator('#basket-items [data-quantity]')).toHaveValue('2');
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await page.locator('.basket-item').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
});
