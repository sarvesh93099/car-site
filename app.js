const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR',maximumFractionDigits:2}).format(value);
const date = value => new Date(value).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
const docNumber = doc => `V31-${doc.type==='bill'?'B':'Q'}-${String(doc.id).padStart(4,'0')}`;
const state = {user:null,products:[],basket:{},category:'All',role:'customer',register:false,desk:'requests',documents:[],requests:[],documentType:'quotation'};
let toastTimer;
let documentPdf=null, pdfRequest=null, sharingPdf=false;
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4000);}
async function api(path,method='GET',data){
 const response=await fetch(`/api/${path}`,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 let payload;try{payload=await response.json();}catch{throw new Error('We couldn’t reach the studio. Please try again in a moment.');}
 if(!response.ok){if(response.status===401||response.status===403){const check=await fetch('/api/session');if(check.ok){state.user=(await check.json()).user;renderAccount();}}throw new Error(payload.error||'Unable to complete this request.');}return payload;
}
function openDialog(id){$(id).showModal();$(id).scrollTop=0;}
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollBehavior = () => prefersReducedMotion() ? 'instant' : 'smooth';
function productArt(p){
 const car='<path d="m51 116 12-27 47-7 31-24h69l38 29 26 9 6 24-14 9H63Z"/><path d="m116 82 29-19h61l28 22ZM162 64v19M93 99h151M57 109h24m169-9 20 5"/><circle cx="96" cy="126" r="18"/><circle cx="237" cy="126" r="18"/><circle cx="96" cy="126" r="8"/><circle cx="237" cy="126" r="8"/>';
 const shine='<path d="m248 30 4 12 12 4-12 4-4 12-4-12-12-4 12-4ZM66 41l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/>';
 const type=p.kind==='Product'?'care':p.id==='bike-detail'?'bike':p.category==='Protection'?'protection':p.category==='Coatings'?'coating':p.category==='Deep cleaning'?'clean':'detail';
 const art={
  protection:`<path d="m160 21 49 18v35c0 33-49 57-49 57s-49-24-49-57V39Z" fill="currentColor" fill-opacity=".08"/><g transform="translate(24 38) scale(.85)">${car}</g><path d="m145 54 11 11 20-22"/>`,
  coating:`<path d="m74 99 87-44 87 44-87 43Z" fill="currentColor" fill-opacity=".12"/><path d="m74 113 87 43 87-43M74 128l87 43 87-43"/><path d="M175 69c0 19-28 19-28 0 0-9 14-29 14-29s14 20 14 29Z" fill="currentColor" fill-opacity=".15"/>${shine}`,
  clean:`<path d="M129 39h36a12 12 0 0 1 12 12v50l34 19v17h-83c-17 0-27-13-23-27l12-59a12 12 0 0 1 12-12Z" fill="currentColor" fill-opacity=".09"/><path d="m136 58-9 48 38 14h32M128 137v12m64-12v12M136 72h28M131 91h33"/>${shine}`,
  care:`<path d="M137 30h48v16h-48ZM143 46v17l-13 15v74h62V78l-13-15V46M130 99h62M130 135h62" fill="currentColor" fill-opacity=".1"/><path d="M150 116h22m-11-8v16"/>${shine}`,
  bike:`<circle cx="90" cy="122" r="28"/><circle cx="237" cy="122" r="28"/><path d="m90 122 42-52 36 52H90m78 0 37-45 32 45m-39-65h17l22 65M118 68h30M145 88h48l-12 27h-22"/>${shine}`,
  detail:`${car}${shine}<path d="M111 154h111" stroke-dasharray="4 6"/>`
 };
 return `<svg viewBox="0 0 320 180" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false"><circle cx="160" cy="90" r="76" stroke-opacity=".13"/><circle cx="160" cy="90" r="61" stroke-opacity=".1" stroke-dasharray="3 7"/>${art[type]}</svg><span class="art-label">${({protection:'A LITTLE EXTRA ARMOUR',coating:'DEPTH. GLOSS. BRILLIANCE.',clean:'A FRESH START, INSIDE & OUT',care:'YOUR EVERYDAY ESSENTIALS',bike:'TWO WHEELS. SAME OBSESSION.',detail:'THE FINISHING TOUCH'})[type]}</span>`;
}
function isAdmin(){return state.user?.role==='admin';}
function requireAdmin(){if(!isAdmin()){toast('Log in as an administrator to continue.');return false;}return true;}
function renderAccount(){
 $('login-open').textContent=state.user?`${state.user.name.split(' ')[0]} · Log out`:'Log in ↗';
 $('admin-nav').hidden=!isAdmin();$('add-product').hidden=!isAdmin();$('account-requests').hidden=!state.user||isAdmin();
 if(!isAdmin()) {state.documents=[];['document-dialog','product-dialog','view-dialog'].forEach(id=>$(id).close());}
 if(!state.user) showStore();
}
function renderCatalogue(){
 const focusedCategory=document.activeElement?.dataset.category;
 const categories=['All',...new Set(state.products.map(p=>p.category))];
 $('categories').innerHTML=categories.map(c=>`<button class="tab ${state.category===c?'active':''}" data-category="${esc(c)}" aria-pressed="${state.category===c}">${esc(c)}</button>`).join('');
 $('category-options').innerHTML=categories.slice(1).map(c=>`<option value="${esc(c)}"></option>`).join('');
 const term=$('search').value.toLowerCase().trim();const products=state.products.filter(p=>(state.category==='All'||state.category===p.category)&&`${p.name} ${p.category} ${p.description}`.toLowerCase().includes(term));
 $('result-count').textContent=`${products.length} ${products.length===1?'option':'options'} ${state.category==='All'?'to make it yours':'in '+state.category.toLowerCase()}`;
 $('products').innerHTML=products.length?products.map((p,index)=>`<article class="product-card" data-tone="${p.category==='Protection'?'lime':p.category==='Coatings'?'aqua':p.category==='Deep cleaning'?'violet':'amber'}"><div class="product-top"><span class="product-category">${esc(p.category)}</span><span class="product-index">${String(index+1).padStart(2,'0')}</span></div><div class="product-art" aria-hidden="true">${productArt(p)}</div><div class="product-info"><span class="kind">${esc(p.kind)}</span><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><div class="product-bottom"><div><small>${p.price?(p.kind==='Product'?'Listed price':'Starting from'):'Made for your vehicle'}</small><b>${p.price?money(p.price):'On request'}</b></div><button class="add-button ${state.basket[p.id]?'selected':''}" data-add="${esc(p.id)}" aria-label="Add ${esc(p.name)} to your request">${state.basket[p.id]?'✓ Added '+state.basket[p.id]+' · +':'+ Add'}</button></div></div></article>`).join(''):'<div class="empty catalogue-empty"><h3>Let’s find the right care.</h3><p>No matches this time. Try another search or explore the full collection.</p><button class="button dark" data-reset-filters>Show all services & products ↗</button></div>';
 document.querySelectorAll('[data-quick-filter]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.quickFilter===state.category));
 if(focusedCategory) [...$('categories').children].find(button=>button.dataset.category===focusedCategory)?.focus({preventScroll:true});
}
function updateDock(){
 const count=Object.values(state.basket).reduce((sum,quantity)=>sum+quantity,0);
 const total=state.products.reduce((sum,p)=>sum+p.price*(state.basket[p.id]||0),0);
 const hasCustom=state.products.some(p=>state.basket[p.id]&&!p.price);
 $('request-dock').hidden=!count||$('storefront').hidden;
 $('dock-count').textContent=`${count} ${count===1?'item':'items'} selected`;
 $('dock-total').textContent=total?`From ${money(total)}${hasCustom?' + custom items':''}`:'Pricing confirmed by our team';
 document.body.classList.toggle('has-request',!$('request-dock').hidden);
}
function saveBasket(){try{localStorage.setItem('v31_basket_v2',JSON.stringify(state.basket));}catch{}$('basket-count').textContent=Object.values(state.basket).reduce((a,b)=>a+b,0);updateDock();document.querySelectorAll('[data-add]').forEach(button=>{const quantity=state.basket[button.dataset.add]||0;button.textContent=quantity?`✓ Added ${quantity} · +`:'+ Add';button.classList.toggle('selected',quantity>0);});}
function addItem(id){if(state.basket[id]>=100){toast('You can request up to 100 of each item.');return;}state.basket[id]=(state.basket[id]||0)+1;saveBasket();if(!prefersReducedMotion())$('basket-count').animate([{transform:'scale(1)'},{transform:'scale(1.3)'},{transform:'scale(1)'}],{duration:300});toast(`${state.products.find(p=>p.id===id)?.name||'Item'} added to your request.`);}
function renderBasket(){
 const entries=Object.entries(state.basket).map(([id,quantity])=>({...state.products.find(p=>p.id===id),quantity})).filter(p=>p.id);
 $('request-success').hidden=true;$('request-fields').hidden=!entries.length;
 $('basket-items').innerHTML=entries.length?entries.map(p=>`<div class="basket-item"><div><b>${esc(p.name)}</b><small>${p.price?money(p.price):'Price on request'}</small><button type="button" class="text-link" data-remove="${esc(p.id)}">Remove</button></div><div class="quantity-stepper"><button type="button" data-step="-1" data-product="${esc(p.id)}" aria-label="Decrease ${esc(p.name)} quantity" ${p.quantity===1?'disabled':''}>−</button><input type="number" min="1" max="100" value="${p.quantity}" data-quantity="${esc(p.id)}" aria-label="${esc(p.name)} quantity"><button type="button" data-step="1" data-product="${esc(p.id)}" aria-label="Increase ${esc(p.name)} quantity" ${p.quantity===100?'disabled':''}>+</button></div></div>`).join(''):'<div class="empty"><h3>A little care starts here.</h3><p>Add a product or service from the catalogue to begin your request.</p><button class="button dark" type="button" data-browse>Explore catalogue ↗</button></div>';
 $('basket-total').textContent=money(entries.reduce((sum,p)=>sum+p.price*p.quantity,0));
 if(state.user&&!$('request-form').elements.customer.value)$('request-form').elements.customer.value=state.user.name;
}
function showStore(){ $('workspace').hidden=true;$('storefront').hidden=false;updateDock(); }
async function showDesk(tab='requests'){
 if(!state.user)return; if(tab!=='requests'&&!requireAdmin())return;
 state.desk=tab;$('storefront').hidden=true;$('workspace').hidden=false;updateDock();window.scrollTo({top:0,behavior:'instant'});
 $('desk-title').textContent=isAdmin()?'THE WORKBENCH.':'YOUR REQUESTS.';
 $('desk-eyebrow').textContent=isAdmin()?'V31 / STUDIO DESK':'V31 / YOUR ACCOUNT';
 $('desk-tabs').innerHTML=(isAdmin()?[['requests','Customer requests'],['quotation','Quotations'],['bill','Billing']]:[['requests','My requests']]).map(([key,label])=>`<button class="tab ${tab===key?'active':''}" data-desk="${key}">${label}</button>`).join('');
 $('desk-content').innerHTML='<p class="empty">Loading your records…</p>';$('desk-toolbar').innerHTML='';
 try{
  if(tab==='requests')state.requests=await api('requests');else state.documents=await api('documents');
  if(state.desk!==tab||!state.user)return;
  $('desk-toolbar').innerHTML=`<p class="muted">${tab==='requests'?'Requests are confirmed by the studio.':tab==='bill'?'Create bills, record payment status and share with customers.':'Prepare and share pricing with your customers.'}</p>${tab!=='requests'?`<button class="button dark" data-new-document="${tab}">Create ${tab==='bill'?'bill':'quotation'} +</button>`:'<button class="button outline" id="refresh-requests">Refresh ↻</button>'}`;
  renderRecords();
 }catch(e){$('desk-content').innerHTML=`<p class="empty">${esc(e.message)}</p>`;}
}
function renderRecords(){
 const requests=state.desk==='requests';const rows=requests?state.requests:state.documents.filter(d=>d.type===state.desk);
 $('desk-content').innerHTML=rows.length?`<div class="record-list">${rows.map(r=>`<article class="record"><div class="record-main"><p class="eyebrow">${requests?'REQUEST #'+r.id:docNumber(r)} <span> / ${date(r.date)}</span></p><h3>${esc(r.customer)}</h3><p>${esc(r.vehicle||'Vehicle not specified')}</p><small>${r.items.map(i=>`${esc(i.name)} × ${i.quantity}`).join(' · ')}</small>${requests?`<p>${esc(r.phone)}</p>${r.note?`<p class="customer-note">${esc(r.note)}</p>`:''}`:''}</div><div class="record-side">${requests?'':`<b class="record-total">${money(r.total)}</b>`}${isAdmin()?`<label class="status-label">Status<select data-status="${r.id}" data-resource="${requests?'requests':'documents'}">${(requests?['New','Contacted','Confirmed','Completed','Cancelled']:r.type==='bill'?['Unpaid','Paid']:['Draft','Accepted','Declined']).map(s=>`<option ${s===r.status?'selected':''}>${s}</option>`).join('')}</select></label>`:`<span class="status">${esc(r.status)}</span>`}<div class="button-group">${requests?(isAdmin()?`<button class="button outline" data-request-quote="${r.id}">Create quote ↗</button>`:''):`<button class="button outline" data-view-document="${r.id}">View & share ↗</button>${r.type==='quotation'?`<button class="text-link" data-convert="${r.id}">Create bill</button>`:''}`}</div></div></article>`).join('')}</div>`:`<div class="empty"><h3>${requests?'No requests yet.':`No ${state.desk==='bill'?'bills':'quotations'} yet.`}</h3><p>${requests?'Requests submitted while logged in appear here.':'Create your first document using the button above.'}</p></div>`;
}
function loginMode(){
 document.querySelectorAll('[data-role]').forEach(b=>{b.classList.toggle('selected',b.dataset.role===state.role);b.setAttribute('aria-pressed',b.dataset.role===state.role);});
 $('register-name').hidden=!state.register;$('login-form').elements.name.required=state.register;
 $('login-form').elements.password.autocomplete=state.register?'new-password':'current-password';
 $('login-form').elements.password.minLength=state.register?12:1;
 $('login-title').textContent=state.register?'Make yourself at home.':state.role==='admin'?'Back to the studio.':'Your studio connection.';
 $('login-submit').textContent=state.register?'Create account ↗':'Log in ↗';
 $('register-toggle').hidden=state.role==='admin';$('register-toggle').textContent=state.register?'Already registered? Log in':'New here? Create an account';
 $('login-help').textContent=state.register?'Use a password with at least 12 characters.':state.role==='admin'?'Use your studio administrator credentials.':'Log in to keep track of your requests.';
 $('login-error').textContent='';
}
function openDocument(type,source){
 if(!requireAdmin())return;state.documentType=type;
 const form=$('document-form');form.reset();form.elements.phone.setCustomValidity('');$('document-error').textContent='';
 $('document-title').textContent=`Create ${type==='bill'?'bill':'quotation'}.`;$('preview-type').textContent=type.toUpperCase();
 for(const field of ['customer','phone','vehicle','note'])form.elements[field].value=source?.[field]||'';
 form.elements.discount.value=source?.discount||0;form.elements.gstRate.value=source?.gstRate??18;
 $('document-picker').innerHTML=state.products.length?state.products.map(p=>{const selected=source?.items?.find(i=>i.id===p.id);return `<div class="picker-row" data-product="${esc(p.id)}"><label class="picker-name"><input type="checkbox" class="pick" ${selected?'checked':''}><span>${esc(p.name)}</span></label><label class="picker-quantity">Qty<input class="pick-qty" type="number" min="1" max="100" step="1" value="${selected?.quantity||1}" ${selected?'':'disabled'} aria-label="${esc(p.name)} quantity"></label><label class="picker-price">Price (₹)<input class="pick-price" type="number" min="0" max="10000000" step="0.01" value="${selected?.price??p.price}" ${selected?'':'disabled'} aria-label="${esc(p.name)} price"></label></div>`;}).join(''):'<div class="empty"><h3>No catalogue items yet.</h3><p>Open Catalogue and add a product or service before creating a bill.</p></div>';
 renderDocumentPreview();openDialog('document-dialog');
}
function documentData(){const f=$('document-form');return {type:state.documentType,...Object.fromEntries(new FormData(f)),discount:Number(f.elements.discount.value),gstRate:Number(f.elements.gstRate.value),items:[...document.querySelectorAll('.picker-row')].filter(r=>r.querySelector('.pick').checked).map(r=>({id:r.dataset.product,quantity:Number(r.querySelector('.pick-qty').value),price:Number(r.querySelector('.pick-price').value)}))};}
function totals(data){const round=n=>Math.round((n+Number.EPSILON)*100)/100;const subtotal=round(data.items.reduce((s,i)=>s+i.price*i.quantity,0));const gst=round(Math.max(0,subtotal-data.discount)*data.gstRate/100);return{subtotal,discount:data.discount,gstRate:data.gstRate,gst,total:round(Math.max(0,subtotal-data.discount)+gst)};}
function totalsHTML(d){return `<div class="total-row"><span>Subtotal</span><b>${money(d.subtotal)}</b></div><div class="total-row"><span>Discount</span><b>− ${money(d.discount)}</b></div><div class="total-row"><span>GST (${d.gstRate}%)</span><b>${money(d.gst)}</b></div><div class="total-row grand"><span>Total</span><b>${money(d.total)}</b></div>`;}
function renderDocumentPreview(){const d=documentData();$('preview-customer').textContent=d.customer||'Prepared for your customer';$('preview-lines').innerHTML=d.items.length?d.items.map(i=>`<div class="preview-line"><span>${esc(state.products.find(p=>p.id===i.id)?.name)} × ${i.quantity}</span><b>${money(i.price*i.quantity)}</b></div>`).join(''):'<p class="muted">Choose an item to start.</p>';$('preview-totals').innerHTML=totalsHTML(totals(d));}
function whatsappText(d){return [`*V31 CONCEPTS | ${d.type==='bill'?'BILL':'QUOTATION'}*`,docNumber(d),date(d.date),'',`Customer: ${d.customer}`,d.vehicle?`Vehicle: ${d.vehicle}`:'','',...d.items.map(i=>`${i.name} × ${i.quantity} @ ${money(i.price)} = ${money(i.price*i.quantity)}`),'',`Subtotal: ${money(d.subtotal)}`,`Discount: ${money(d.discount)}`,`GST (${d.gstRate}%): ${money(d.gst)}`,`*${d.type==='bill'?'Total':'Estimated total'}: ${money(d.total)}*`,`Status: ${d.status}`,d.note?`Note: ${d.note}`:'',d.type==='quotation'?'Final scope and pricing subject to vehicle assessment.':'Thank you for choosing V31 Concepts.'].join('\n');}
async function prepareDocumentPdf(d){
 pdfRequest?.abort();
 const request=new AbortController();pdfRequest=request;documentPdf=null;
 $('download-document').disabled=true;$('share-pdf').disabled=true;$('retry-pdf').hidden=true;
 $('pdf-status').textContent='Preparing PDF…';$('whatsapp-chat').hidden=true;
 $('share-document').hidden=d.type==='bill';
 $('whatsapp-chat').href=`https://wa.me/${d.phone.replace(/\D/g,'')}`;
 try{
  const response=await fetch(`/api/documents/${d.id}/pdf`,{signal:request.signal});
  if(!response.ok)throw new Error((await response.json()).error||'Unable to prepare PDF.');
  if(!response.headers.get('content-type')?.includes('application/pdf'))throw new Error('Unable to prepare PDF.');
  const blob=await response.blob();
  if(request.signal.aborted)return;
  documentPdf=new File([blob],`${docNumber(d)}.pdf`,{type:'application/pdf'});
  $('download-document').disabled=false;$('share-pdf').disabled=sharingPdf;
  $('pdf-status').textContent=`PDF ready for ${d.customer} (${d.phone}). Choose WhatsApp and the customer in the share menu. If file sharing is unavailable, download the PDF and attach it in their chat.`;
 }catch(error){
  if(request.signal.aborted)return;
  $('pdf-status').textContent=`${error.message} Please retry.`;
  $('retry-pdf').hidden=false;$('retry-pdf').onclick=()=>prepareDocumentPdf(d);
 }
}
function downloadDocumentPdf(){
 if(!documentPdf)return;
 const url=URL.createObjectURL(documentPdf),link=document.createElement('a');
 link.href=url;link.download=documentPdf.name;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
 $('whatsapp-chat').hidden=false;
 $('pdf-status').textContent=`Downloaded ${documentPdf.name}. Open the customer's WhatsApp chat, attach this PDF as a document, and tap Send.`;
}
async function shareDocumentPdf(){
 if(!documentPdf||sharingPdf)return;
 const file=documentPdf;
 try{
  if(!navigator.share||!navigator.canShare?.({files:[file]})){downloadDocumentPdf();return;}
  sharingPdf=true;$('share-pdf').disabled=true;
  // The file is prepared before the click to preserve browser user activation.
  await navigator.share({files:[file]});
  if(documentPdf===file)$('pdf-status').textContent='PDF handed to the selected app. Complete sending there.';
 }catch(error){
  if(documentPdf!==file)return;
  if(error.name==='AbortError')$('pdf-status').textContent='Sharing cancelled. You can share again or download the PDF.';
  else {$('pdf-status').textContent='File sharing is unavailable. Download the PDF, then attach it in the customer’s WhatsApp chat.';$('whatsapp-chat').hidden=false;}
 }finally{sharingPdf=false;$('share-pdf').disabled=!documentPdf;}
}
function viewDocument(d){
 if(!requireAdmin())return;
 $('saved-document').innerHTML=`<div class="invoice-brand"><div><img class="invoice-logo" src="/assets/images/company_logo.jpeg" alt="V31 Concepts logo"><span>CONCEPTS / DETAILING STUDIO</span></div><div><h2>${d.type==='bill'?'BILL':'QUOTATION'}</h2><p>${docNumber(d)}<br>${date(d.date)}</p></div></div><div class="invoice-customer"><p class="eyebrow">PREPARED FOR</p><h3>${esc(d.customer)}</h3><p>${esc(d.phone)}<br>${esc(d.vehicle)}</p><span class="status">${esc(d.status)}</span></div><div class="invoice-table-wrap"><table class="invoice-table"><thead><tr><th>Product / service</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${d.items.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.quantity}</td><td>${money(i.price)}</td><td>${money(i.price*i.quantity)}</td></tr>`).join('')}</tbody></table></div><div class="invoice-totals">${totalsHTML(d)}</div>${d.note?`<p class="customer-note">${esc(d.note)}</p>`:''}<p class="fine-print">${d.type==='quotation'?'Final scope and pricing subject to vehicle assessment.':'Thank you for choosing V31 Concepts.'}</p>`;
 $('share-document').href=`https://wa.me/${d.phone.replace(/\D/g,'')}?text=${encodeURIComponent(whatsappText(d))}`;openDialog('view-dialog');prepareDocumentPdf(d);
}
async function submit(form,errorId,work){const button=form.querySelector('[type="submit"]');const label=button.innerHTML;button.disabled=true;button.textContent='One moment…';form.setAttribute('aria-busy','true');$(errorId).textContent='';try{await work();}catch(e){$(errorId).textContent=e.message;$(errorId).scrollIntoView({block:'nearest',behavior:scrollBehavior()});}finally{button.disabled=false;button.innerHTML=label;form.removeAttribute('aria-busy');}}
$('login-form').addEventListener('submit',e=>{e.preventDefault();submit(e.target,'login-error',async()=>{const values=Object.fromEntries(new FormData(e.target));const result=await api(state.register?'register':'login','POST',{...values,role:state.role});state.user=result.user;renderAccount();$('login-dialog').close();e.target.reset();toast(`Welcome, ${state.user.name}.`);if(isAdmin())await showDesk();});});
$('request-form').addEventListener('submit',e=>{e.preventDefault();submit(e.target,'request-error',async()=>{const data={...Object.fromEntries(new FormData(e.target)),items:Object.entries(state.basket).map(([id,quantity])=>({id,quantity}))};const result=await api('requests','POST',data);state.basket={};saveBasket();renderCatalogue();$('basket-items').innerHTML='';$('request-fields').hidden=true;$('request-success').hidden=false;$('request-success').innerHTML=`<div class="success-mark">✓</div><p class="eyebrow">REQUEST #${result.id}</p><h2>You’re on our list.</h2><p>Thanks, ${esc(result.customer)}. Your request is with the studio. We’ll contact you at <b>${esc(result.phone)}</b> to confirm the details.</p><p class="fine-print">${state.user?'You can follow its status in your requests.':'Keep your request number for reference.'}</p><button class="button dark" type="button" data-close>Continue browsing ↗</button>`;e.target.reset();});});
$('product-form').addEventListener('submit',e=>{e.preventDefault();if(!requireAdmin())return;submit(e.target,'product-error',async()=>{const data=Object.fromEntries(new FormData(e.target));const p=await api('products','POST',{...data,price:Number(data.price)});state.products.unshift(p);state.category='All';$('search').value='';renderCatalogue();$('product-dialog').close();e.target.reset();toast('Added to the public catalogue.');});});
$('document-form').addEventListener('submit',e=>{e.preventDefault();if(!requireAdmin())return;submit(e.target,'document-error',async()=>{const d=await api('documents','POST',documentData());$('document-dialog').close();await showDesk(d.type);viewDocument(d);toast(`${d.type==='bill'?'Bill':'Quotation'} saved: ${docNumber(d)}`);});});
$('document-form').addEventListener('input',()=>{document.querySelectorAll('.picker-row').forEach(r=>{const disabled=!r.querySelector('.pick').checked;r.querySelector('.pick-qty').disabled=disabled;r.querySelector('.pick-price').disabled=disabled;});renderDocumentPreview();});
$('search').addEventListener('input',renderCatalogue);
$('basket-open').onclick=()=>{renderBasket();$('request-error').textContent='';openDialog('basket-dialog');};
$('dock-open').onclick=()=>{renderBasket();$('request-error').textContent='';openDialog('basket-dialog');};
$('login-open').onclick=async()=>{if(state.user){try{await api('logout','POST',{});state.user=null;state.requests=[];renderAccount();toast('You’re logged out.');}catch(e){toast(e.message);}}else{state.register=false;loginMode();openDialog('login-dialog');}};
$('register-toggle').onclick=()=>{state.register=!state.register;loginMode();};
$('admin-nav').onclick=()=>showDesk();$('account-requests').onclick=()=>showDesk();$('back-store').onclick=()=>{showStore();location.hash='catalogue';};
$('add-product').onclick=()=>{if(requireAdmin()){$('product-error').textContent='';openDialog('product-dialog');}};
$('print-document').onclick=()=>window.print();
$('download-document').onclick=downloadDocumentPdf;
$('share-pdf').onclick=shareDocumentPdf;
$('view-dialog').addEventListener('close',()=>{pdfRequest?.abort();documentPdf=null;});
window.addEventListener('hashchange',()=>{if(['#home','#catalogue','#approach'].includes(location.hash)){showStore();document.querySelector(location.hash)?.scrollIntoView({behavior:scrollBehavior()});}});
// Delegated handlers keep catalogue and record updates lightweight.
document.addEventListener('click',async e=>{
 const b=e.target.closest('button, a');if(!b)return;
 try{
 if(b.hasAttribute('data-close'))b.closest('dialog').close();
 if(b.hasAttribute('data-browse')){b.closest('dialog').close();showStore();location.hash='catalogue';$('catalogue').scrollIntoView({behavior:scrollBehavior()});}
 if(b.dataset.category){state.category=b.dataset.category;renderCatalogue();}
 if(b.dataset.quickFilter){state.category=b.dataset.quickFilter;$('search').value='';renderCatalogue();$('catalogue-tools')?.scrollIntoView({behavior:scrollBehavior()});}
 if(b.hasAttribute('data-reset-filters')){state.category='All';$('search').value='';renderCatalogue();$('search').focus({preventScroll:true});}
 if(b.dataset.add)addItem(b.dataset.add);
 if(b.dataset.remove){delete state.basket[b.dataset.remove];saveBasket();renderBasket();const next=$('basket-items').querySelector('button');next?.focus({preventScroll:true});}
 if(b.dataset.step){const id=b.dataset.product;state.basket[id]=Math.max(1,Math.min(100,state.basket[id]+Number(b.dataset.step)));saveBasket();renderBasket();const buttons=[...$('basket-items').querySelectorAll('[data-step]')].filter(button=>button.dataset.product===id);(buttons.find(button=>button.dataset.step===b.dataset.step&&!button.disabled)||buttons.find(button=>!button.disabled))?.focus({preventScroll:true});}
 if(b.dataset.role){state.role=b.dataset.role;state.register=false;loginMode();}
 if(b.dataset.desk)await showDesk(b.dataset.desk);
 if(b.id==='refresh-requests')await showDesk('requests');
 if(b.dataset.newDocument)openDocument(b.dataset.newDocument);
 if(b.dataset.viewDocument)viewDocument(state.documents.find(d=>d.id===Number(b.dataset.viewDocument)));
 if(b.dataset.convert)openDocument('bill',state.documents.find(d=>d.id===Number(b.dataset.convert)));
 if(b.dataset.requestQuote)openDocument('quotation',state.requests.find(d=>d.id===Number(b.dataset.requestQuote)));
 if(b.matches('a[href^="#"]')&&b.hash){showStore();requestAnimationFrame(()=>document.querySelector(b.hash)?.scrollIntoView({behavior:scrollBehavior()}));}
 }catch(err){toast(err.message);}
});
document.addEventListener('change',async e=>{
 const input=e.target;
 if(input.dataset.quantity){state.basket[input.dataset.quantity]=Math.max(1,Math.min(100,Math.floor(Number(input.value)||1)));saveBasket();renderBasket();}
 if(input.dataset.status){const resource=input.dataset.resource;input.disabled=true;try{const updated=await api(`${resource}/${input.dataset.status}`,'PATCH',{status:input.value});const list=resource==='requests'?state.requests:state.documents;Object.assign(list.find(r=>r.id===updated.id),updated);toast('Status updated.');}catch(err){toast(err.message);}finally{renderRecords();}}
});
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const rect=dialog.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dialog.close();}}));
function validatePhone(input){
 const raw=input.value.trim();let phone=raw.replace(/[\s()-]/g,'');
 if(phone.startsWith('00'))phone=`+${phone.slice(2)}`;
 else if(/^0[6-9]\d{9}$/.test(phone))phone=`+91${phone.slice(1)}`;
 else if(/^[6-9]\d{9}$/.test(phone))phone=`+91${phone}`;
 else if(/^91[6-9]\d{9}$/.test(phone))phone=`+${phone}`;
 const valid=!raw||(/^[+\d\s()-]+$/.test(raw)&&/^\+[1-9]\d{7,14}$/.test(phone));
 input.setCustomValidity(valid?'':'Enter your 10-digit mobile number, or include a country code for an international number.');
 if(valid)input.removeAttribute('aria-invalid');
 return valid;
}
document.querySelectorAll('input[name="phone"]').forEach(input=>{
 input.addEventListener('input',()=>validatePhone(input));
 input.addEventListener('blur',()=>{if(!validatePhone(input))input.setAttribute('aria-invalid','true');});
 input.addEventListener('invalid',()=>input.setAttribute('aria-invalid','true'));
});
function initMotion(){
 const reveal=[...document.querySelectorAll('.reveal')];
 if(!prefersReducedMotion()&&'IntersectionObserver' in window){
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target);}}),{threshold:.08});
  document.documentElement.classList.add('motion-ready');reveal.forEach(element=>observer.observe(element));
 }
 let queued=false;
 const progress=()=>{const range=document.documentElement.scrollHeight-innerHeight;$('scroll-progress').style.transform=`scaleX(${range>0?Math.min(1,scrollY/range):0})`;queued=false;};
 window.addEventListener('scroll',()=>{if(!queued){queued=true;requestAnimationFrame(progress);}},{passive:true});
 window.addEventListener('resize',progress);progress();
}
async function init(){
 $('year').textContent=new Date().getFullYear();
 if(location.protocol==='file:'){$('products').innerHTML='<div class="empty"><h3>Start your studio server</h3><p>Run <code>npm start</code> in this folder, then open <a href="http://localhost:3000">http://localhost:3000</a>. Accounts and records require the server.</p></div>';return;}
 try{const [products,session]=await Promise.all([api('products'),api('session')]);state.products=products;state.user=session.user;
 try{const saved=JSON.parse(localStorage.getItem('v31_basket_v2')||'{}');for(const p of products){if(Number.isInteger(saved[p.id])&&saved[p.id]>0&&saved[p.id]<=100)state.basket[p.id]=saved[p.id];}}catch{}
 saveBasket();renderAccount();renderCatalogue();
 }catch(e){$('products').innerHTML=`<div class="empty">${esc(e.message)} <button class="button outline" id="retry-load">Try again</button></div>`;$('retry-load').onclick=init;}
}
initMotion();init();
