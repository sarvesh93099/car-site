// Meta Cloud API credentials stay on the server. PDFs are uploaded directly to
// Meta; the application never creates a public invoice URL.
const error = (status, message, deliveryStatus) => Object.assign(new Error(message), {status, deliveryStatus});

export function whatsappConfig(env = process.env) {
 const token = env.WHATSAPP_ACCESS_TOKEN?.trim() || '';
 const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '';
 const version = env.WHATSAPP_API_VERSION?.trim() || '';
 const template = env.WHATSAPP_BILL_TEMPLATE?.trim() || '';
 const language = env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en_US';
 const mode = template ? 'template' : 'document';
 let message = '';
 if (!token || !phoneNumberId || !version) message = 'Direct WhatsApp sending needs WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_API_VERSION configured on the server.';
 else if (/\s/.test(token) || !/^\d{5,30}$/.test(phoneNumberId) || !/^v\d{1,3}\.0$/.test(version)) message = 'Check the server WhatsApp access token, phone number ID and API version settings.';
 else if (template && (!/^[a-z0-9_]{1,512}$/.test(template) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language))) message = 'Check the WhatsApp bill template name and language configured on the server.';
 return {token, phoneNumberId, version, template, language, mode, configured: !message,
  message: message || (template ? 'Bills are sent as PDF attachments using the configured WhatsApp template.' : 'Bills are sent as PDF attachments. The customer must have messaged your business within the last 24 hours.')};
}

export function whatsappReadiness(env = process.env) {
 const {configured, mode, message} = whatsappConfig(env);
 return {configured, mode, message};
}

function rejectedMessage(code, stage) {
 if (code === 131047) return 'WhatsApp requires an approved bill template outside the 24-hour customer service window. Configure WHATSAPP_BILL_TEMPLATE or ask the customer to message your business first.';
 if ([190, 10, 200, 131005].includes(code)) return 'WhatsApp rejected the server credentials or permissions. Check the access token and business phone number settings.';
 if ([132000, 132001, 132005, 132007, 132012, 132015, 132016].includes(code)) return 'WhatsApp rejected the bill template. Check its approval, language, document header and three body parameters.';
 if ([130429, 131048, 131056].includes(code)) return 'WhatsApp is limiting requests. Wait before trying again.';
 if (code === 131030) return 'WhatsApp rejected this recipient. If using a Meta test number, add the customer to its allowed recipients.';
 return stage === 'media' ? 'WhatsApp could not upload the bill PDF. Please try again later.' : 'WhatsApp rejected the bill. Check the recipient and your business account before trying again.';
}

// Each request has a bounded timeout, including response parsing. Upload plus
// send takes at most 20 seconds, leaving time for PDF generation/database work
// in the existing 30-second Vercel function. Never retry a messages POST.
async function metaRequest(config, stage, body, fetchImpl, timeoutMs) {
 const controller = new AbortController();
 const unknown = () => error(502, 'WhatsApp did not confirm whether the bill was accepted. Check WhatsApp before sending it again.', 'unknown');
 let timeout;
 const deadline = new Promise((_, reject) => {
  timeout = setTimeout(() => {
   controller.abort();
   reject(stage === 'messages' ? unknown() : error(504, 'The PDF upload timed out. The bill was not sent. Please try again.'));
  }, timeoutMs);
 });
 try {
  return await Promise.race([deadline, (async () => {
   let response;
   try {
    response = await fetchImpl(`https://graph.facebook.com/${config.version}/${config.phoneNumberId}/${stage}`, {
     method: 'POST', redirect: 'error', signal: controller.signal,
     headers: {Authorization: `Bearer ${config.token}`, ...(stage === 'messages' ? {'Content-Type': 'application/json'} : {})},
     body
    });
   } catch {
    throw stage === 'messages' ? unknown() : error(502, 'WhatsApp could not upload the bill PDF. The bill was not sent. Please try again.');
   }
   let data;
   try { data = await response.json(); } catch {
    throw stage === 'messages' ? unknown() : error(502, 'WhatsApp returned an invalid upload response. The bill was not sent. Please try again.');
   }
   if (!response.ok || data?.error) {
    // A server failure can occur after a message has been accepted. Preserve
    // its claim rather than risk sending a duplicate.
    if (stage === 'messages' && (response.status >= 500 || !data?.error || response.status === 408)) throw unknown();
    throw error(502, rejectedMessage(Number(data?.error?.code), stage));
   }
   return data;
  })()]);
 } finally { clearTimeout(timeout); }
}

export async function sendBillPdf({document, pdf, filename, config = whatsappConfig(), fetchImpl = globalThis.fetch, timeoutMs = 10000}) {
 if (!config.configured) throw error(503, config.message);
 if (document.type !== 'bill') throw error(400, 'Only saved bills can be sent directly through WhatsApp.');
 if (!/^\+[1-9]\d{7,14}$/.test(document.phone)) throw error(400, 'The saved bill needs a valid customer phone number including country code.');
 if (!Buffer.isBuffer(pdf) || pdf.subarray(0,5).toString() !== '%PDF-' || !pdf.subarray(-1024).toString('latin1').trimEnd().endsWith('%%EOF')) throw error(500, 'Unable to generate a complete PDF. Please retry.');
 const upload = new FormData();
 upload.set('messaging_product', 'whatsapp');
 upload.set('type', 'application/pdf');
 upload.set('file', new Blob([pdf], {type: 'application/pdf'}), filename);
 const media = await metaRequest(config, 'media', upload, fetchImpl, timeoutMs);
 if (typeof media?.id !== 'string' || !/^\d+$/.test(media.id)) throw error(502, 'WhatsApp did not return a valid PDF upload ID. The bill was not sent. Please try again.');
 const attachment = {id: media.id, filename};
 const billNumber = filename.replace(/\.pdf$/, '');
 const amount = `INR ${Number(document.total).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
 const payload = {messaging_product: 'whatsapp', recipient_type: 'individual', to: document.phone.slice(1)};
 if (config.template) {
  payload.type = 'template';
  payload.template = {name: config.template, language: {code: config.language}, components: [
   {type: 'header', parameters: [{type: 'document', document: attachment}]},
   {type: 'body', parameters: [document.customer.replace(/\s+/g, ' ').trim(), billNumber, amount].map(text => ({type: 'text', text}))}
  ]};
 } else {
  payload.type = 'document';
  payload.document = {...attachment, caption: `Your V31 Concepts bill ${billNumber}. Total: ${amount}. Thank you for choosing us.`};
 }
 const sent = await metaRequest(config, 'messages', JSON.stringify(payload), fetchImpl, timeoutMs);
 const messageId = sent?.messages?.[0]?.id;
 if (typeof messageId !== 'string' || !messageId.startsWith('wamid.') || messageId.length > 1000) throw error(502, 'WhatsApp did not confirm whether the bill was accepted. Check WhatsApp before sending it again.', 'unknown');
 return {status: 'accepted', messageId, phone: document.phone};
}
