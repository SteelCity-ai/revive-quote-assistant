import {it,expect,describe} from 'vitest';
import {createApp} from './app.mjs';
import {buildSessionConfig,voiceTools} from './voice.mjs';
const origin='https://quote.example.com';

describe('realtime session config',()=>{
  it('pins the GA session shape, semantic turn detection and strict client tools',()=>{
    const config=buildSessionConfig({model:'gpt-realtime-test',voice:'marin',context:'Signed-in user: QA.'});
    expect(config.session.type).toBe('realtime');
    expect(config.session.model).toBe('gpt-realtime-test');
    expect(config.session.audio.input.turn_detection).toMatchObject({type:'semantic_vad',interrupt_response:true,create_response:true});
    expect(config.session.audio.output.voice).toBe('marin');
    expect(config.session.instructions).toContain('APP CONTEXT:');
    expect(config.session.instructions).toContain('never invent prices');
    const names=new Set(voiceTools.map(t=>t.name));
    expect([...names].sort()).toEqual(['confirm_approval','end_session','go_back','mark_unknown','pause_session','prepare_approval','resume_session','set_answer','set_answer_options','start_estimate','start_quote']);
    for(const tool of voiceTools){
      expect(tool.type).toBe('function');
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.additionalProperties).toBe(false);
      for(const key of tool.parameters.required)expect(tool.parameters.properties[key]).toBeDefined();
    }
    expect(voiceTools.find(t=>t.name==='confirm_approval').parameters.required).toEqual(['fingerprint']);
  });
});

