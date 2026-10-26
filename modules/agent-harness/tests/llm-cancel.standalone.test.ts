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
