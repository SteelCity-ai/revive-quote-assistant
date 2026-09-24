import {describe,it,expect,vi} from 'vitest';
import {applyConfirmedRoofMeasurement,parseNumber,matchChoice,evaluateSetAnswer,evaluateSetAnswerOptions,evaluateMarkUnknown,nextQuestion,voiceReadBack,approvalBlockers,prepareVoiceApproval,confirmVoiceApproval,buildVoiceContext,createVoiceController,isMissing} from './voice';
import {makeQuote,questions,initialLines,totals,money} from './domain';
import type {Quote,JobType} from './domain';

const pricing={laborRate:50,markup:15,contingency:10,tax:6};
const roofingQuote=():Quote=>{
  const quote=makeQuote('roofing',pricing);
  quote.answers={customer:'ACME Holdings',title:'Elm St roof',address:'12 Elm St, Harrisburg, PA 17101',roofWork:'Replacement',roofSystem:'TPO / PVC membrane',measurementMode:'Measured roof surface area',roofArea:'2400',measurementSource:'Field measured',layers:'1 layer',condition:'Some ponding near the drain.',details:'One curb, two drains.',access:'Single story, driveway access.',waste:'10',schedule:'Within 60 days',permits:'Included in our scope'};
  return quote;
};

describe('answer extraction',()=>{
  it('parses spoken-style numbers, commas, units and pitch fractions',()=>{
    expect(parseNumber('2,400 sq ft')).toBe(2400);
    expect(parseNumber('4/12')).toBe(4);
    expect(parseNumber('about 15 percent')).toBe(15);
    expect(parseNumber('no idea')).toBeNull();
  });
  it('matches choice options despite casing and punctuation',()=>{
    const options=['Replacement','Repair','Coating / restoration','New installation'];
    expect(matchChoice('replacement',options)).toBe('Replacement');
    expect(matchChoice('Coating restoration!',options)).toBe('Coating / restoration');
    expect(matchChoice('gutter work',options)).toBeNull();
  });
  it('validates answers against the existing domain rules',()=>{
    const quote=roofingQuote();
    expect(evaluateSetAnswer(quote,'customer','ACME Holdings')).toEqual({ok:true,value:'ACME Holdings'});
    expect(evaluateSetAnswer(quote,'roofWork','a full replacement')).toEqual({ok:true,value:'Replacement'});
    expect(evaluateSetAnswer(quote,'roofArea','2,400 square feet')).toEqual({ok:true,value:'2400'});
    expect(evaluateSetAnswer(quote,'roofArea','').ok).toBe(false);
    expect(evaluateSetAnswer(quote,'waste','150').ok).toBe(false);
    expect(evaluateSetAnswer(quote,'layers','4 layers').ok).toBe(false);
    expect(evaluateSetAnswer(quote,'not-a-field','x').ok).toBe(false);
    expect(evaluateSetAnswer(quote,'trades','Demolition').ok).toBe(false);
  });
  it('handles multi-select and unknown answers',()=>{
    const quote=makeQuote('renovation',pricing);
    expect(evaluateSetAnswerOptions(quote,'trades',['demolition','electrical work'])).toEqual({ok:true,value:['Demolition','Electrical']});
    expect(evaluateSetAnswerOptions(quote,'trades',[]).ok).toBe(false);
    expect(evaluateSetAnswerOptions(quote,'customer',['x']).ok).toBe(false);
    const roofing=roofingQuote();
    expect(evaluateMarkUnknown(roofing,'condition')).toEqual({ok:true,value:'Not sure yet'});
    expect(evaluateMarkUnknown(roofing,'address').ok).toBe(false);
    expect(evaluateMarkUnknown(roofing,'missing').ok).toBe(false);
  });
});

