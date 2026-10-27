// Run the real chatJson control flow with fake receipts/circuit/transport: no DB or paid request is possible.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("original chatJson does not reserve/send pre-aborted work or fail over after task cancellation", () => {
  const base = new URL("../../../packages/backend/src/", import.meta.url);
  const source = `
    import assert from 'node:assert/strict';
    import {mock} from 'node:test';
    process.env.MODEL_CALLS_ENABLED='true';
    process.env.AIHOT_CREDENTIALS_DIR='/nonexistent-test-credentials';
    process.env.DEEPSEEK_BASE_URL='https://fixture.invalid/v1';
    process.env.DEEPSEEK_API_KEY='synthetic-not-a-credential';
    process.env.DASHSCOPE_BASE_URL='https://fixture.invalid/v1';
    process.env.DASHSCOPE_API_KEY='synthetic-not-a-credential';
    const sent=[];
    class E extends Error {}
    mock.module(${JSON.stringify(new URL("providers/receipts.ts", base).href)}, {namedExports:{
      assertAccepted(){}, failureKind(){return 'unknown'}, logicalKeyFor(){return 'fixture'},
      ModelOutputError:E,ModelUnavailableError:E,ProviderRejectedError:E,
      receiptState:async()=>null,rejectReceivedResponse:async()=>{},
      paidRequest:async(request,call)=>{sent.push(request.model);return {receiptId:1,reused:false,response:(await call()).response}}
    }});
    mock.module(${JSON.stringify(new URL("providers/circuit.ts", base).href)}, {namedExports:{
      enterModelCircuit:async()=>({}),recordModelHealth:async()=>{}
    }});
    const {chatJson}=await import(${JSON.stringify(new URL("providers/llm.ts", base).href)});
    const stopped=new AbortController();stopped.abort();
    const options={model:'deepseek-flash',fallbackModel:'qwen3.8-flash',purpose:'fixture',subject:'fixture',promptVersion:'fixture',system:'fixture',user:'fixture',schema:{parse:x=>x}};
    await assert.rejects(chatJson({...options,signal:stopped.signal}),{name:'AbortError'});
    assert.equal(sent.length,0);
    const inflight=new AbortController();
    globalThis.fetch=async(_url,request)=>{inflight.abort();throw request.signal.reason};
    await assert.rejects(chatJson({...options,signal:inflight.signal}),{name:'AbortError'});
    assert.deepEqual(sent,['deepseek-flash']);
    console.log('PRE_ABORT_NO_SEND_AND_NO_CANCEL_FAILOVER');
  `;
  const output = execFileSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", source],
    { cwd: fileURLToPath(new URL("../../../", import.meta.url)), encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  assert.match(output, /PRE_ABORT_NO_SEND_AND_NO_CANCEL_FAILOVER/);
});

