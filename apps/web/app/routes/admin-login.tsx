// Admin sign-in: the admin password (ADMIN_PASSWORD), and Feishu when it is configured. The form posts
// straight to the API, which sets the session cookie and sends the browser on.
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-login";
import { SITE } from "@aihot/site";
import { apiGet } from "../lib/api.server";
import { adminSignedIn } from "../lib/admin.server";
import { buttonClass } from "../components/ui/Controls";
import "../features/admin/original-workbench.css";

const ERRORS: Record<string, string> = {
  wrong: "账户名或密码不正确，请检查后重试。",
  unset: "管理员登录尚未配置，请联系维护人完成设置。",
  "too-many": "尝试次数太多，请 15 分钟后再试。",
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("return") ?? "/admin";
  const target = returnTo.startsWith("/admin") ? returnTo : "/admin";
  // Already signed in: the sign-in page has nothing to offer; go where the visitor was headed.
  if (await adminSignedIn(request).catch(() => false)) throw redirect(target);
  const options = await apiGet<{ password: boolean; feishu: boolean; usernameRequired?: boolean }>("/api/auth/options", { signal: request.signal }).catch(() => ({ password: true, feishu: false, usernameRequired: false }));
  return { returnTo: target, error: url.searchParams.get("error"), ...options };
}

export const meta: Route.MetaFunction = () => [{ title: `登录 · ${SITE.name} 后台` }, { name: "robots", content: "noindex, nofollow" }];

export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });

export default function AdminLogin() {
  const { returnTo, error, password, feishu, usernameRequired } = useLoaderData<typeof loader>();
  const message = error ? (ERRORS[error] ?? ERRORS.wrong) : !password ? ERRORS.unset : null;
  return (
    <div className="workbench-login">
      <div className="workbench-login-panel">
        <LinkBrand />
        <h1>继续内容工作</h1>
        <p className="workbench-login-intro">登录后接续选题、审稿和交付。</p>
        <form method="post" action="/api/auth/password" className="mt-7">
          <input type="hidden" name="return" value={returnTo} />
          {usernameRequired && <div className="mb-5"><label htmlFor="username" className="block text-sm font-medium text-ink-2">管理员账户</label><input id="username" name="username" type="text" autoComplete="username" required autoFocus className="workbench-login-input" /></div>}
          <label htmlFor="password" className="block text-[13px] font-medium text-ink-2">
            管理员密码
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus={!usernameRequired}
            className="workbench-login-input"
          />
          {message && (
            <p role="alert" className="mt-3 text-[12.5px] leading-relaxed text-hot">
              {message}
            </p>
          )}
          <button type="submit" className={`${buttonClass("primary", "lg")} mt-5 w-full`}>
            进入工作台
          </button>
          {feishu && (
            <a href={`/api/auth/feishu?${new URLSearchParams({ return: returnTo })}`} className={`${buttonClass("secondary", "lg")} mt-3 w-full`}>
              用飞书登录
            </a>
          )}
        </form>
        <p className="mt-6 text-sm text-ink-3">
          <a href="/" className="hover:text-ink-2">
            回到 {SITE.name}
          </a>
        </p>
      </div>
    </div>
  );
}

function LinkBrand() {
  return <div className="workbench-login-brand"><span aria-hidden="true">A</span><div><strong>AIHOT</strong><span>Chipshow 内容工作台</span></div></div>;
}