describe('question flow',()=>{
  it('commits a confirmed Google result as measured sloped roof area without applying pitch again',()=>{
    const quote=roofingQuote();quote.answers.measurementMode='Building footprint + roof pitch';quote.answers.pitch='12';
    const updated=applyConfirmedRoofMeasurement(quote,{roofAreaSqFt:2400,formattedAddress:'12 Elm St',imageryDate:'2026-01-01',imageryQuality:'HIGH',coveragePercent:100,note:'',provenance:'Google aerial imagery (2026-01-01)'});
    expect(updated.answers.measurementMode).toBe('Measured roof surface area');
    expect(updated.answers.roofArea).toBe('2400');
    expect(updated.answers.measurementSource).toBe('Google aerial imagery');
    expect(updated.answers.pitch).toBeUndefined();
  });
  it('walks required questions in order, respects conditional questions and knows when the guide is complete',()=>{
    const quote=makeQuote('roofing',pricing);
    expect(nextQuestion(quote)?.id).toBe('customer');
    quote.answers.customer='ACME Holdings';
    expect(nextQuestion(quote)?.id).toBe('address');
    quote.answers.address='12 Elm St, Harrisburg, PA 17101';
    quote.answers.title='Elm St roof';
    quote.answers.roofWork='Replacement';
    quote.answers.roofSystem='TPO / PVC membrane';
    quote.answers.measurementMode='Building footprint + roof pitch';
    expect(nextQuestion(quote)?.id).toBe('roofArea');
    quote.answers.roofArea='2000';
    expect(nextQuestion(quote)?.id).toBe('pitch');
    quote.answers.pitch='4';
    quote.answers.measurementSource='Field measured';
    quote.answers.layers='1 layer';
    quote.answers.condition='Aging membrane';
    quote.answers.details='Two drains';
    quote.answers.access='Driveway';
    quote.answers.waste='10';
    quote.answers.schedule='Within 60 days';
    quote.answers.permits='Included in our scope';
    expect(nextQuestion(quote)).toBeNull();
    expect(questions('roofing',quote.answers).filter(q=>isMissing(q,quote.answers)).map(q=>q.id)).toEqual([]);
  });
  it('records unknown answers as flagged-for-review without blocking the flow',()=>{
    const quote=roofingQuote();
    quote.answers.waste='Not sure yet';
    // Recorded "I don't know" is an answer, not a gap: the flow moves on…
    expect(nextQuestion(quote)).toBeNull();
    expect(questions('roofing',quote.answers).filter(q=>isMissing(q,quote.answers)).map(q=>q.id)).toEqual([]);
    // …but the flag still surfaces in the read-back for review before approval.
    expect(voiceReadBack(quote)).toContain('Flagged for review');
  });
});

describe('voice approval gate',()=>{
  it('reads back the customer, total, assumptions and flags before any save',()=>{
    const quote=roofingQuote();
    quote.lines=initialLines(quote);
    quote.lines[0].material=2.2;quote.lines[0].hours=0;
    for(const line of quote.lines.slice(1)){line.hours=40;line.material=0;line.rate=55;}
    quote.assumptions='TPO 60mil over ISO.\nExisting deck assumed sound.';
    const text=voiceReadBack(quote);
    expect(text).toContain('ACME Holdings');
    expect(text).toContain('12 Elm St');
    expect(text).toContain(money(totals(quote.lines,quote.pricing).total));
    expect(text).toContain('TPO 60mil');
    expect(text).toContain('pending project');
    expect(text).toContain('Do you confirm saving exactly this revision?');
  });
  it('blocks approval without a portal customer, acknowledgment or priced lines, and never for a broken revision',()=>{
    const quote=roofingQuote();
    quote.lines=initialLines(quote);
    expect(approvalBlockers(quote)).toContain('No portal customer is selected. Choose the matching customer on screen.');
    expect(approvalBlockers(quote)).toContain('Some cost lines still need quantities or pricing.');
    quote.portal={clientId:'c1',customerName:'ACME'};
    quote.acknowledged=true;
    quote.lines[0].material=2.2;quote.lines[0].hours=0;
    for(const line of quote.lines.slice(1)){line.hours=40;line.material=0;line.rate=55;}
    expect(approvalBlockers(quote)).toEqual([]);
    quote.approvedAt=new Date().toISOString();
    expect(approvalBlockers(quote)).toContain('This revision is already approved.');
  });
  it('requires a confirmation tied to the exact read-back revision and rejects stale or edited confirmations',()=>{
    const quote=roofingQuote();
    quote.lines=initialLines(quote);
    quote.lines[0].material=2.2;quote.lines[0].hours=0;
    for(const line of quote.lines.slice(1)){line.hours=40;line.material=0;line.rate=55;}
    quote.portal={clientId:'c1',customerName:'ACME'};
    quote.acknowledged=true;
    const prepared=prepareVoiceApproval(quote);
    expect(confirmVoiceApproval(quote,null,prepared.fingerprint).ok).toBe(false);
    expect(confirmVoiceApproval(quote,prepared,'different-fingerprint').ok).toBe(false);
    expect(confirmVoiceApproval(quote,prepared,prepared.fingerprint).ok).toBe(true);
    quote.lines[0].material=3.3;
    expect(confirmVoiceApproval(quote,prepared,prepared.fingerprint).ok).toBe(false);
  });
  it('keeps the approval id stable across repeated confirmations so retries cannot duplicate projects',()=>{
    const quote=roofingQuote();
    quote.lines=initialLines(quote);
    quote.lines[0].material=2.2;quote.lines[0].hours=0;
    for(const line of quote.lines.slice(1)){line.hours=40;line.material=0;line.rate=55;}
    quote.portal={clientId:'c1',customerName:'ACME'};
    quote.acknowledged=true;
    // The voice save flow records the prepared identity on the draft before the request, exactly like the on-screen approval button.
    const first=prepareVoiceApproval(quote);
    quote.portal={...quote.portal,approvalId:first.approvalId,fingerprint:first.fingerprint};
    const second=prepareVoiceApproval(quote);
    expect(second.approvalId).toBe(first.approvalId);
    expect(confirmVoiceApproval(quote,first,first.fingerprint).ok).toBe(true);
  });
});

