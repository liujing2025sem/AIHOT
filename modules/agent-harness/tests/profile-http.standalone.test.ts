// Actual registered-profile -> real chatJson -> receipt callback -> HTTP, with only DB receipts mocked.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("selected profile reaches original LLM transport over fake HTTP without a key, and task abort stays uncertain", () => {
  const backend = new URL("../../../packages/backend/src/", import.meta.url);
  const core = new URL("../backend/core.ts", import.meta.url);
  const aiHot = new URL("../backend/aihot.ts", import.meta.url);
  const source = `
    import assert from 'node:assert/strict';
    import {mock} from 'node:test';
    import {createServer} from 'node:http';
    process.env.MODEL_CALLS_ENABLED='true';
    process.env.AIHOT_CREDENTIALS_DIR='/nonexistent-test-credentials';
    process.env.LLM_EXTRA_JSON='{}';process.env.LLM_REASONING_TOKENS='0';
    delete process.env.LLM_API_KEY;delete process.env.LLM_MODEL;delete process.env.LLM_BASE_URL;
    const receipts=[];
    class Rejected extends Error {constructor(status){super('fixture HTTP refusal');this.status=status}}
    class E extends Error {}
    mock.module(${JSON.stringify(new URL("providers/receipts.ts", backend).href)}, {namedExports:{
      assertAccepted(_service,status){if(status<200||status>=300)throw new Rejected(status)},
      failureKind(){return 'unknown'},logicalKeyFor(){return 'fixture'},
      BudgetExceededError:E,ModelOutputError:E,ModelUnavailableError:E,ProviderRejectedError:Rejected,
      receiptState:async()=>null,rejectReceivedResponse:async()=>{},
      paidRequest:async(request,call)=>{receipts.push(request);return {receiptId:receipts.length,reused:false,response:(await call()).response}}
    }});
    const {Harness,registerProfiles}=await import(${JSON.stringify(core.href)});
    const {createConfiguredAIhotExecutor}=await import(${JSON.stringify(aiHot.href)});
    const {chatJson}=await import(${JSON.stringify(new URL("providers/llm.ts", backend).href)});
    const hits=[];let slowResponse;let arrived;
    const slowArrived=new Promise(resolve=>{arrived=resolve});
    const server=createServer(async(req,res)=>{
      assert.equal(req.headers.authorization,undefined);
      assert.equal(req.headers['user-agent'],'selectable-api-harness/0.1');
      let text='';for await(const chunk of req)text+=chunk;
      const body=JSON.parse(text);hits.push({url:req.url,model:body.model,session:req.headers['x-opencode-session']});
      if(req.url==='/slow/v1/chat/completions'){slowResponse=res;arrived();return}
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({id:'local-receipt',choices:[{message:{content:JSON.stringify({summary:'Original '+body.model})}}],usage:{prompt_tokens:3}}));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const root='http://127.0.0.1:'+server.address().port;
      const supplied=['a','b','slow'].map(id=>({profile_id:id,kind:'model_api',protocol:'openai_chat_completions',provider:'fixture-'+id,model:'selected-'+id,endpoint:root+'/'+id+'/v1',auth:{mode:'none',secret_ref:null},budget_policy_ref:'existing:llm',network_policy_ref:'approved-loopback'}));
      const profiles=registerProfiles(supplied,{'approved-loopback':{endpoints:supplied.map(p=>p.endpoint),loopback_no_auth:true}});
      const slots=Object.fromEntries(supplied.map(p=>[p.profile_id,{model_key:'default',budget_policy_ref:'existing:llm'}]));
      const executor=createConfiguredAIhotExecutor(profiles,slots,async()=>({state:'unknown'}));
      const harness=new Harness(profiles,{executor:()=>executor,persist(){},authorize(){},claim(){return true},cancelAccepted(){return true}});
      const tasks=new Map();
      for(const id of ['a','b','slow'])tasks.set(id,harness.submit({project:'aihot',task_id:'attempt-'+id,original_task_id:'owner-'+id,idempotency_key:'once-'+id,profile_id:id,role:'summary',source_binding:{version:'approved-source-v1'},input:{text:'Synthetic announcement.',source_url:'https://example.invalid/source',source_date:'2026-10-26'}}));
      for(const id of ['a','b']){
        const task=tasks.get(id);await harness.dispatch('aihot',task.task_id);
        const result=harness.result('aihot',task.task_id,{source_binding:task.source_binding,profile_fingerprint:task.profile_fingerprint});
        assert.equal(result.candidate.output.summary,'Original selected-'+id);
        assert.equal(result.candidate.output.source_url,'https://example.invalid/source');
        assert.equal(result.candidate.usage.input_tokens,3);assert.equal(result.candidate.usage.total_tokens,null);assert.equal(result.candidate.usage.reported_cost,null);
      }
      assert.deepEqual(hits,[{url:'/a/v1/chat/completions',model:'selected-a',session:undefined},{url:'/b/v1/chat/completions',model:'selected-b',session:undefined}]);
      assert.equal(receipts[0].service,'llm');
      assert.notEqual(receipts[0].identity.loopbackProfile.profileFingerprint,receipts[1].identity.loopbackProfile.profileFingerprint);
      const slow=tasks.get('slow');const running=harness.dispatch('aihot',slow.task_id);await slowArrived;
      await harness.cancel('aihot',slow.task_id);await running;
      assert.equal(harness.status('aihot',slow.task_id).state,'unknown');
      assert.equal(harness.status('aihot',slow.task_id).cancellation,'unsupported');
      assert.equal(hits.length,3);assert.equal(receipts.length,3);
      const codingOptions={model:'default',loopbackProfile:{baseUrl:root+'/coding/v1',model:'synthetic-code-review',profileFingerprint:'a'.repeat(64)},purpose:'synthetic_code_review',subject:'synthetic-code',promptVersion:'code-fixture-v1',system:'Review the synthetic TypeScript.',user:'function add(a: number, b: number) { return a - b; }',schema:{parse:x=>x},maxTokens:512};
      for(const sessionId of ['conversation-a','conversation-a','conversation-b'])await chatJson({...codingOptions,sessionId});
      assert.deepEqual(hits.slice(3).map(hit=>hit.session),['conversation-a','conversation-a','conversation-b']);
      assert.equal(receipts[3].identity.client.sessionId,receipts[4].identity.client.sessionId);
      assert.notEqual(receipts[3].identity.client.sessionId,receipts[5].identity.client.sessionId);
      console.log('ACTUAL_PROFILE_LLM_HTTP_AND_CANCEL_PASS');
    }finally{
      slowResponse?.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    }
  `;
  const output = execFileSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", source],
    { cwd: fileURLToPath(new URL("../../../", import.meta.url)), encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
  assert.match(output, /ACTUAL_PROFILE_LLM_HTTP_AND_CANCEL_PASS/);
});
