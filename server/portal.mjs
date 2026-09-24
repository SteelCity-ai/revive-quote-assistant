import {randomBytes} from 'node:crypto';

const cookieName='revive_quote_portal';
const reply=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
export function portalUrl(value){const url=new URL(value);if(url.username||url.password||url.search||url.hash||(!['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol!=='https:')||!['https:','http:'].includes(url.protocol))throw new Error('Portal URL must use HTTPS, or local HTTP for development.');return url;}
async function body(req){let bytes=0;const chunks=[];for await(const c of req){bytes+=c.length;if(bytes>1000000)throw Object.assign(new Error('Quote is too large to send.'),{status:413});chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw Object.assign(new Error('Use a valid JSON request.'),{status:400});}}
export function createPortalHandler({baseUrl,origins,fetcher=fetch,secureCookies=false}){
  const base=baseUrl?portalUrl(baseUrl):null,sessions=new Map(),attempts=new Map();
  const api=async(path,session,method='GET',payload)=>{
    const response=await fetcher(`${base.href.replace(/\/$/,'')}${path}`,{method,headers:{'Content-Type':'application/json',Origin:base.origin,...(session?{Cookie:session.cookie}:{})},body:payload===undefined?undefined:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(30000)});
    const setCookie=response.headers.getSetCookie?.()??[response.headers.get('set-cookie')??''];
    const token=setCookie.map(s=>s.match(/(?:^|,\s*)revive_session=([^;]+)/)?.[1]).find(Boolean);
    if(session&&token)session.cookie=`revive_session=${token}`;
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const message=response.status===401?'Your portal session expired. Sign in again.':response.status===404&&path.startsWith('/quotes')?'The portal quote service is not deployed yet. This quote has not been saved to the portal.':typeof data.error==='string'?data.error:'The portal could not complete the request.';throw Object.assign(new Error(message),{status:response.status});}
    return {data,token};
  };
  const authenticate=async req=>{
    const sid=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    const session=sessions.get(sid);
    if(!session||session.expires<Date.now())throw Object.assign(new Error('Sign in to Revive Portal to use AI estimating.'),{status:401});
    const {data:user}=await api('/me',session);
    if(user.role!=='ADMIN')throw Object.assign(new Error('Only portal administrators can use AI estimating.'),{status:403});
    return user;
  };
  const handler=async(req,res)=>{
    const path=req.url?.split('?')[0];if(!path?.startsWith('/api/portal/'))return false;
    const now=Date.now();for(const [id,s] of sessions)if(s.expires<now)sessions.delete(id);for(const [id,t] of attempts)if(t.every(n=>now-n>600000))attempts.delete(id);
    const sid=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    const session=sessions.get(sid);
    try{
      if(req.method!=='GET'&&!origins.has(req.headers.origin)){reply(res,403,{error:'Request origin not allowed.'});return true;}
      if(req.method!=='GET'&&!req.headers['content-type']?.startsWith('application/json')){reply(res,415,{error:'Use application/json.'});return true;}
      if(path==='/api/portal/status'&&req.method==='GET'){
        if(!base||!session){reply(res,200,{configured:!!base,user:null,ready:false});return true;}
        const {data:user}=await api('/me',session);let ready=false,error='';
        if(user.role==='ADMIN'){try{ready=(await api('/quotes/capabilities',session)).data.version===1;}catch(e){error=e.message;}}
        else error='Only portal administrators can approve and save quotes.';
        reply(res,200,{configured:true,user,ready,error,portalUrl:base.origin});return true;
      }
      if(!base){reply(res,503,{error:'Portal connection is not configured.'});return true;}
      if(path==='/api/portal/login'&&req.method==='POST'){
        const loginOrigin=new URL(req.headers.origin);
        if(loginOrigin.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(loginOrigin.hostname)){reply(res,400,{error:'Use an HTTPS app address for portal sign-in on a phone, or localhost on this computer.'});return true;}
        const identity=req.socket.remoteAddress, recent=(attempts.get(identity)||[]).filter(t=>now-t<600000);if(recent.length>=10){reply(res,429,{error:'Too many sign-in attempts. Try again in ten minutes.'});return true;}attempts.set(identity,[...recent,now]);
        const input=await body(req);if(typeof input.email!=='string'||input.email.length>255||typeof input.password!=='string'||!input.password||input.password.length>1000){reply(res,400,{error:'Enter your portal email and password.'});return true;}
        const {data:user,token}=await api('/auth/login',null,'POST',{email:input.email,password:input.password});
        if(!token)throw new Error('Portal login returned no session.');
        if(user.role!=='ADMIN'){reply(res,403,{error:'Use a portal administrator account to manage quotes.'});return true;}
        if(sessions.size>=100)throw Object.assign(new Error('Too many local sessions. Try again later.'),{status:429});
        const id=randomBytes(32).toString('hex');if(sid)sessions.delete(sid);sessions.set(id,{cookie:`revive_session=${token}`,expires:now+28800000});
        res.setHeader('Set-Cookie',`${cookieName}=${id}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=28800${secureCookies?'; Secure':''}`);
        reply(res,200,{user});return true;
      }
      if(path==='/api/portal/logout'&&req.method==='POST'){if(sid)sessions.delete(sid);res.setHeader('Set-Cookie',`${cookieName}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies?'; Secure':''}`);reply(res,200,{ok:true});return true;}
      if(!session){reply(res,401,{error:'Sign in to the portal before saving this quote.'});return true;}
      const {data:user}=await api('/me',session);if(user.role!=='ADMIN'){reply(res,403,{error:'Only portal administrators can manage quotes.'});return true;}
      let target;
      if(path==='/api/portal/clients'&&req.method==='GET')target='/clients';
      if(path==='/api/portal/clients'&&req.method==='POST')target='/clients';
      if(path==='/api/portal/quotes'&&req.method==='POST')target='/quotes';
      if(/^\/api\/portal\/quotes\/[a-f0-9-]{36}$/.test(path)&&req.method==='GET')target=path.replace('/api/portal','');
      if(!target){reply(res,404,{error:'Not found'});return true;}
      const payload=req.method==='POST'?await body(req):undefined;
      const {data}=await api(target,session,req.method,payload);reply(res,200,data);return true;
    }catch(e){if(e.status===401&&sid)sessions.delete(sid);reply(res,Number.isInteger(e.status)?e.status:502,{error:e.status?e.message:'The portal connection failed. Your local draft is unchanged; retry after checking the connection.'});return true;}
  };
  handler.authenticate=authenticate;
  return handler;
}
