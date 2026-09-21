import {it,expect} from 'vitest';
import {createApp} from './app.mjs';
import {createRoofMeasurer} from './roof.mjs';
const origin='https://quote.example.com';
const geocodeOk=()=>new Response(JSON.stringify({status:'OK',results:[{formatted_address:'1 Test St',geometry:{location:{lat:40.1,lng:-79.9}}}]}));
// Mirrors the real buildingInsights:findClosest response structure (verified live 2026-09-21).
const solar=({roofArea=900,roofGround=450,footprintGround=500,withImagery=true}={})=>new Response(JSON.stringify({
  name:'buildings/x',
  ...(withImagery?{imageryDate:{year:2025,month:7,day:23},imageryQuality:'HIGH'}:{imageryQuality:'HIGH'}),
  solarPotential:{
    wholeRoofStats:{areaMeters2:roofArea,groundAreaMeters2:roofGround},
    buildingStats:{areaMeters2:footprintGround,groundAreaMeters2:footprintGround},
  },
}));

it('uses the documented buildingInsights:findClosest endpoint and converts square meters to square feet',async()=>{
  const urls=[];const fetcher=async url=>{url=String(url);urls.push(url);return url.includes('geocode')?geocodeOk():solar();};
  const measure=createRoofMeasurer({fetcher,apiKey:'test-key'});
  const result=await measure('1 Test St');
  expect(urls[1]).toContain('solar.googleapis.com/v1/buildingInsights:findClosest?');
  expect(urls[1]).not.toContain('findClosestBuilding');
  expect(urls[0]).toContain('maps.googleapis.com');expect(urls[0]).toContain('test-key');
  expect(urls[1]).toContain('location.latitude=40.1');
  expect(result.available).toBe(true);
  expect(result.roofAreaSqFt).toBe(9688); // 900 m2 * 10.7639104167
});

it('parses footprint and coverage fields and reports partial coverage with a warning',async()=>{
  const measure=createRoofMeasurer({fetcher:async url=>String(url).includes('geocode')?geocodeOk():solar(),apiKey:'k'});
  const result=await measure('1 Test St');
  expect(result.footprintSqFt).toBe(5382);   // 500 m2
  expect(result.coveredSqFt).toBe(4844);     // 450 m2
  expect(result.coveragePercent).toBe(90);
  expect(result.partial).toBe(true);         // <95%
  expect(result.note).toContain('only part of the building');
  expect(result.imageryDate).toBe('2025-07-23');
  const full=createRoofMeasurer({fetcher:async url=>String(url).includes('geocode')?geocodeOk():solar({roofGround:500}),apiKey:'k'});
  const ok=await full('1 Test St');
  expect(ok.coveragePercent).toBe(100);expect(ok.partial).toBe(false);
  expect(ok.note).toContain('Confirm the matched address');
});

it('handles partial coverage and missing coverage fields without manufacturing a complete area',async()=>{
  const partial=createRoofMeasurer({fetcher:async url=>String(url).includes('geocode')?geocodeOk():solar({roofGround:250,footprintGround:500}),apiKey:'k'});
  const p=await partial('1 Test St');
  expect(p.coveragePercent).toBe(50);expect(p.partial).toBe(true);
  expect(p.roofAreaSqFt).toBe(9688); // reported as measured, never inflated
  const noCoverage=createRoofMeasurer({fetcher:async url=>String(url).includes('geocode')?geocodeOk():solar({roofGround:0}),apiKey:'k'});
  const n=await noCoverage('1 Test St');
  expect(n.coveredSqFt).toBe(null);expect(n.coveragePercent).toBe(null);expect(n.partial).toBe(false);
  expect(n.note).toContain('Confirm the matched address');
});

it('returns an unavailable reason instead of throwing when coverage or upstream fails',async()=>{
  const notFound=createRoofMeasurer({fetcher:async url=>new Response('{}',{status:String(url).includes('solar')?404:500}),apiKey:'k'});
  expect((await notFound('x')).available).toBe(false);
  const geoFail=createRoofMeasurer({fetcher:async()=>new Response(JSON.stringify({status:'ZERO_RESULTS'})),apiKey:'k'});
  expect((await geoFail('nowhere')).reason).toContain('could not be located');
  const noBuilding=createRoofMeasurer({fetcher:async url=>String(url).includes('geocode')?geocodeOk():solar({roofArea:0}),apiKey:'k'});
  expect((await noBuilding('x')).available).toBe(false);
  const upstream500=createRoofMeasurer({fetcher:async url=>String(url).includes('geocode')?geocodeOk():new Response('{}',{status:500}),apiKey:'k'});
  expect((await upstream500('x')).available).toBe(false);
  expect((await createRoofMeasurer({fetcher:async()=>{throw new Error('down');},apiKey:'k'})('x')).available).toBe(false);
  expect(createRoofMeasurer({fetcher:async()=>geocodeOk(),apiKey:''})).toBe(null);
});

it('requires production portal authentication, exact origin and a configured key for measurement requests',async()=>{
  let upstreamCalls=0;const fetcher=async url=>{upstreamCalls++;url=String(url);if(url.includes('auth/login'))return new Response(JSON.stringify({role:'ADMIN',userId:'qa-admin'}),{headers:{'set-cookie':'revive_session=upstream-private; Secure; HttpOnly'}});if(url.includes('geocode'))return geocodeOk();if(url.includes('solar.googleapis.com'))return solar();return Response.json({role:'ADMIN',userId:'qa-admin'});};
  const server=createApp({env:{NODE_ENV:'production',APP_ORIGIN:origin,GOOGLE_SOLAR_API_KEY:'test-key'},fetcher});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,cookie='',from=origin)=>fetch(base+path,{method:'POST',headers:{Origin:from,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  try{
    expect((await post('/api/roof/measure',{address:'1 Test St'})).status).toBe(401);
    expect((await post('/api/roof/measure',{address:'1 Test St'},'','https://evil.example')).status).toBe(403);
    expect((await post('/api/roof/measure',{address:'1 Test St'},'wrong=1')).status).toBe(401);
    const login=await post('/api/portal/login',{email:'qa@example.com',password:'test-only'});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    expect((await post('/api/roof/measure',{},cookie)).status).toBe(400);
    const ok=await post('/api/roof/measure',{address:'1 Test St'},cookie);
    expect(ok.status).toBe(200);expect((await ok.json()).roofAreaSqFt).toBe(9688);
  }finally{await new Promise(r=>server.close(r));}
  expect(upstreamCalls).toBeGreaterThan(0);
});

it('denies measurement requests when the Solar key is not configured',async()=>{
  const server=createApp({env:{},fetcher:async()=>{throw new Error('must not be called');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const config=await (await fetch(base+'/api/app/config')).json();expect(config.roofMeasurementAvailable).toBe(false);
    const post=await fetch(base+'/api/roof/measure',{method:'POST',headers:{Origin:'http://localhost:4178','Content-Type':'application/json'},body:'{"address":"x"}'});
    expect(post.status).toBe(503);
  }finally{await new Promise(r=>server.close(r));}
});