const loginFetcher=mint=>{
  return async(url,init)=>{
    if(String(url).endsWith('/auth/login'))return new Response(JSON.stringify({role:'ADMIN',userId:'qa-admin',displayName:'QA'}),{headers:{'set-cookie':'revive_session=upstream-private; Secure; HttpOnly'}});
    if(String(url).endsWith('/me'))return Response.json({role:'ADMIN',userId:'qa-admin'});
    if(String(url).includes('/realtime/client_secrets'))return mint(url,init);
    return Response.json({});
  };
};
const loginCookie=async post=>{const setCookie=(await post('/api/portal/login',{email:'qa@example.com',password:'test-only'})).headers.get('set-cookie');return setCookie.split(';')[0];};
const openServer=async(env,fetcher)=>{const server=createApp({env,fetcher});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;const post=(path,body,cookie='',from=origin)=>fetch(base+path,{method:'POST',headers:{Origin:from,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});return {server,base,post};};

describe('voice session route',()=>{
  it('denies anonymous, cross-origin and non-JSON requests, and fails closed without a key',async()=>{
    const guarded=await openServer({NODE_ENV:'production',APP_ORIGIN:origin,OPENAI_API_KEY:'test-only'},loginFetcher(()=>Response.json({value:'ek_x'})));
    try{
      expect((await guarded.post('/api/voice/session',{})).status).toBe(401);
      expect((await guarded.post('/api/voice/session',{},'','https://evil.example')).status).toBe(403);
    }finally{await new Promise(r=>guarded.server.close(r));}
    const open=await openServer({NODE_ENV:'development'},null);
    try{
      const config=await (await fetch(open.base+'/api/app/config')).json();
      expect(config.voiceAvailable).toBe(false);
      const devOrigin={'Origin':'http://localhost:4178'};
      expect((await fetch(open.base+'/api/voice/session',{method:'POST',headers:{...devOrigin,'Content-Type':'text/plain'},body:'x'})).status).toBe(415);
      expect((await fetch(open.base+'/api/voice/session',{method:'POST',headers:{...devOrigin,'Content-Type':'application/json'},body:'{}'})).status).toBe(503);
      const keyed=await openServer({NODE_ENV:'development',OPENAI_API_KEY:'test-only'},null);
      try{
        expect((await fetch(keyed.base+'/api/voice/session',{method:'POST',headers:{...devOrigin,'Content-Type':'application/json'},body:'not-json'})).status).toBe(400);
        expect((await fetch(keyed.base+'/api/voice/session',{method:'GET',headers:devOrigin})).status).toBe(404);
      }finally{await new Promise(r=>keyed.server.close(r));}
    }finally{await new Promise(r=>open.server.close(r));}
  });

  it('mints an ephemeral client secret with the pinned realtime endpoint and safety identifier',async()=>{
    let minted;
    const fetcher=loginFetcher((url,init)=>{minted={url:String(url),init};return Response.json({value:'ek_test_secret',session:{}});});
    const {server,base,post}=await openServer({NODE_ENV:'production',APP_ORIGIN:origin,OPENAI_API_KEY:'test-only',OPENAI_REALTIME_MODEL:'gpt-realtime-test'},fetcher);
    try{
      const cookie=await loginCookie(post);
      const response=await post('/api/voice/session',{context:'Signed-in user: QA.'},cookie);
      expect(response.status).toBe(200);
      const data=await response.json();
      expect(data.clientSecret).toBe('ek_test_secret');
      expect(data.model).toBe('gpt-realtime-test');
      expect(data.webRtcUrl).toBe('https://api.openai.com/v1/realtime/calls');
      expect(minted.url).toBe('https://api.openai.com/v1/realtime/client_secrets');
      expect(minted.init.headers.Authorization).toBe('Bearer test-only');
      expect(minted.init.headers['OpenAI-Safety-Identifier']).toMatch(/^revive-quote-assistant-[0-9a-f]{32}$/);
      const body=JSON.parse(minted.init.body);
      expect(body.session.model).toBe('gpt-realtime-test');
      expect(body.session.audio.input.turn_detection.type).toBe('semantic_vad');
      expect(JSON.stringify(body.session.tools)).toContain('confirm_approval');
      expect(body.session.instructions).toContain('Signed-in user: QA.');
    }finally{await new Promise(r=>server.close(r));}
  });

  it('bounds voice sessions per identity and sanitizes upstream failures',async()=>{
    let mints=0;
    const fetcher=loginFetcher(()=>{mints++;return Response.json({value:'ek_test_secret'});});
    const {server,post}=await openServer({NODE_ENV:'production',APP_ORIGIN:origin,OPENAI_API_KEY:'test-only'},fetcher);
    try{
      const cookie=await loginCookie(post);
      for(let i=0;i<12;i++)expect((await post('/api/voice/session',{},cookie)).status).toBe(200);
      expect((await post('/api/voice/session',{},cookie)).status).toBe(429);
      expect(mints).toBe(12);
    }finally{await new Promise(r=>server.close(r));}
    const rejected=async(url)=>{if(String(url).endsWith('/auth/login'))return new Response(JSON.stringify({role:'ADMIN',userId:'qa-admin'}),{headers:{'set-cookie':'revive_session=u; HttpOnly'}});if(String(url).endsWith('/me'))return Response.json({role:'ADMIN',userId:'qa-admin'});if(String(url).includes('/realtime/client_secrets'))return new Response(JSON.stringify({error:{message:'bad key detail'}}),{status:401});return Response.json({});};
    const failing=await openServer({NODE_ENV:'production',APP_ORIGIN:origin,OPENAI_API_KEY:'test-only'},rejected);
    try{
      const cookie=await loginCookie(failing.post);
      const response=await failing.post('/api/voice/session',{},cookie);
      expect(response.status).toBe(401);
      const data=await response.json();
      expect(data.error).toBe('The server API key was rejected for voice sessions.');
      expect(data.error).not.toContain('bad key detail');
      const missing=async(url)=>{if(String(url).endsWith('/auth/login'))return new Response(JSON.stringify({role:'ADMIN',userId:'qa-admin'}),{headers:{'set-cookie':'revive_session=u2; HttpOnly'}});if(String(url).endsWith('/me'))return Response.json({role:'ADMIN',userId:'qa-admin'});if(String(url).includes('/realtime/client_secrets'))return Response.json({});return Response.json({});};
      const incomplete=await openServer({NODE_ENV:'production',APP_ORIGIN:origin,OPENAI_API_KEY:'test-only'},missing);
      try{
        const cookie2=await loginCookie(incomplete.post);
        const r2=await incomplete.post('/api/voice/session',{},cookie2);
        expect(r2.status).toBe(502);
      }finally{await new Promise(r=>incomplete.server.close(r));}
    }finally{await new Promise(r=>failing.server.close(r));}
  });
});
