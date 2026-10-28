import { randomUUID } from 'node:crypto';

export function paymentSummary(document) {
 const paid=document.payments?.length?Math.round(document.payments.reduce((sum,p)=>sum+p.amount,0)*100)/100:document.status==='Paid'?document.total:0;
 const balance=Math.max(0,Math.round((document.total-paid)*100)/100);
 return {paid,balance,status:balance===0?'Paid':paid>0?'Partially paid':'Unpaid'};
}

export function createWorkflow({db,admin,body,fail,string,number,round,list}) {
 const stages=['Scheduled','In progress','Quality check','Ready','Delivered'];
 const day=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail(400,'Choose a valid date.');return value;};
 const get=async(table,id)=>{const row=await db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);if(!row)fail(404,'Record not found.');return {row,data:JSON.parse(row.data)};};
 // Compare-and-swap prevents lost updates across tabs and server instances.
 const update=async(table,id,mutate)=>{
  for(let attempt=0;attempt<5;attempt++){
   const {row,data}=await get(table,id);await mutate(data);
   const result=await db.prepare(`UPDATE ${table} SET data=? WHERE id=? AND data=?`).run(JSON.stringify(data),id,row.data);
   if(result.changes)return {...data,id};
  }
  fail(409,'This record changed. Refresh and try again.');
 };
 return async({path,method,url,req,user,json})=>{
  if(!['/api/jobs','/api/payments'].includes(path))return false;
  admin(user);
  if(path==='/api/payments'){
   if(method!=='POST')fail(405,'Method not allowed.');
   const b=await body(req),id=number(Number(b.documentId),'bill ID'),key=string(b.key,'payment key',100);
   const amount=round(number(b.amount,'payment amount',100000000000));if(amount<=0||Math.abs(b.amount-amount)>.000001)fail(400,'Enter a positive amount with up to two decimal places.');
   if(!['Cash','UPI','Card','Bank transfer'].includes(b.method))fail(400,'Choose a payment method.');
   const payment={key,amount,method:b.method,date:day(b.date),reference:string(b.reference||'','reference',150,false),recordedAt:new Date().toISOString(),recordedBy:user.name};
   const result=await update('documents',id,data=>{
    if(data.type!=='bill')fail(400,'Payments can only be recorded against bills.');
    const existing=data.payments?.find(p=>p.key===key);
    if(existing){if(['amount','method','date','reference'].some(k=>existing[k]!==payment[k]))fail(409,'This payment key was already used.');return;}
    if(amount>paymentSummary(data).balance)fail(400,'Payment exceeds the remaining balance.');
    data.payments=[...(data.payments||[]),payment];data.status=paymentSummary(data).status;
   });
   json(result);return true;
  }
  if(method==='GET'){json(await list('jobs'));return true;}
  const b=await body(req);
  if(method==='POST'&&url.searchParams.has('bill')){
   const jobId=string(b.jobId,'job ID'),{data:job}=await get('jobs',jobId);
   if(!['Ready','Delivered'].includes(job.status))fail(409,'Complete the quality check before generating a bill.');
   const {data:quote}=await get('documents',job.quoteId);
   const {id:unused,...snapshot}=quote;
   const bill={...snapshot,type:'bill',jobId,quoteId:job.quoteId,status:'Unpaid',payments:[],date:new Date().toISOString()};
   await db.prepare('INSERT INTO documents(data) VALUES(?) ON CONFLICT DO NOTHING').run(JSON.stringify(bill));
   const saved=(await list('documents')).find(d=>d.jobId===jobId);
   json(saved);return true;
  }
  if(method==='POST'){
   const quoteId=number(Number(b.quoteId),'quotation ID'),{data:quote}=await get('documents',quoteId);
   if(quote.type!=='quotation'||quote.status!=='Accepted')fail(409,'Record customer acceptance before scheduling this quotation.');
   const data={quoteId,requestId:quote.requestId||null,customer:quote.customer,phone:quote.phone,vehicle:quote.vehicle,items:quote.items,status:'Scheduled',scheduledDate:day(b.scheduledDate),assignee:string(b.assignee,'assigned technician',100),note:string(b.note||'','job notes',1500,false),checklist:quote.items.map(i=>({name:i.name,done:false})),history:[{at:new Date().toISOString(),by:user.name,action:'Job scheduled'}]};
   await db.prepare('INSERT INTO jobs(id,quote_id,data) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(randomUUID(),quoteId,JSON.stringify(data));
   const row=await db.prepare('SELECT id,data FROM jobs WHERE quote_id=?').get(quoteId);json({...JSON.parse(row.data),id:row.id},201);return true;
  }
  if(method==='PATCH'){
   const id=string(b.id,'job ID');
   const result=await update('jobs',id,async data=>{
    if(b.version!==data.history.length)fail(409,'This job changed in another window. Reopen it before saving.');
    const next=b.status||data.status;
    if(!stages.includes(next)||(next!==data.status&&stages.indexOf(next)!==stages.indexOf(data.status)+1))fail(400,'Move through each job stage in order.');
    if(data.status==='Delivered')fail(409,'This job has already been delivered.');
    if(b.checklist!==undefined){if(!Array.isArray(b.checklist)||b.checklist.length!==data.checklist.length||b.checklist.some(v=>typeof v!=='boolean'))fail(400,'Invalid checklist.');data.checklist=data.checklist.map((item,i)=>({...item,done:b.checklist[i]}));}
    if(['Quality check','Ready','Delivered'].includes(next)&&data.checklist.some(i=>!i.done))fail(409,'Complete the service checklist first.');
    if(next==='Delivered'){
     const bill=(await list('documents')).find(d=>d.jobId===id);
     if(!bill||paymentSummary(bill).balance>0)fail(409,'Generate the bill and settle its balance before delivery.');
    }
    data.scheduledDate=day(b.scheduledDate??data.scheduledDate);data.assignee=string(b.assignee??data.assignee,'assigned technician',100);data.note=string(b.note??data.note,'job notes',1500,false);
    data.history.push({at:new Date().toISOString(),by:user.name,action:next===data.status?'Job details updated':`${data.status} → ${next}`});data.status=next;
   });json(result);return true;
  }
  fail(405,'Method not allowed.');
 };
}
