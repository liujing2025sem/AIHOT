import type { ChangelogRelease } from "@aihot/contracts/site";
import { Link } from "react-router";
import { SITE } from "../site";

const paths = [
  { number: "01", title: "读资讯", note: "精选与全部资讯，保留来源和试验稿标记。", to: "/all" },
  { number: "02", title: "看脉络", note: "原生热点、日报和主题，按已有数据展示。", to: "/daily" },
  { number: "03", title: "留线索", note: "详情页收藏，回到我的工作台继续阅读。", to: "/starred" },
  { number: "04", title: "管内容", note: "通过管理员登录，进入原有内容与信源后台。", to: "/admin" },
];

const letters = [
  ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
];

/** Original line engraving: a display cabinet, scan lines and a small LED pixel matrix. */
function DisplayLines() {
  return (
    <svg viewBox="0 0 1000 260" fill="none" className="absolute left-0 top-0 h-[150px] w-full text-accent sm:inset-0 sm:h-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="0.7" opacity="0.16">
        {Array.from({ length: 59 }, (_, row) => {
          const y = 22 + row * 3.7;
          return <path key={row} d={`M0 ${y} H475 Q500 ${y} 519 ${y - 7} L554 ${y - 20} H929 Q949 ${y - 20} 965 ${y - 7} L1000 ${y}`} />;
        })}
      </g>
      <g transform="translate(552 56) skewY(-5)">
        <path d="M-8 0 0-8H372L382 2V174L372 184H0L-8 174Z" className="fill-bg" stroke="currentColor" strokeWidth="1" opacity="0.8" />
        <rect width="372" height="174" rx="4" stroke="currentColor" strokeWidth="1.4" />
        <rect x="9" y="9" width="354" height="156" rx="2" stroke="currentColor" strokeWidth="0.7" opacity="0.45" />
        <g stroke="currentColor" strokeWidth="0.65" opacity="0.22">
          {Array.from({ length: 43 }, (_, row) => <path key={row} d={`M10 ${12 + row * 3.5} H362`} />)}
        </g>
        <g fill="currentColor" opacity="0.2">
          {Array.from({ length: 17 }, (_, row) => Array.from({ length: 39 }, (_, col) => <circle key={`${row}-${col}`} cx={15 + col * 9} cy={15 + row * 9} r="1" />))}
        </g>
        <g fill="currentColor">
          {letters.map((letter, l) => letter.map((row, r) => [...row].map((pixel, c) => pixel === "1" ? <circle key={`${l}-${r}-${c}`} cx={82 + l * 73 + c * 11} cy={46 + r * 11} r="2.8" /> : null)))}
        </g>
        <path d="M177 184V199H138M196 184V199H235M138 199H235" stroke="currentColor" strokeWidth="1.2" />
        <path d="M372 0 382 2M372 174 382 174" stroke="currentColor" strokeWidth="0.8" />
      </g>
    </svg>
  );
}

/** This site's release drawing uses the engine's existing changelog extension point. */
export function FeatureRelease({ release, id }: { release: ChangelogRelease; id?: string }) {
  return (
    <section id={id} className="card scroll-mt-[calc(var(--bar-h)+1.5rem)] overflow-hidden">
      <header className="border-b border-line bg-accent-softer p-5 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-4">
          <span className="font-semibold tracking-[0.18em] text-accent">本机工作台更新</span>
          <time dateTime={`${release.date}T${release.time}+08:00`}>{release.date} · {release.time} 北京时间</time>
        </div>
        <div aria-hidden="true" className="relative my-5 flex min-h-[210px] items-end overflow-hidden border-y border-accent/20 pb-5 sm:min-h-[220px] sm:items-center sm:pb-0 lg:my-7">
          <DisplayLines />
          <div className="relative pb-1 sm:py-8">
            <p className="text-[26px] font-bold tracking-[-0.035em] text-ink sm:text-[34px] lg:text-[38px]">{SITE.name}</p>
            <p className="mt-3 text-[11px] tracking-[0.15em] text-accent">LED 商显 · 资讯与运营</p>
          </div>
        </div>
        <h2 className="text-[19px] font-semibold leading-relaxed text-ink">{release.title}</h2>
        {release.body.map((line) => <p key={line} className="mt-3 max-w-[52em] text-[13.5px] leading-[1.85] text-ink-2">{line}</p>)}
      </header>
      <div className="p-5 lg:p-8">
        <h3 className="text-[18px] font-semibold text-ink">一个首页，接回原有工作路径</h3>
        <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-4">
          <span aria-hidden="true" className="absolute bottom-5 left-[5px] top-0 w-px bg-accent/40 sm:bottom-auto sm:left-[5px] sm:right-0 sm:top-[5px] sm:h-px sm:w-auto" />
          {paths.map((path) => (
            <Link key={path.to} to={path.to} className="group relative pb-6 pl-7 sm:pb-0 sm:pl-0 sm:pr-4 sm:pt-7">
              <span aria-hidden="true" className="absolute left-0 top-0 flex size-[11px] items-center justify-center rounded-full border border-accent bg-surface"><span className="size-[3px] rounded-full bg-accent" /></span>
              <span className="mono text-[11px] text-accent">{path.number}</span>
              <span className="mt-1.5 block text-[15px] font-semibold text-ink group-hover:text-accent">{path.title} →</span>
              <span className="mt-2 block text-[12.5px] leading-[1.8] text-ink-3">{path.note}</span>
            </Link>
          ))}
        </div>
        <div className="mt-8 border-t border-line pt-5">
          <h3 className="text-[15px] font-semibold text-ink">当前接入范围</h3>
          <p className="mt-2 text-[13px] leading-[1.85] text-ink-3">分类和主题仍含示例，LED 目录待配置。日报与热点以实际已有内容为准。</p>
        </div>
      </div>
    </section>
  );
}
