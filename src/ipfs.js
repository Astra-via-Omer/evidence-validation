const endpoint = process.env.IPFS_BRIDGE_URL;
export const ipfsConfigured = !!endpoint && !!process.env.IPFS_BRIDGE_TOKEN;
export async function ipfsRequest(path, body) {
 if (!ipfsConfigured) throw Object.assign(new Error('Hosted IPFS is not configured'), {status:503});
 try {
  const r=await fetch(endpoint+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+process.env.IPFS_BRIDGE_TOKEN,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Node request failed');
  return path.startsWith('/content/')?Buffer.from(await r.arrayBuffer()):await r.json();
 } catch {throw Object.assign(new Error('Hosted IPFS is temporarily unavailable'),{status:503});}
}
export function publicSnapshot(payload) {
 const {owner,...job}=payload.job;
 return {schema:'evidence-validation/public-bundle/v1',job,reviews:payload.reviews.map(({reviewer,...review})=>review),notice:'Published evidence and reviews; this record does not prove the claim is true.'};
}
