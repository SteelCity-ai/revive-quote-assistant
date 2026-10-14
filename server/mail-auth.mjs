const hasGoogleOAuth=env=>!!(env.ESTIMATE_GOOGLE_CLIENT_ID&&env.ESTIMATE_GOOGLE_CLIENT_SECRET&&env.ESTIMATE_GOOGLE_REFRESH_TOKEN);
const hasAnyOAuth=env=>!!(env.ESTIMATE_GOOGLE_CLIENT_ID||env.ESTIMATE_GOOGLE_CLIENT_SECRET||env.ESTIMATE_GOOGLE_REFRESH_TOKEN);
export function mailConnection(env) {
  const google=env.ESTIMATE_MAIL_PROVIDER==='google-workspace';
  const host=env.ESTIMATE_IMAP_HOST||(google?'imap.gmail.com':'');
  const oauth=hasAnyOAuth(env);
  // Never send a Google bearer token to a configurable, non-Google IMAP server.
  const valid=!!(env.ESTIMATE_IMAP_USER&&host&&(oauth?(hasGoogleOAuth(env)&&host==='imap.gmail.com'):env.ESTIMATE_IMAP_PASSWORD));
  return {host,oauth,valid};
}
export function createMailAuth(env,{fetcher=fetch,now=Date.now}={}) {
  const connection=mailConnection(env);let token='',expiresAt=0;
  return async()=>{
    if(!connection.valid)throw new Error('Mailbox connection is incomplete.');
    if(!connection.oauth)return {user:env.ESTIMATE_IMAP_USER,pass:env.ESTIMATE_IMAP_PASSWORD};
    if(!token||now()>=expiresAt-60000) {
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
      try {
        const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.ESTIMATE_GOOGLE_CLIENT_ID,client_secret:env.ESTIMATE_GOOGLE_CLIENT_SECRET,refresh_token:env.ESTIMATE_GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'}),signal:controller.signal});
        if(!response.ok)throw new Error('Google mailbox authorization needs attention.');
        const data=await response.json();
        if(typeof data.access_token!=='string'||!data.access_token||data.access_token.length>10000||!Number.isFinite(data.expires_in)||data.expires_in<=60||data.expires_in>86400)throw new Error('Google mailbox authorization returned an invalid token.');
        token=data.access_token;expiresAt=now()+data.expires_in*1000;
      } finally {clearTimeout(timeout);}
    }
    return {user:env.ESTIMATE_IMAP_USER,accessToken:token};
  };
}
