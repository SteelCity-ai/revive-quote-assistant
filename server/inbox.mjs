import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ImapFlow} from 'imapflow';
import {simpleParser} from 'mailparser';
import {MAX_PDF_BYTES} from './import.mjs';
const safeId=id=>/^[a-f0-9]{64}$/.test(id);
export function createInboxStore(dir) {
  if(!dir)return null;
  const write=async(name,value)=>{await mkdir(dir,{recursive:true,mode:0o700});const temp=join(dir,`${name}.${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,join(dir,name));};
  return {
    async get(id){if(!safeId(id))return null;try{return JSON.parse(await readFile(join(dir,id+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}},
    async put(draft){if(!safeId(draft.id))throw new Error('Invalid import ID.');await write(draft.id+'.json',draft);},
    async list(){let files;try{files=await readdir(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}const drafts=[];for(const file of files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f))){drafts.push(JSON.parse(await readFile(join(dir,file),'utf8')));}return drafts.sort((a,b)=>b.importedAt.localeCompare(a.importedAt)).slice(0,100);},
    async cursor(){try{return JSON.parse(await readFile(join(dir,'cursor.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}},
    async saveCursor(cursor){await write('cursor.json',cursor);},
  };
}
export function emailIntakeConfigured(env) {
  return !!(env.ESTIMATE_INBOX_DIR&&env.ESTIMATE_IMAP_HOST&&env.ESTIMATE_IMAP_USER&&env.ESTIMATE_IMAP_PASSWORD&&env.ESTIMATE_ALLOWED_SENDERS);
}
export function acceptedEmail(parsed,{mailbox,senders}) {
  const recipients=[parsed.to,parsed.cc].flatMap(a=>a?.value||[]).map(v=>v.address?.toLowerCase());
  const from=parsed.from?.value||[];
  return recipients.includes(mailbox.toLowerCase())&&from.length===1&&senders.includes(from[0].address?.toLowerCase());
}
// Dedicated incoming-mail credentials only. This worker never sends mail or approves quotes.
export function startEmailIntake({env,store,prepare,price,onError=()=>{},clientFactory=options=>new ImapFlow(options),startImmediately=true}) {
  if(!emailIntakeConfigured(env)||!store)return ()=>{};
  const senders=env.ESTIMATE_ALLOWED_SENDERS.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  let active=false,stopped=false,client;
  const poll=async()=>{
    if(active||stopped)return;active=true;
    client=clientFactory({host:env.ESTIMATE_IMAP_HOST,port:993,secure:true,auth:{user:env.ESTIMATE_IMAP_USER,pass:env.ESTIMATE_IMAP_PASSWORD},logger:false,socketTimeout:30000,connectionTimeout:20000});
    client.on('error',()=>onError());
    try {
      await client.connect();const lock=await client.getMailboxLock(env.ESTIMATE_IMAP_FOLDER||'INBOX');
      try {
        const validity=String(client.mailbox.uidValidity);let cursor=await store.cursor();
        if(!cursor||cursor.validity!==validity){await store.saveCursor({validity,uid:client.mailbox.uidNext-1});return;}
        const last=client.mailbox.uidNext-1;if(last<=cursor.uid)return;
        const messages=[];
        for await(const message of client.fetch(`${cursor.uid+1}:${last}`,{uid:true,size:true,envelope:true},{uid:true})) { messages.push(message);if(messages.length>=20)break; }
        for(const message of messages) {
          if(stopped)break;
          if(message.size<=14*1024*1024&&senders.includes(message.envelope?.from?.[0]?.address?.toLowerCase())) {
            const full=await client.fetchOne(message.uid,{source:true},{uid:true});
            const parsed=await simpleParser(full.source,{skipHtmlToText:true,skipTextToHtml:true});
            if(acceptedEmail(parsed,{mailbox:env.ESTIMATE_IMAP_USER,senders})) {
              for(const attachment of parsed.attachments.filter(a=>a.contentType==='application/pdf'||/\.pdf$/i.test(a.filename||'')).slice(0,5)) {
                if(attachment.content.length>MAX_PDF_BYTES)continue;
                let imported;
                try {imported=await prepare(attachment.content,{filename:attachment.filename});}catch{onError();continue;}
                const prior=await store.get(imported.id);
                if(prior?.status==='ready'||prior?.attempts>=3)continue;
                const draft={...imported,email:{messageId:parsed.messageId||`${validity}:${message.uid}`,receivedAt:new Date().toISOString()},status:'pricing',attempts:(prior?.attempts||0)+1};
                await store.put(draft);
                try {
                  if(imported.type==='roofing'&&!imported.roofMeasurement?.available){draft.status='needs-review';draft.error=imported.roofMeasurement?.reason||'Confirm a manual roof measurement before pricing.';}
                  else {draft.report=await price(imported);draft.reportPricing={laborRate:0,markup:15,contingency:0,tax:0};draft.status='ready';}
                }catch {draft.status='failed';draft.error='Independent pricing did not finish. Retry from the imported draft.';}
                await store.put(draft);
                if(draft.status==='failed'&&draft.attempts<3)throw new Error('Retry this message next poll.');
              }
            }
          }
          cursor={validity,uid:message.uid};await store.saveCursor(cursor);
        }
      } finally {lock.release();}
    } catch {onError();} finally {await client.logout().catch(()=>{});client=null;active=false;}
  };
  const timer=setInterval(()=>void poll(),60000);timer.unref();if(startImmediately)void poll();
  return Object.assign(()=>{stopped=true;clearInterval(timer);client?.close();},{poll});
}
