import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeCopy, looksZh } from "@aihot/backend/editorial/writing";
import { isChineseBody, exportTranslation } from "@aihot/backend/publication/items";
import { stripTags } from "@aihot/backend/lib/text";

// 合成回归样例，借用公开材料中“性能在前、样品阶段与配置条件在后”的结构，非新闻摘录。
// https://www.mblock.com.tw/en/news/detail/LED_Display_Symposium_LED_Driver_IC
test("finalizing copy preserves later model, availability and configuration conditions", () => {
  const summaryZh = "某器件供应商公布一款驱动芯片的方案，称刷新率可达 15,360 Hz，并介绍这项设计如何服务于更细间距的显示应用，以及与现有控制、供电、模组布线和检测流程衔接时需要核对的工程资料。" +
    "报道还介绍了现场展示的不同方案，涉及画面质量、拍摄效果以及后续验证安排，采购方需要结合实际项目核对适用范围，不能只凭宣传中的一个数字完成器件替换或采购选型。\n" +
    "上述性能仅针对示例型号 D64 的完整 64 扫描配置；供应商预计第四季度提供样品，尚未确认量产供货日期。";
  assert.ok(summaryZh.length > 200, "the old length guard would compact this copy");
  for (const sourceKind of ["rss", "x_search"]) {
    const input = { title: "驱动芯片方案与供货计划", text: summaryZh, mainText: summaryZh, sourceKind };
    const copy = { titleZh: input.title, summaryZh };
    assert.deepEqual(finalizeCopy(input, copy), {
      ...copy,
      identityGuard: { outcome: "pass", unsupportedTitleEntityIds: [], unsupportedSummaryEntityIds: [] },
    });
  }
});

test("finalizing complete copy still rejects a company introduced only in its tail", () => {
  const input = { title: "某实验室公布测试结果", text: "某实验室公布了测试方法和结果，未披露任何合作企业。", sourceKind: "rss" };
  const summaryZh = "某实验室公布测试结果，并介绍测量条件、样品准备、重复实验与结果复核方法。".repeat(6) + "OpenAI 将提供这些样品。";
  assert.ok(summaryZh.indexOf("OpenAI") > 200);
  const result = finalizeCopy(input, { titleZh: input.title, summaryZh });
  assert.equal(result.titleZh, input.title);
  assert.equal(result.summaryZh, "");
  assert.equal(result.identityGuard.outcome, "fallback");
  assert.deepEqual(result.identityGuard.unsupportedSummaryEntityIds, ["openai"]);
});

// Regression coverage for HTML attributes that contain `>` in real source pages.
test("stripTags ignores > inside quoted HTML attributes", () => {
  assert.equal(
    stripTags('<a title="Platforms > Xbox [11,780 articles]" href="/xbox">Xbox</a>'),
    "Xbox",
  );
  assert.equal(stripTags("<a title='Platforms > Xbox' href='/xbox'>A > B</a>"), "A > B");
  assert.equal(stripTags(`<a title = "don't > do" href = '/xbox'>Xbox</a>`), "Xbox");
  assert.equal(stripTags(`<a\ttitle\n=\f"Platforms > Xbox" href='/xbox'>Xbox</a>`), "Xbox");
});

test("stripTags does not pair quotes inside unquoted attribute values", () => {
  assert.equal(stripTags("<a title=don't>Xbox</a><p>next paragraph</p>"), "Xbox next paragraph");
  assert.equal(stripTags("<a title=don't>Xbox</a><p title=it's>next paragraph</p>"), "Xbox next paragraph");
  assert.equal(stripTags(`<a data-note=a='b title="Platforms > Xbox">Xbox</a>`), "Xbox");
});

test("stripTags keeps existing comment handling without swallowing following text", () => {
  for (const comment of ["<!-- note -->", "<!-->", "<!--->", "<!-- note --!>", "<!-- don't -->"]) {
    assert.equal(stripTags(`${comment}<p>visible article</p>`), "visible article");
  }
});

test("stripTags preserves existing spacing, entities, and hidden-content handling", () => {
  assert.equal(stripTags("<p>one</p><p>two</p>"), "one two");
  assert.equal(stripTags("a<br>b"), "a b");
  assert.equal(stripTags("<script>hidden</script><style>hidden</style><noscript>hidden</noscript>visible"), "visible");
  assert.equal(stripTags("&nbsp;&amp; &lt;code&gt; &quot;text&quot; &#39;one&apos;"), '& <code> "text" \'one\'');
});

test("stripTags keeps existing handling of incomplete tags and unclosed attribute quotes", () => {
  assert.equal(stripTags('text <a title="unfinished'), 'text <a title="unfinished');
  assert.equal(stripTags('text <a title="unfinished>visible'), "text");
  assert.equal(stripTags('<a ="unfinished>y">tail'), 'y">tail');
});

// Feeds escape text twice, so a title arrives as "AI&#8217;s leaders" and code as "mtime:&amp;lt;7d":
// character references are text too, and the text meant is what a reader expects.
test("stripTags decodes character references, also when a feed escaped them twice", () => {
  assert.equal(stripTags("AI&#8217;s leaders, AT&#038;T &#x2014; done&#8230;"), "AI’s leaders, AT&T — done…");
  assert.equal(stripTags("AI&amp;#8217;s &amp;lt;7d&gt;"), "AI’s <7d>");
  assert.equal(stripTags("Gemini &mdash; &ldquo;fast&rdquo; &amp;hellip; caf&eacute; 5&times;"), "Gemini — “fast” … café 5×");
  // Only references that end in a semicolon: an address keeps "&copy=" and an unknown name stays as written.
  assert.equal(stripTags("?a=1&copy=2 &unknown; AT&T"), "?a=1&copy=2 &unknown; AT&T");
});

test("writing and public reading agree about Chinese, including Japanese with kanji", () => {
  for (const body_text of ["新しい人工知能モデルを公開しました。", "人工知能 모델을 공개했습니다."]) {
    assert.equal(looksZh(body_text), false);
    for (const language of [null, "ja", "ko"]) {
      assert.equal(isChineseBody({ language, body_text }), false);
      assert.equal(exportTranslation({ language, body_text, tr_html: "<p>发布了新模型。</p>", tr_complete: true }), "<p>发布了新模型。</p>");
    }
  }
  assert.equal(isChineseBody({ language: "ja", body_text: "人工知能研究開発" }), false);
  assert.equal(isChineseBody({ language: null, body_text: "新的人工智能模型发布了。" }), true);
  assert.equal(isChineseBody({ language: "zh-Hans", body_text: "API" }), true);
  assert.equal(isChineseBody({ language: "en", body_text: "An English article quoting 人工智能." }), false);
});
