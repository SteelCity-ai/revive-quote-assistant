import {isIP} from 'node:net';

const LOOPBACK=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);

export function isLoopback(address){
  if(typeof address!=='string')return false;
  const bare=address.startsWith('::ffff:')?address.slice(7):address;
  return LOOPBACK.has(address)||LOOPBACK.has(bare);
}

function normalize(value){
  if(typeof value!=='string')return '';
  let candidate=value.trim();
  if(!candidate)return '';
  if(candidate.startsWith('[')){const end=candidate.indexOf(']');if(end>0)candidate=candidate.slice(1,end);}
  else{const parts=candidate.split(':');if(parts.length===2&&isIP(parts[0])===4)candidate=parts[0];}
  return isIP(candidate)?candidate:'';
}

// The rightmost X-Forwarded-For entry is the one appended by the nearest proxy.
// Entries to its left may be client-supplied and are ignored.
export function forwardedClient(req){
  const header=req.headers?.['x-forwarded-for'];
  const raw=Array.isArray(header)?header.join(','):header;
  if(typeof raw!=='string'||!raw.trim())return '';
  const parts=raw.split(',').map(normalize).filter(Boolean);
  return parts.length?parts[parts.length-1]:'';
}

// Trust the forwarded header only when the direct peer is loopback (the local
// proxy). Otherwise the socket address is the only identity we can defend.
export function clientAddress(req,{trustProxy=true}={}){
  const peer=req.socket?.remoteAddress||'';
  if(!trustProxy||!isLoopback(peer))return peer||'unknown';
  return forwardedClient(req)||peer||'unknown';
}