test("Go configuration fails before receipts, and coding calls preserve identity, session and billing evidence without retries", () => {
  const base = new URL("../../../packages/backend/src/", import.meta.url);
  const source = `
    import assert from 'node:assert/strict';
    import {mock} from 'node:test';
    process.env.MODEL_CALLS_ENABLED='true';
    process.env.AIHOT_CREDENTIALS_DIR='/nonexistent-test-credentials';
    process.env.LLM_BASE_URL='https://opencode.ai/inference/go/openai/v1';
    process.env.LLM_MODEL='deepseek-v4.1-flash';
    process.env.LLM_EXTRA_JSON='{}';process.env.LLM_REASONING_TOKENS='0';
    delete process.env.LLM_API_KEY;
    // Only the credential consumer is stubbed; no real key is read, set or logged.
    mock.module(${JSON.stringify(new URL("config.ts", base).href)}, {namedExports:{
      config:{modelCallsEnabled:true},
      credential(_group,name){return name==='LLM_API_KEY'?'synthetic-fixture-only':process.env[name]}
    }});
    const receipts=[];let lookups=0;const hits=[];let status=200;let timeout=false;
    class E extends Error {}
    class Rejected extends Error {constructor(status){super('fixture refusal');this.status=status}}
    mock.module(${JSON.stringify(new URL("providers/receipts.ts", base).href)}, {namedExports:{
      assertAccepted(_service,status){if(status<200||status>=300)throw new Rejected(status)},
      failureKind(error){return error instanceof Rejected?'refused':'unknown'},logicalKeyFor(){return 'fixture'},
      ModelOutputError:E,ModelUnavailableError:E,ProviderRejectedError:Rejected,
      receiptState:async()=>{lookups++;return null},rejectReceivedResponse:async()=>{},
      paidRequest:async(request,call)=>{receipts.push(request);return {receiptId:receipts.length,reused:false,response:(await call()).response}}
    }});
    // Fail closed: this replaces fetch before importing the application. No external socket is opened.
    globalThis.fetch=async(url,request)=>{
      assert.equal(url,'https://opencode.ai/inference/go/openai/v1/chat/completions');
      assert.equal(request.headers['user-agent'],'selectable-api-harness/0.1');
      assert.equal(request.headers.authorization,'Bearer synthetic-fixture-only');
      const body=JSON.parse(request.body);assert.equal(body.model,'deepseek-v4.1-flash');
      assert.match(body.messages[1].content,/function add/);
      assert.equal(body.max_tokens,512);
      hits.push({session:request.headers['x-opencode-session']});
      if(timeout)throw new DOMException('synthetic timeout','TimeoutError');
      return new Response(JSON.stringify({choices:[{message:{content:'{"issue":"subtraction instead of addition"}'}}],usage:{prompt_tokens:4,cost:0,opencode:{billing_source:'go',allowance:0.01}}}),{status});
    };
    const {chatJson}=await import(${JSON.stringify(new URL("providers/llm.ts", base).href)});
    const options={model:'default',sessionId:'coding-session-001',purpose:'synthetic_code_review',subject:'code-fixture',promptVersion:'v1',system:'Review this synthetic code. Reply with JSON.',user:'function add(a: number, b: number) { return a - b; }',schema:{parse:x=>x},maxTokens:512};
    for(const sessionId of [undefined,'','bad session','bad\\r\\nheader',null,7,'x'.repeat(129)])await assert.rejects(chatJson({...options,sessionId}),/sessionId/);
    for(const invalidBase of ['http://opencode.ai/inference/go/openai/v1','https://user@opencode.ai/inference/go/openai/v1','https://opencode.ai/inference/go/openai/v1?key=not-secret','https://opencode.ai/inference/go/openai/v1#fragment','https://opencode.ai/inference/go/openai/v1/chat/completions']){
      process.env.LLM_BASE_URL=invalidBase;await assert.rejects(chatJson(options),/HTTPS API base/);
    }
    process.env.LLM_BASE_URL='https://opencode.ai/inference/go/openai/v1';
    process.env.LLM_MODEL='different-model';await assert.rejects(chatJson(options),/deepseek-v4.1-flash/);
    process.env.LLM_MODEL='deepseek-v4.1-flash';
    process.env.LLM_EXTRA_JSON='{"model":"free-model"}';await assert.rejects(chatJson(options),/cannot override/);
    process.env.LLM_EXTRA_JSON='{}';
    await assert.rejects(chatJson({...options,fallbackModel:'qwen3.8-flash'}),/cannot implicitly fall back/);
    assert.equal(lookups,0);assert.equal(receipts.length,0);assert.equal(hits.length,0);
    for(const sessionId of ['coding-session-001','coding-session-001','coding-session-002']){
      const result=await chatJson({...options,sessionId});
      assert.equal(result.usage.opencode.billing_source,'go');assert.equal(result.usage.opencode.allowance,0.01);
      assert.equal(result.usage.cost,0);
    }
    assert.deepEqual(hits.map(hit=>hit.session),['coding-session-001','coding-session-001','coding-session-002']);
    assert.deepEqual(receipts[0].identity.client,receipts[1].identity.client);
    assert.notDeepEqual(receipts[0].identity.client,receipts[2].identity.client);
    for(const refusal of [401,403,429]){
      status=refusal;const count=hits.length;
      await assert.rejects(chatJson(options),error=>error.status===refusal);
      assert.equal(hits.length,count+1);
    }
    timeout=true;const count=hits.length;
    await assert.rejects(chatJson(options),{name:'TimeoutError'});assert.equal(hits.length,count+1);
    assert.equal(lookups,0);
    console.log('GO_TRANSPORT_CONFIG_SESSION_AND_STOP_PASS');
  `;
  const output = execFileSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", source],
    { cwd: fileURLToPath(new URL("../../../", import.meta.url)), encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  assert.match(output, /GO_TRANSPORT_CONFIG_SESSION_AND_STOP_PASS/);
});