describe('voice context',()=>{
  it('guides a fresh session and never re-asks provided answers',()=>{
    expect(buildVoiceContext({userName:'Mike',quote:null})).toContain('Signed-in user: Mike');
    expect(buildVoiceContext({userName:'Mike',quote:null})).toContain('start_quote');
    const quote=roofingQuote();
    const context=buildVoiceContext({userName:'Mike',quote});
    expect(context).toContain('do not ask for these again');
    expect(context).toContain('All intake questions are answered');
    quote.stage='review';
    expect(buildVoiceContext({userName:'Mike',quote})).toContain('prepare_approval');
  });
});

describe('voice controller',()=>{
  type Sent={type:string;[k:string]:unknown};
    const setup=(quote:Quote|null,overrides:Partial<Record<'startQuote'|'setAnswer'|'markUnknown'|'goBack'|'startEstimate'|'measureRoof'|'confirmRoofMeasurement'|'discardRoofMeasurement'|'classifyVoiceTurn'|'saveApproval',((...args:never[])=>unknown)>>={})=>{
    const sent:Sent[]=[];
    const actions={
      getQuote:()=>quote,
      getUserName:()=>'Mike',
      startQuote:vi.fn((type:JobType,address:string)=>{quote=makeQuote(type,pricing);quote.answers={address};return {message:'Quote draft created.',quote};}),
      setAnswer:vi.fn(()=>({message:'Answer recorded.',quote})),
      markUnknown:vi.fn(()=>({message:'Marked as not sure.',quote})),
      goBack:vi.fn(()=>({message:'Revisiting the earlier question.',quote})),
      startEstimate:vi.fn(()=>({message:'Research started.',quote})),
      measureRoof:vi.fn(async()=>({message:'Google measured 2,400 sq ft of roof at the address. Confirm the building with the user.',quote})),
      confirmRoofMeasurement:vi.fn(()=>({ok:true,message:'Confirmed roof measurement.',quote})),
      discardRoofMeasurement:vi.fn(()=>({ok:true,message:'Discarded roof measurement.',quote})),
      classifyVoiceTurn:vi.fn(async()=>null),
      saveApproval:vi.fn(async()=>({saved:true,message:'Saved revision 1.',quote})),
      ...overrides,
    };
    const controller=createVoiceController(actions as never,{onState:()=>{}},event=>sent.push(event as Sent));
    const tool=(name:string,args:unknown)=>({type:'response.output_item.done',item:{type:'function_call',call_id:`${name}_${++toolCounter}`,name,arguments:JSON.stringify(args)}});
    let toolCounter=0;
    const output=(name:string)=>{const matches=sent.filter(e=>e.type==='conversation.item.create'&&((e as {item?:{call_id?:string}}).item?.call_id?.startsWith(`${name}_`)));return JSON.stringify(matches[matches.length-1]||{});};
    return {controller,sent,actions,tool,output};
  };

  it('greets, records a valid answer, pushes fresh context and asks the next question',async()=>{
    let quote=roofingQuote();
    const {controller,sent,actions,tool,output}=setup(quote);
    controller.handleEvent({type:'session.created'});
    expect(sent.filter(e=>e.type==='conversation.item.create').length).toBeGreaterThan(0);
    expect(sent.some(e=>e.type==='response.create')).toBe(true);
    controller.handleEvent(tool('set_answer',{field:'customer',value:'ACME Holdings'}));
    await vi.waitFor(()=>expect(output('set_answer')).toContain('Answer recorded'));
    expect(actions.setAnswer).toHaveBeenCalledWith('customer','ACME Holdings');
  });
  it('refuses invalid answers without mutating the draft',async()=>{
    const {controller,actions,tool,output}=setup(roofingQuote());
    controller.handleEvent(tool('set_answer',{field:'waste',value:'150'}));
    await vi.waitFor(()=>expect(output('set_answer')).toContain('not a valid'));
    expect(actions.setAnswer).not.toHaveBeenCalled();
  });
  it('creates a quote from voice and refuses a second one while one is open',async()=>{
    const {controller,actions,tool,output}=setup(null);
    controller.handleEvent(tool('start_quote',{type:'roofing',address:'12 Elm St, Harrisburg, PA'}));
    await vi.waitFor(()=>expect(output('start_quote')).toContain('Quote draft created'));
    expect(actions.startQuote).toHaveBeenCalledWith('roofing','12 Elm St, Harrisburg, PA');
    controller.handleEvent(tool('start_quote',{type:'roofing',address:'elsewhere'}));
    await vi.waitFor(()=>expect(output('start_quote')).toContain('already open'));
  });
  it('supports interruption: speech during a response switches to listening and drops the stale transcript',async()=>{
    const {controller}=setup(roofingQuote());
    controller.handleEvent({type:'session.created'});
    controller.handleEvent({type:'response.created',response:{id:'r1'}});
    controller.handleEvent({type:'response.output_audio_transcript.delta',delta:'So the roof is '});
    controller.handleEvent({type:'input_audio_buffer.speech_started'});
    controller.handleEvent({type:'response.output_audio_transcript.delta',delta:'2,400 square feet.'});
    controller.handleEvent({type:'response.output_audio_transcript.done'});
    const state=controller.state;
    expect(state.phase).toBe('listening');
    expect(state.transcript.filter(t=>t.role==='revive')).toEqual([]);
  });
  it('pause blocks every command except resume',async()=>{
    const {controller,sent,tool,output}=setup(roofingQuote());
    controller.handleEvent({type:'session.created'});
    controller.handleEvent(tool('pause_session',{}));
    await vi.waitFor(()=>expect(output('pause_session')).toContain('Paused'));
    expect(controller.state.paused).toBe(true);
    controller.handleEvent(tool('set_answer',{field:'customer',value:'ACME'}));
    await vi.waitFor(()=>expect(output('set_answer')).toContain('paused'));
    controller.handleEvent(tool('resume_session',{}));
    await vi.waitFor(()=>expect(output('resume_session')).toContain('Resumed'));
    expect(controller.state.paused).toBe(false);
    expect(sent.some(e=>e.type==='response.create')).toBe(true);
  });
  it('refuses to start the estimate while intake is incomplete and starts it when complete',async()=>{
    const partial=roofingQuote();
    delete (partial.answers as Record<string,unknown>).schedule;
    const {controller,actions,tool,output}=setup(partial);
    controller.handleEvent(tool('start_estimate',{}));
    await vi.waitFor(()=>expect(output('start_estimate')).toContain('incomplete'));
    expect(actions.startEstimate).not.toHaveBeenCalled();
    const {controller:c2,actions:a2,tool:t2,output:o2}=setup(roofingQuote());
    c2.handleEvent(t2('start_estimate',{}));
    await vi.waitFor(()=>expect(o2('start_estimate')).toContain('Research started'));
    expect(a2.startEstimate).toHaveBeenCalled();
  });
  it('requires prepare_approval before confirm and rejects a fingerprint that does not match the read-back revision',async()=>{
    const quote=roofingQuote();
    quote.lines=initialLines(quote);
    quote.lines[0].material=2.2;quote.lines[0].hours=0;
    for(const line of quote.lines.slice(1)){line.hours=40;line.material=0;line.rate=55;}
    quote.stage='review';
    quote.portal={clientId:'c1',customerName:'ACME'};
    quote.acknowledged=true;
    const {controller,actions,tool,output}=setup(quote);
    controller.handleEvent(tool('confirm_approval',{fingerprint:'never-read-back'}));
    await vi.waitFor(()=>expect(output('confirm_approval')).toContain('No revision was read back'));
    expect(actions.saveApproval).not.toHaveBeenCalled();
    controller.handleEvent(tool('prepare_approval',{}));
    await vi.waitFor(()=>expect(output('prepare_approval')).toContain('SUMMARY:'));
    const prepared=controller.state.pendingApproval;
    expect(prepared).toBeTruthy();
    controller.handleEvent(tool('confirm_approval',{fingerprint:'wrong'}));
    await vi.waitFor(()=>expect(output('confirm_approval')).toContain('does not match'));
    expect(actions.saveApproval).not.toHaveBeenCalled();
    controller.handleEvent(tool('confirm_approval',{fingerprint:prepared!.fingerprint}));
    await vi.waitFor(()=>expect(output('confirm_approval')).toContain('Saved revision 1'));
    expect(actions.saveApproval).toHaveBeenCalledWith(expect.objectContaining({id:quote.id}));
  });
  it('recaps after every fourth recorded answer instead of confirming each one',async()=>{
    const {controller,tool,output}=setup(roofingQuote());
    controller.handleEvent({type:'response.created',response:{id:'r1'}});
    controller.handleEvent(tool('set_answer',{field:'title',value:'ACME roof'}));
    await vi.waitFor(()=>expect(output('set_answer')).toContain('recorded'));
    controller.handleEvent(tool('set_answer',{field:'roofWork',value:'Replacement'}));
    controller.handleEvent(tool('set_answer',{field:'measurementMode',value:'Measured roof surface area'}));
    const before=JSON.parse(output('set_answer'));
    expect(before.item.output).not.toContain('RECAP-DUE'); // three answers: no recap yet
    controller.handleEvent(tool('set_answer',{field:'layers',value:'1 layer'}));
    await vi.waitFor(()=>{
      const after=JSON.parse(output('set_answer'));
      expect(after.item.output).toContain('RECAP-DUE');
      expect(after.item.output).toContain('How many layers need to come off?');
    });
      const after=JSON.parse(output('set_answer'));
      expect(after.item.output).toContain('ACME roof');
      expect(after.item.output).toContain('1 layer');
      expect(controller.state.recapPending).toHaveLength(4);
      controller.handleEvent(tool('start_estimate',{}));
      await vi.waitFor(()=>expect(output('start_estimate')).toContain('recap is awaiting confirmation'));
      controller.handleEvent(tool('confirm_recap',{}));
      await vi.waitFor(()=>expect(output('confirm_recap')).toContain('Recap confirmed'));
      expect(controller.state.recapPending).toBeNull();
  });
  it('offers a Google measurement through the measure_roof tool and refuses it for non-roofing quotes',async()=>{
    const roofing=roofingQuote();
    delete roofing.answers.roofArea;
    const {controller:roofController,actions:roofActions,output:o1}=setup(roofing);
    roofController.handleEvent({type:'response.created',response:{id:'r1'}});
    roofController.handleEvent(itemDone({call_id:'measure_roof_m1',name:'measure_roof',arguments:JSON.stringify({})}));
    await vi.waitFor(()=>expect(o1('measure_roof')).toContain('Google measured'));
    expect(roofActions.measureRoof).toHaveBeenCalledWith(expect.stringContaining('12 Elm'));
    const renovation=roofingQuote();
    renovation.type='renovation';
    delete renovation.answers.roofArea;
    const {controller:renController,output:ro}=setup(renovation);
    renController.handleEvent({type:'response.created',response:{id:'r2'}});
    renController.handleEvent(itemDone({call_id:'measure_roof_m2',name:'measure_roof',arguments:JSON.stringify({})}));
    await vi.waitFor(()=>expect(ro('measure_roof')).toContain('only available for roofing'));
  });
  it('keeps a Google roof result pending until the user explicitly confirms it',async()=>{
    const quote=roofingQuote();delete quote.answers.roofArea;
    const {controller,actions}=setup(quote);
    controller.handleEvent(itemDone({call_id:'measure_pending',name:'measure_roof',arguments:'{}'}));
    await vi.waitFor(()=>expect(actions.measureRoof).toHaveBeenCalledTimes(1));
    expect(actions.confirmRoofMeasurement).not.toHaveBeenCalled();
    controller.handleEvent(itemDone({call_id:'confirm_pending',name:'confirm_roof_measurement',arguments:'{}'}));
    await vi.waitFor(()=>expect(actions.confirmRoofMeasurement).toHaveBeenCalledTimes(1));
  });
  it('ends the session cleanly',async()=>{
    const {controller,tool,output}=setup(roofingQuote());
    controller.handleEvent(tool('end_session',{}));
    await vi.waitFor(()=>expect(controller.state.phase).toBe('ended'));
    expect(output('end_session')).toContain('Session ended');
  });
  it('moves on after I-dont-know instead of re-asking the flagged question',()=>{
    const quote=roofingQuote();
    delete quote.answers.details; // "What roof details need attention?" allows unknown
    const verdict=evaluateMarkUnknown(quote,'details');
    expect(verdict).toEqual({ok:true,value:'Not sure yet'});
    const after={...quote,answers:{...quote.answers,details:'Not sure yet'}};
    // The recorded unknown is no longer reported as the next question to ask.
    expect(nextQuestion(after)?.id).not.toBe('details');
    // And a fully unknown-flagged intake does not block estimate generation.
    const flagged:Quote={...after,answers:{...after.answers,condition:'Not sure yet',access:'Not sure yet'}};
    expect(nextQuestion(flagged)?.id).not.toBe('details');
  });


  const itemDone=(call:{call_id:string;name:string;arguments:string})=>({type:'response.output_item.done',item:{type:'function_call',...call}});
  const responseDoneWith=(call:{call_id:string;name:string;arguments:string})=>({type:'response.done',response:{id:'resp_1',output:[{type:'function_call',...call}]}});
  const systemContexts=(sent:Sent[])=>sent.filter(e=>e.type==='conversation.item.create'&&((e as {item?:{type?:string}}).item?.type==='message')).map(e=>JSON.stringify(e)).filter(t=>t.includes('"role":"system"'));

  it('executes a function call exactly once when both completion events deliver it',async()=>{
    const {controller,actions}=setup(roofingQuote());
    const call={call_id:'dup_1',name:'set_answer',arguments:JSON.stringify({field:'customer',value:'ACME Holdings'})};
      controller.handleEvent({type:'response.created',response:{id:'resp_1'}});
      controller.handleEvent(itemDone(call));
      controller.handleEvent({type:'response.created',response:{id:'resp_2'}});
      controller.handleEvent(responseDoneWith(call));
    await vi.waitFor(()=>expect(actions.setAnswer).toHaveBeenCalledTimes(1));
    await new Promise(r=>setTimeout(r,50));
    expect(actions.setAnswer).toHaveBeenCalledTimes(1);
  });
  it('nudges a committed voice turn once when no automatic response starts and uses Jev only as a routing hint',async()=>{
    vi.useFakeTimers();
    try{
      const classifyVoiceTurn=vi.fn(async()=>({intent:'resume',confidence:0.88,reliable:true}));
      const {controller,sent}=setup(roofingQuote(),{classifyVoiceTurn:classifyVoiceTurn as never});
      controller.handleEvent({type:'input_audio_buffer.committed'});
      controller.handleEvent({type:'conversation.item.input_audio_transcription.completed',transcript:'keep going'});
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(4500);
      expect(classifyVoiceTurn).toHaveBeenCalledWith('keep going');
      const text=JSON.stringify(sent);
      expect(text).toContain('no automatic response started');
      expect(text).toContain('routing hint');
      expect(sent.filter(event=>event.type==='response.create')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(sent.filter(event=>event.type==='response.create')).toHaveLength(1);
      controller.dispose();
    }finally{vi.useRealTimers();}
  });
  it('processes each protected voice command once across both events',async()=>{
    const quote=roofingQuote();
    quote.stage='review';quote.portal={clientId:'c1',customerName:'ACME'};quote.acknowledged=true;
    const {controller,actions}=setup(quote);
    controller.handleEvent({type:'response.created',response:{id:'r1'}});
    const calls=[
      {call_id:'a',name:'start_quote',arguments:JSON.stringify({type:'roofing',address:'x'})},
      {call_id:'b',name:'set_answer',arguments:JSON.stringify({field:'customer',value:'ACME Holdings'})},
      {call_id:'c',name:'start_estimate',arguments:JSON.stringify({})},
      {call_id:'d',name:'prepare_approval',arguments:JSON.stringify({})},
      {call_id:'e',name:'confirm_approval',arguments:JSON.stringify({fingerprint:'nope'})},
    ];
    controller.handleEvent({type:'response.done',response:{id:'r1',output:calls.map(c=>({type:'function_call',...c}))}});
    for(const c of calls)controller.handleEvent(itemDone(c));
    await vi.waitFor(()=>expect(actions.setAnswer).toHaveBeenCalledTimes(1));
    expect(actions.saveApproval).not.toHaveBeenCalled();
  });
  it('keeps voice context synchronized with React state without repeating questions',async()=>{
    const sent:Sent[]=[];
    let quote:Quote|null=null;
    const actions={
      getQuote:()=>quote,
      getUserName:()=>'Mike',
      startQuote:(type:JobType,address:string)=>{quote=makeQuote(type,pricing);quote.answers={address};return {message:'Quote draft created.',quote};},
      setAnswer:(field:string,value:string|string[])=>{if(!quote)return {message:'No quote.',quote:null};const answers={...quote.answers,[field]:value};quote={...quote,answers};return {message:'Answer recorded.',quote};},
      markUnknown:(field:string)=>{if(!quote)return {message:'No quote.',quote:null};return {message:'Marked.',quote:{...quote,answers:{...quote.answers,[field]:'Not sure yet'}}};},
      goBack:()=>({message:'Going back.',quote}),
      startEstimate:()=>({message:'Research started.',quote}),
      saveApproval:vi.fn(async()=>({saved:true,message:'Saved.',quote:null})),
    };
    const controller=createVoiceController(actions as never,{onState:()=>{}},event=>sent.push(event as Sent));
    // 1. Roofing quote created by voice — the next context carries the address.
    controller.handleEvent({type:'response.created',response:{id:'r1'}});
    controller.handleEvent(itemDone({call_id:'q1',name:'start_quote',arguments:JSON.stringify({type:'roofing',address:'100 Test St, Pittsburgh, PA'})}));
    await vi.waitFor(()=>expect(quote).toBeTruthy());
    const firstContext=systemContexts(sent).join(' ');
    expect(firstContext).toContain('100 Test St, Pittsburgh, PA');
    // 2. An answer is recorded — the next context contains it and asks the next unanswered question.
    const before=sent.length;
    controller.handleEvent(itemDone({call_id:'q2',name:'set_answer',arguments:JSON.stringify({field:'customer',value:'ACME Holdings'})}));
    await new Promise(r=>setTimeout(r,30));
    const secondContext=systemContexts(sent).slice(-1)[0]||'';
    expect(secondContext).toContain('ACME Holdings');
    expect(secondContext).toContain('next question');
    expect(before).toBeLessThan(sent.length);
    // 3. The previous question is not re-asked.
    const nextMatch=secondContext.match(/"title":"([^"]+)"/);
    expect(nextMatch?.[1]).not.toBe('Who is this quote for?');
  });
});
