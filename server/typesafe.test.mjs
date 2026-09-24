import {afterEach,describe,expect,it,vi} from 'vitest';
import http from 'node:http';
import {buildDecisionRequest,createTypeSafeHandler,parseDecision} from './typesafe.mjs';

const origin='http://localhost:4178';
const openServer=async(fetcher,env={NODE_ENV:'development',TYPESAFE_API_KEY:'test-only'})=>{
  const handler=createTypeSafeHandler({env,fetcher,authenticate:vi.fn(),origins:new Set([origin])});
  const server=http.createServer(async(req,res)=>{if(await handler(req,res))return;res.writeHead(404).end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(body,from=origin,contentType='application/json')=>fetch(base+'/api/voice/decision',{method:'POST',headers:{Origin:from,'Content-Type':contentType},body:typeof body==='string'?body:JSON.stringify(body)});
  return {server,post};
};

const servers=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise(resolve=>server.close(resolve))));});

describe('TypeSafe Jev voice routing',()=>{
  it('builds one pinned closed-set decision without delegating money or quote changes',()=>{
    const request=buildDecisionRequest({transcript:'keep going',currentQuestion:'What is the roof area?',paused:true});
    expect(request.model).toBe('jev-1.13.0');
    expect(request.state).toEqual({transcript:'keep going',current_question:'What is the roof area?',session_paused:true});
    expect(request.questions.intent.type).toBe('choice');
    expect(Object.keys(request.questions.intent.criteria)).toEqual(expect.arrayContaining(['answer_current','resume','review_or_approve','unrelated']));
    expect(JSON.stringify(request)).not.toMatch(/price|total|quantity|approve_quote/);
  });

  it('validates confidence before exposing a routing hint',()=>{
    const source={model:'jev-1.13.0',answers:{intent:{type:'choice',choice:'resume',confidence:0.74,probabilities:{resume:0.8,pause:0.2}}}};
    expect(parseDecision(source,0.65)).toMatchObject({intent:'resume',confidence:0.74,reliable:true,model:'jev-1.13.0'});
    expect(parseDecision(source,0.8)).toMatchObject({reliable:false});
    expect(parseDecision({answers:{intent:{type:'choice',choice:'wire_money',confidence:1}}})).toBeNull();
  });

  it('keeps the API key server-side and fails closed at the route boundary',async()=>{
    let upstream;
    const fetcher=vi.fn(async(url,init)=>{upstream={url,init};return Response.json({model:'jev-1.13.0',answers:{intent:{type:'choice',choice:'resume',confidence:0.91,probabilities:{resume:0.95,pause:0.05}}}});});
    const opened=await openServer(fetcher);servers.push(opened.server);
    expect((await opened.post({transcript:'continue'},'https://evil.example')).status).toBe(403);
    expect((await opened.post('{}')).status).toBe(400);
    const response=await opened.post({transcript:'continue',currentQuestion:'What is the schedule?'});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({intent:'resume',reliable:true});
    expect(upstream.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(upstream.init.headers.Authorization).toBe('Bearer test-only');
    expect(JSON.parse(upstream.init.body).state.transcript).toBe('continue');
  });

  it('is optional and returns a sanitized unavailable response',async()=>{
    const opened=await openServer(vi.fn(),{NODE_ENV:'development'});servers.push(opened.server);
    const response=await opened.post({transcript:'continue'});
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:'Voice decision routing is not configured.'});
  });
});
