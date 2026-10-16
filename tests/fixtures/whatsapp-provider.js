// Loaded only by the integration-test subprocess. No network access is made.
let scenario = 'success';
let release;
process.on('message', message => {
 if (message.type === 'scenario') {scenario = message.value; process.send({type:'ready'});}
 if (message.type === 'release') release?.();
});
globalThis.fetch = async (url, options) => {
 if (!url.startsWith('https://graph.facebook.com/v99.0/123456789/')) throw new Error('Unexpected outbound request during test');
 const stage = url.endsWith('/media') ? 'media' : 'messages';
 const data = stage === 'media' ? {filename:options.body.get('file').name, type:options.body.get('file').type} : JSON.parse(options.body);
 process.send({type:'provider', stage, data});
 if (stage === 'media') {
  if (scenario === 'upload-failure') return Response.json({error:{code:131053,message:'SECRET PROVIDER DETAILS'}},{status:400});
  return Response.json({id:'987654321'});
 }
 if (scenario === 'slow') await new Promise(resolve => {release = resolve;});
 if (scenario === 'unknown') throw new Error('PRIVATE CONNECTION DETAILS');
 if (scenario === 'window') return Response.json({error:{code:131047,message:'PRIVATE PROVIDER DETAILS'}},{status:400});
 return Response.json({messages:[{id:'wamid.mock-bill-accepted'}]});
};
