import {test,expect} from '@playwright/test';

test('quotation keeps local phone digits, selected items across search, images and mobile layout',async({page})=>{
 await page.request.post('/api/login',{data:{email:'admin@example.test',password:'browser-admin-password-2026',role:'admin'}});
 await page.goto('/');
 await expect(page.locator('#admin-nav')).toBeVisible();
 await page.evaluate(()=>openDocument('quotation'));
 await page.locator('#document-form [name=customer]').fill('Quotation customer');
 const phone=page.locator('#document-form [name=phone]');
 await phone.fill('+919876543210');
 await phone.blur();
 await expect(phone).toHaveValue('9876543210');
 await page.locator('[data-product=ceramic] .pick').check();
 await page.locator('[data-product=ceramic] .pick-price').fill('1000');
 await page.locator('#document-item-search').fill('wheel');
 await expect(page.locator('#document-item-count')).toHaveText('1 selected');
 await expect(page.locator('#preview-lines')).toContainText('Ceramic Coating');
 await expect.poll(()=>page.locator('#preview-lines img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:900});
  expect(await page.locator('#document-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
 }
 await page.locator('#document-form button[type=submit]').click();
 await expect(page.locator('#saved-document')).toContainText('9876543210');
 await expect(page.locator('#saved-document')).not.toContainText('+91');
 await expect(page.locator('#saved-document .invoice-item img')).toHaveCount(1);
 const records=await (await page.request.get('/api/documents')).json();
 const record=records.find(d=>d.customer==='Quotation customer');
 expect(record.total).toBe(1180);
 const response=await page.request.get(`/api/documents?pdf=${record.id}`);
 expect(response.ok()).toBeTruthy();
 const pdf=(await response.body()).toString('latin1');
 expect(pdf.startsWith('%PDF-')).toBeTruthy();
 expect((pdf.match(/\/Subtype \/Image/g)||[]).length).toBeGreaterThanOrEqual(2);
});
