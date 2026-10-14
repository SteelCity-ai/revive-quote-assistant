import {it,expect} from 'vitest';
import {createMailAuth,mailConnection} from './mail-auth.mjs';
import {emailIntakeConfigured} from './inbox.mjs';
const oauth={ESTIMATE_MAIL_PROVIDER:'google-workspace',ESTIMATE_IMAP_USER:'mike@example.com',ESTIMATE_GOOGLE_CLIENT_ID:'test-client',ESTIMATE_GOOGLE_CLIENT_SECRET:'test-secret',ESTIMATE_GOOGLE_REFRESH_TOKEN:'test-refresh'};
it('defaults Workspace to Gmail and supports only complete mailbox authorization',()=>{
  expect(mailConnection(oauth)).toEqual({host:'imap.gmail.com',oauth:true,valid:true});
  expect(mailConnection({...oauth,ESTIMATE_GOOGLE_REFRESH_TOKEN:''}).valid).toBe(false);
  expect(mailConnection({...oauth,ESTIMATE_IMAP_HOST:'other.example.com'}).valid).toBe(false);
  expect(emailIntakeConfigured({...oauth,ESTIMATE_INBOX_DIR:'/data',ESTIMATE_ALLOWED_SENDERS:' '})).toBe(false);
  expect(emailIntakeConfigured({...oauth,ESTIMATE_INBOX_DIR:'/data',ESTIMATE_ALLOWED_SENDERS:'sender@example.com'})).toBe(true);
});
it('keeps app-password authorization separate from OAuth',async()=>{
  const authenticate=createMailAuth({ESTIMATE_MAIL_PROVIDER:'google-workspace',ESTIMATE_IMAP_USER:'mike@example.com',ESTIMATE_IMAP_PASSWORD:'test-app-password'},{fetcher:()=>{throw new Error('Unexpected provider request');}});
  expect(await authenticate()).toEqual({user:'mike@example.com',pass:'test-app-password'});
});
it('refreshes private Google access tokens only when needed and before expiration',async()=>{
  let time=1000,calls=0;
  const authenticate=createMailAuth(oauth,{now:()=>time,fetcher:async(url,options)=>{
    expect(url).toBe('https://oauth2.googleapis.com/token');expect(options.method).toBe('POST');expect(options.body.get('grant_type')).toBe('refresh_token');expect(options.body.get('refresh_token')).toBe('test-refresh');calls++;return Response.json({access_token:'private-test-token-'+calls,expires_in:3600});
  }});
  expect(await authenticate()).toEqual({user:'mike@example.com',accessToken:'private-test-token-1'});
  await authenticate();expect(calls).toBe(1);time+=3541000;
  expect((await authenticate()).accessToken).toBe('private-test-token-2');expect(calls).toBe(2);
});
it('fails without returning provider errors or caching rejected tokens',async()=>{
  let calls=0;const authenticate=createMailAuth(oauth,{fetcher:async()=>{calls++;return new Response('private-provider-detail',{status:400});}});
  await expect(authenticate()).rejects.toThrow('Google mailbox authorization needs attention.');await expect(authenticate()).rejects.toThrow('Google mailbox authorization needs attention.');expect(calls).toBe(2);
  await expect(createMailAuth(oauth,{fetcher:async()=>Response.json({access_token:'test',expires_in:1})})()).rejects.toThrow('invalid token');
});
