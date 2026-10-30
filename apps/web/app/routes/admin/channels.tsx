import { useState } from "react";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { AdminChannel, AdminChannelId, AdminChannels, AdminChannelTest } from "@aihot/contracts/admin";
import { SITE } from "@aihot/site";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, Field, Input } from "../../features/admin/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  return adminGet<AdminChannels>(request, "/api/admin/channels");
}
export const meta = () => [{ title: `API 渠道 · ${SITE.name} 后台` }];
export const headers = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });

function ChannelEditor({ channel }: { channel: AdminChannel }) {
  const { run, busy } = useAdminAction();
  const [baseUrl, setBaseUrl] = useState(channel.baseUrl);
  const [model, setModel] = useState(channel.model);
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(channel.enabled);
  const [deleteKey, setDeleteKey] = useState(false);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [result, setResult] = useState<AdminChannelTest | null>(null);
  const dirty = baseUrl !== channel.baseUrl || model !== channel.model || key.trim() !== "" || enabled !== channel.enabled || deleteKey;
  const save = async (activate: boolean) => {
    const saved = await run("PUT", `/api/admin/channels/${channel.id}`, {
      baseUrl, model, key, enabled, deleteKey, activate, reason: activate ? "启用并切换 Studio API 渠道" : "修改 API 渠道配置",
    }, { success: activate ? "渠道已切换，默认模型的新请求使用此配置" : "渠道已保存" });
    if (saved) { setKey(""); setDeleteKey(false); setResult(null); }
  };
  const test = async (kind: "models" | "completion") => {
    setResult(null);
    const response = await run<AdminChannelTest>("POST", `/api/admin/channels/${channel.id}/test`,
      kind === "models" ? { kind } : { kind, confirmPaid: true, ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}) },
      { revalidate: false, label: `test-${channel.id}-${kind}` });
    if (response) setResult(response);
  };
  return (
    <Card title={channel.name} right={<Badge tone={channel.active ? "ok" : "muted"}>{channel.active ? "当前使用" : enabled ? "可选渠道" : "已停用"}</Badge>}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="API 根地址" hint="填写包含 /v1 的兼容接口根地址。">
          <Input aria-label="API 根地址" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} readOnly={channel.id === "opencode-go"} />
        </Field>
        <Field label="模型" hint={channel.id === "opencode-go" ? "OpenCode Go 固定使用 deepseek-v4.1-flash。" : "输入服务商提供的模型 ID；DeepSeek Pro 已禁用。"}>
          <Input aria-label="模型" value={model} onChange={(e) => setModel(e.target.value)} readOnly={channel.id === "opencode-go"} list={`models-${channel.id}`} />
          <datalist id={`models-${channel.id}`}>{result?.models.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field label="API Key" hint={channel.hasKey ? `已保存 ${channel.maskedKey}，留空保留。来源：${channel.keySource === "credential-file" ? "本机凭据文件" : "运行环境"}。` : "尚未配置。密钥仅由服务端保存。"}>
          <Input aria-label="API Key" type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} disabled={deleteKey} placeholder="留空保留已保存密钥" />
        </Field>
        <div className="flex flex-col justify-center gap-3 text-[13px] text-ink-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />启用此渠道</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={deleteKey} onChange={(e) => { setDeleteKey(e.target.checked); setKey(""); }} />明确删除已保存密钥</label>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button busy={busy} onClick={() => void save(false)}>保存配置</Button>
        <Button tone="primary" disabled={!enabled || deleteKey} busy={busy} onClick={() => void save(true)}>保存并使用此渠道</Button>
        <Button disabled={dirty || !enabled} busy={busy} onClick={() => void test("models")}>检查模型列表（不生成）</Button>
      </div>
      {dirty && <p className="mt-2 text-[12px] text-ink-3">先保存配置，再测试服务端连接。</p>}
      <details className="mt-5 border-t border-line pt-4 text-[13px] text-ink-2">
        <summary className="cursor-pointer">实际生成测试</summary>
        <p className="mt-3 text-ink-3">点击后向已保存的渠道发送一次最小生成请求，可能消耗服务商额度；请求计入现有预算和回执。</p>
        {channel.id === "opencode-go" && <div className="mt-3"><Field label="已有编码会话 sessionId"><Input aria-label="已有编码会话 sessionId" value={sessionId} onChange={(e) => setSessionId(e.target.value)} /></Field><p className="mt-1 text-[12px] text-ink-3">沿用既有 Go 编码会话约束，采编生成请使用标准 API 或 Custom。</p></div>}
        <label className="my-3 flex items-center gap-2"><input type="checkbox" checked={confirmPaid} onChange={(e) => setConfirmPaid(e.target.checked)} />确认执行一次实际生成测试</label>
        <Button disabled={!confirmPaid || dirty || !enabled || (channel.id === "opencode-go" && !sessionId.trim())} busy={busy} onClick={() => void test("completion")}>执行生成测试</Button>
      </details>
      {result && <div role="status" className="mt-4 rounded-control bg-bg-sunk p-4 text-[13px] text-ink-2">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={result.ok ? "ok" : "warn"}>{result.ok ? "验证通过" : "未验证通过"}</Badge><span>HTTP {result.status ?? "未收到响应"}</span><span className="break-all">模型：{result.returnedModel ?? result.model}</span></div>
        <p className="mt-2 whitespace-pre-wrap break-words">{result.detail}</p>
        {!!result.models.length && <p className="mt-2 text-ink-3">返回 {result.models.length} 个模型，可在模型输入框中选择。</p>}
        {result.receiptId !== undefined && <p className="mt-1 text-ink-3">回执 #{result.receiptId}</p>}
      </div>}
    </Card>
  );
}

export default function Channels() {
  const data = useLoaderData<typeof loader>();
  const { run, busy } = useAdminAction();
  const [selected, setSelected] = useState<AdminChannelId>(data.activeId ?? "opencode-go");
  const channel = data.channels.find((c) => c.id === selected)!;
  return (
    <AdminPage title="API 渠道" subtitle="保存服务地址、模型与密钥，为 Studio 默认调用选择 API 服务。">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface p-4"><div><p className="text-sm font-semibold">API 生成：{data.modelCallsEnabled ? '已开启' : '已暂停'}</p><p className="mt-1 text-xs text-ink-3">开启后，手动生成和已启用的采编任务可使用服务商额度。Codex 文件接棒不受此开关影响。</p></div><Button busy={busy} onClick={()=>void run('PUT','/api/admin/channels/generation',{enabled:!data.modelCallsEnabled},{success:data.modelCallsEnabled?'已暂停 API 生成':'已开启 API 生成'})}>{data.modelCallsEnabled?'暂停生成':'开启生成'}</Button></div>
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="API 渠道">
        {data.channels.map((c) => <button key={c.id} type="button" role="tab" aria-selected={selected === c.id} onClick={() => setSelected(c.id)} className={`rounded-control px-4 py-2 text-[13px] ${selected === c.id ? "bg-ink text-bg" : "bg-surface text-ink-2 ring-1 ring-line"}`}>{c.name}{c.active ? " · 当前" : ""}</button>)}
      </div>
      {!data.modelCallsEnabled && <p className="mb-4 text-[13px] text-ink-3">当前生成总开关关闭：可以保存配置和检查模型列表，实际生成暂停。</p>}
      {data.activeId === null && <p className="mb-4 text-[13px] text-ink-3">尚未切换渠道，现有调用继续使用原环境配置。点击“保存并使用此渠道”后生效。</p>}
      <ChannelEditor key={JSON.stringify(channel)} channel={channel} />
    </AdminPage>
  );
}
