import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInboxStore,acceptedEmail,emailIntakeConfigured,startEmailIntake} from './inbox.mjs';
it('requires private mailbox credentials and sender allowlist before activation',()=>{
  expect(emailIntakeConfigured({ESTIMATE_IMAP_USER:'mike@example.com'})).toBe(false);
  expect(emailIntakeConfigured({ESTIMATE_INBOX_DIR:'/data',ESTIMATE_IMAP_HOST:'mail.example.com',ESTIMATE_IMAP_USER:'mike@example.com',ESTIMATE_IMAP_PASSWORD:'test-only',ESTIMATE_ALLOWED_SENDERS:'estimates@example.com'})).toBe(true);
  const parsed={from:{value:[{address:'estimates@example.com'}]},to:{value:[{address:'mike@example.com'}]}};const config={mailbox:'mike@example.com',senders:['estimates@example.com']};expect(acceptedEmail(parsed,config)).toBe(true);expect(acceptedEmail(parsed,{...config,mailbox:'wrong@example.com'})).toBe(false);expect(acceptedEmail(parsed,{...config,senders:[]})).toBe(false);
});
it('creates and prices new email drafts, retries failure and deduplicates repeated attachments',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'quote-mail-test-'));let stop;
  try {
    const store=createInboxStore(dir);let next=2,prices=0,prepared=0;
    const email=Buffer.from('From: estimates@example.com\r\nTo: mike@example.com\r\nMessage-ID: <test@example.com>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=test\r\n\r\n--test\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="estimate.pdf"\r\n\r\n%PDF-test\r\n--test--');
    const env={ESTIMATE_INBOX_DIR:dir,ESTIMATE_IMAP_HOST:'mail.example.com',ESTIMATE_IMAP_USER:'mike@example.com',ESTIMATE_IMAP_PASSWORD:'test-only',ESTIMATE_ALLOWED_SENDERS:'estimates@example.com'};
    stop=startEmailIntake({env,store,startImmediately:false,clientFactory:()=>({mailbox:{uidValidity:100,uidNext:next},on(){},async connect(){},async getMailboxLock(){return {release(){}};},async *fetch(){yield {uid:next-1,size:email.length,envelope:{from:[{address:'estimates@example.com'}]}};},async fetchOne(){return {source:email};},async logout(){},close(){}}),prepare:async()=>{prepared++;return {id:'b'.repeat(64),type:'roofing',roofMeasurement:{available:true,roofAreaSqFt:8000},importedAt:'2026-10-13T00:00:00Z'};},price:async()=>{prices++;if(prices===1)throw new Error('Temporary provider failure');return {items:[],questions:[]};}});
    await stop.poll();expect(await store.cursor()).toEqual({validity:'100',uid:1});expect(prices).toBe(0); // start with new mail only
    next=3;await stop.poll();expect((await store.list())[0].status).toBe('failed');expect((await store.cursor()).uid).toBe(1);
    await stop.poll();expect((await store.list())[0].status).toBe('ready');expect((await store.cursor()).uid).toBe(2);expect(prices).toBe(2);
    next=4;await stop.poll();expect(await store.list()).toHaveLength(1);expect(prices).toBe(2);expect(prepared).toBe(3);
  }finally{stop?.();await rm(dir,{recursive:true,force:true});}
});
it('persists idempotent drafts and cursor across process restarts and rejects path traversal',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'quote-inbox-'));try{const store=createInboxStore(dir);const draft={id:'a'.repeat(64),status:'ready',importedAt:'2026-10-13T00:00:00Z'};await store.put(draft);await store.put(draft);await store.saveCursor({validity:'123',uid:22});const reopened=createInboxStore(dir);expect(await reopened.list()).toHaveLength(1);expect(await reopened.get(draft.id)).toEqual(draft);expect(await reopened.cursor()).toEqual({validity:'123',uid:22});expect(await reopened.get('../private')).toBeNull();await expect(reopened.put({...draft,id:'../private'})).rejects.toThrow();}finally{await rm(dir,{recursive:true,force:true});}
});
