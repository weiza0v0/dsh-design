/**
 * dsh-design-prompt —— 设计宪章**内容模块**（不是插件）
 *
 * 只做一件事：把 `content/*.md` 按固定顺序拼成一份可注入的正文，导出为
 * `composed`。消费者是 `dsh-design-stance` —— 它把这个字符串交给自己的
 * `text()` 函数，只在设计人格生效时才注入。
 *
 * ## 为什么这里**没有** apply()（曾经有，是个地雷）
 *
 * 早期版本把自己做成插件，注册一个 `complete: true` 的 section：
 *
 *     ctx.systemPrompt.section({ name:'design:composite', complete:true, text:()=>COMPOSED })
 *
 * `complete` 的语义是「把这一份当作**完整**的系统提示」，于是它会挤掉所有其它
 * section —— 包括工具指引。而当时防住这件事的手段，只是三份 README 里各写一句
 * 「别挂载这个包」。
 *
 * **把「别做 X」写成文档是最弱的护栏**：总有人不读，而且读了也不会在装错时收到
 * 任何信号。真正的问题是这个包**不需要**成为插件 —— 它只被 `import { composed }`
 * 消费。所以 `apply()` 被删掉了，`inject` 也一并去掉：模块现在没有任何副作用，
 * 装错也伤不到人。
 *
 * 对照参考：DSH 的 plan mode（`@deepseek-ai/dsh-plan-mode`）用的是
 * 「section 常驻 + `text()` 返回空串」的写法。本仓库的 `dsh-design-stance`
 * 就是照它做的 —— 切换只翻一个 flag，不增删 section，也就不用 `complete`。
 *
 * ## 内容从哪来（全部 OpenDesign, Apache-2.0）
 *
 *   · 00-discovery      ← OD 的 discovery / planning 层（含五维 critique）
 *   · 01-charter        ← official-system.ts 的 OFFICIAL_DESIGNER_PROMPT
 *   · 02-directions     ← directions.ts 的方向库（方向 + OKLch 色板 + 字体栈）
 *   · 03/04/05-craft    ← craft/{typography,color,anti-ai-slop}.md
 *   · 06-deck-framework ← contracts 的 renderDeckFrameworkDirective('filesystem')
 *   · 07-resources      ← 本仓库自撰：两道门 + 可用素材索引
 *
 * 逐文件出处与许可见仓库根的 `THIRD-PARTY-NOTICES.md`。
 *
 * 断言在模块加载时完成：缺文件/空文件立刻抛，不让拼不完整的宪章上线。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仅供识别；本模块不是插件，没有 apply()。 */
export const name = 'dsh-design-prompt';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(here, 'content');

/** 注入顺序即数组顺序；文件名前缀即顺序。 */
const ORDER = [
  // discovery 自称「先读 —— 与后面冲突时以本节为准」，所以排在最前
  '00-discovery.md',
  '01-charter.md',
  '02-directions.md',
  '03-craft-typography.md',
  '04-craft-color.md',
  '05-craft-anti-ai-slop.md',
  '06-deck-framework.md',
  '07-resources.md',
];

/** 分隔符与 OpenDesign 的 composer 一致 */
const SEPARATOR = '\n\n---\n\n';

function loadContent() {
  const parts = [];
  for (const file of ORDER) {
    const full = path.join(CONTENT_DIR, file);
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch (error) {
      throw new Error(`dsh-design-prompt: 内容缺失 ${file} —— ${error.message}`);
    }
    if (text.trim() === '') throw new Error(`dsh-design-prompt: 内容为空 ${file}`);
    parts.push(text.trim());
  }
  return parts;
}

const PARTS = loadContent();
const COMPOSED = PARTS.join(SEPARATOR);

/**
 * 组装好的完整正文。
 *
 * 导出它是为了让 `dsh-design-stance` 复用**同一份内容** ——
 * 否则宪章就有了两个副本，改一处忘一处。
 */
export const composed = COMPOSED;

/** 供测试/调试读取：各部分字节数 */
export const meta = {
  parts: ORDER.map((file, i) => ({ file, bytes: Buffer.byteLength(PARTS[i], 'utf8') })),
  totalBytes: Buffer.byteLength(COMPOSED, 'utf8'),
  separator: SEPARATOR,
};
