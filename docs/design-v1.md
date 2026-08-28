# Lodash Challenge 概要设计 v1

状态：Draft，供产品与技术评审  
更新时间：2026-08-28

## 1. 背景与目标

本项目是一个纯前端的编程挑战应用。用户在浏览器中重新实现 Lodash 兼容函数，通过本地测试验证实现，并将草稿、尝试记录和完成进度保存在 IndexedDB 中。

题目主要从 `external/es-toolkit` 的 Lodash 兼容实现和测试中生成。题目生成发生在开发或构建阶段；发布后的应用只消费已经生成的静态题目资产，不依赖后端，也不在用户浏览器中运行题目生成流程。

### 1.1 产品目标

- 提供按函数拆分、可逐题完成的 Lodash 重实现挑战。
- 尽量复用 `es-toolkit` 已有的类型、文档和测试语义。
- 使用 Monaco 提供 TypeScript 编辑体验。
- 在浏览器内执行用户代码和测试。
- 所有用户数据默认留在本地。
- 通过确定性工具生成绝大多数题目，尽量减少 LLM 介入。
- 题目资产可由固定上游版本重复生成和校验。

### 1.2 非目标

- 不建设账号、云同步、排行榜或服务端判题。
- 不提供可信考试环境。
- 不防作弊，不保证测试保密。
- 不防御用户主动攻击执行环境、存储或应用状态。
- 不实现完整 Node.js、Jest 或 Vitest 运行环境。
- 第一版不覆盖 `es-toolkit` 的全部函数。
- 第一版不自动接受所有可解析文件进入公开题库。

## 2. 已确认的仓库基线

- 主仓库当前是 React、TypeScript、Vite 骨架。
- 主仓库尚无首个 Git commit。
- `external/es-toolkit` 是 Git submodule。
- 当前 submodule 版本为 `v1.52.0`。
- 当前 submodule commit 为 `32f4c8fb33828ad6512064ba84b0fdd8fda966a3`。
- 上游源码和测试大多共置，例如 `src/array/chunk.ts` 与 `src/array/chunk.spec.ts`。
- Lodash 兼容题目优先从 `external/es-toolkit/src/compat` 选择。
- 上游单元测试使用 Vitest。
- 上游文档站已有 `Sandpack.vue` 和 `Playground.vue`，可以作为浏览器执行方案的参考。

主仓库在正式建设题目生成流程前应建立 baseline commit。后续所有已发布题目必须显式记录上游 commit，不能使用含义不稳定的“当前版本”。

## 3. 产品和信任边界

### 3.1 数据边界

- 用户源码、草稿、测试记录和完成状态保存在 IndexedDB。
- 正常使用不要求把用户数据发送到远端。
- 静态站点部署只提供应用资源和预生成的题目 bundle。
- 后续若加入进度导入导出，默认采用用户主动下载和选择文件的方式。

### 3.2 信任模型

项目假设用户是可信的本地学习者，不主动防御以下行为：

- 检查或修改静态资源；
- 查看测试文件和运行时消息；
- 修改 IndexedDB 或伪造完成记录；
- 绕过界面直接执行代码；
- 主动消耗资源、访问网络或攻击运行环境；
- 抄袭答案或规避题目流程。

iframe、运行超时、异常捕获和日志数量限制仅用于正常使用中的稳定性，例如处理意外死循环或过量日志，不构成安全边界。

纯前端架构无法真正隐藏测试。产品可以不在默认界面展示某些测试，但不能把它们描述为安全意义上的隐藏测试。

参考实现仍不应进入题目 bundle，原因是避免普通用户无意看到答案、减小产物体积并保持资产边界清晰，而不是为了提供保密或防作弊保证。

## 4. 总体架构

系统分为构建期和运行期两部分。

```text
固定 es-toolkit commit
        │
        ▼
Challenge Generator（开发/构建期）
  ├─ ts-morph 分析源码
  ├─ 确定性清空目标实现
  ├─ 删除辅助函数与无用 import
  ├─ 收集并适配测试
  ├─ TypeScript 与测试校验
  └─ 可选 LLM hint 生成
        │
        ▼
版本化静态 Challenge Bundle
  ├─ manifest
  ├─ starter files
  ├─ readonly dependencies
  ├─ test files
  └─ hints / documentation
        │
        ▼
React Application（运行期）
  ├─ Challenge Catalog
  ├─ Monaco Editor
  ├─ Sandbox Runner
  ├─ Test Result Adapter
  └─ IndexedDB DAO
```

### 4.1 主要模块边界

建议按职责划分以下逻辑模块，实际目录名可在实现阶段调整：

```text
app/            路由、页面装配和全局布局
challenges/     目录、manifest 加载、题目状态投影
editor/         Monaco models、诊断、草稿自动保存
runner/         沙箱生命周期、虚拟文件、测试协议、超时
persistence/    IndexedDB DAO、migration、导入导出
generator/      ts-morph 分析、转换、校验、bundle 输出
generated/      生成的题目目录和静态资产
```

React 组件不直接调用 IndexedDB，不直接拼装 Sandpack 消息，也不理解题目生成细节。上述能力分别由 DAO、Runner 和 Challenge Service 封装。

## 5. Challenge 定义与版本

每道题由人工维护的生成配置和生成后的 manifest 共同定义。

### 5.1 生成配置

```ts
interface ChallengeGenerationConfig {
  id: string;
  sourcePath: string;
  targetExport: string;

  transform: {
    strategy: 'single-function' | 'remove-helpers';
    removableExports?: string[];
    preserveNodes?: string[];
  };

  tests: {
    sourcePaths: string[];
    excludedCases?: string[];
  };

  hints: {
    mode: 'none' | 'documentation' | 'llm-assisted';
    maxLevel: 1 | 2 | 3;
  };

  overrides?: {
    returnType?: string;
    timeoutMs?: number;
    unsupportedReason?: string;
  };
}
```

自动发现只负责产生候选清单。第一版公开题库使用 allowlist，避免“能够转换”被误认为“适合教学”。

### 5.2 生成后的 manifest

```ts
interface ChallengeManifest {
  id: string;
  slug: string;
  title: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';

  upstream: {
    repository: 'toss/es-toolkit';
    commit: string;
    sourcePath: string;
    testPaths: string[];
  };

  generatorVersion: string;
  challengeVersion: string;
  targetExport: string;

  entryFile: string;
  editableFiles: string[];
  readonlyFiles: string[];

  description: string;
  hints: ChallengeHint[];

  runtime: {
    timeoutMs: number;
    testAdapter: 'jest-subset-v1';
    capabilities: string[];
  };

  integrity: {
    starterHash: string;
    testsHash: string;
    manifestHash: string;
  };
}
```

`challengeVersion` 至少由以下内容确定：

```text
upstream commit
+ generator version
+ generation config hash
+ starter files hash
+ tests hash
```

文案或 hint 的调整是否产生新的 `challengeVersion`，在实现前需要最终决定。默认建议：不影响代码语义的文案变更不使用户的完成状态失效，但应有独立的内容版本。

## 6. 两级题目生成流水线

题目生成以 ts-morph 的确定性 AST 转换为主，LLM 只作为可选增强。

### 6.1 第一级：源码分析与分类

Generator 使用 ts-morph 逐个解析 allowlist 中的源码文件，根据 manifest 的 `targetExport` 定位目标实现，并生成结构化分析结果。

```ts
interface SourceAnalysis {
  sourcePath: string;
  targetExport: string;
  runtimeFunctions: FunctionInfo[];
  typeDeclarations: string[];
  imports: ImportInfo[];
  classification:
    | 'single-function'
    | 'function-with-helpers'
    | 'unsupported';
  unsupportedReasons: string[];
}
```

目标函数不能按文件中的第一个函数推断，必须由配置指定并由 export 关系确认。

#### A. 仅有一个目标 runtime function

满足支持条件时：

1. 保留 JSDoc、export、函数名、泛型、参数和返回类型。
2. 清空原函数体。
3. 对每个可引用参数生成 `void` 表达式。
4. 对非 `void` 返回类型生成只为保持编译通过的占位返回值。

转换结果的语义示例：

```ts
export function example<T>(input: T, count: number): T[] {
  void input;
  void count;
  return undefined as unknown as T[];
}
```

这里复用的是函数签名中的原始返回类型，不生成 `ReturnType<typeof example>`。

参数处理规则：

- 普通、rest 和带默认值的标识符参数：生成 `void parameter`；
- destructuring 参数：对其中每个 binding identifier 生成 `void`；
- TypeScript `this` 参数：跳过；
- `void` 返回函数不生成占位 return。

以下情况默认进入 `unsupported`，除非有明确 override 或后续专用转换器：

- 无法安全固定返回类型；
- 复杂 overload；
- generator 或 async generator；
- class method；
- 依赖 decorator 或特殊 emit 行为；
- 转换后无法保持原公开签名。

#### B. 目标函数之外还有 runtime helper

对于 `function-with-helpers`：

1. 按上述规则清空目标函数体。
2. 删除非目标的私有 runtime helper。
3. 删除仅被这些 helper 使用的 value import。
4. 保留目标签名引用的类型、interface、type alias、enum 和 type import。
5. 保留参数默认值、decorator 或必要顶层初始化仍然引用的声明。
6. 对转换后的源码重新执行类型检查和引用检查。

需要识别的 helper 至少包括：

- function declaration；
- 绑定 arrow function 的变量；
- 绑定 function expression 的变量。

如果一个文件包含多个公共导出函数，默认不得把其他公共函数当作 helper 删除。此类文件进入 `unsupported`；只有 manifest 明确列入 `removableExports` 的导出才允许删除。

### 6.2 第二级：LLM 可选增强

LLM 不负责主要源码转换，也不在普通构建中临时生成 patch。它只处理确定性工具不擅长的教学内容或异常分析。

允许的职责：

- 根据文档、签名和已删除 helper 的职责生成渐进式 hint；
- 把较长的 JSDoc 整理成更适合挑战页面的说明；
- 提醒边界条件或合适的数据结构；
- 为 `unsupported` 文件生成供维护者评审的转换建议。

禁止的职责：

- 修改测试预期；
- 决定测试是否通过；
- 生成或修改主要 starter patch；
- 把参考实现直接改写进 hint；
- 自动批准题目进入公开目录。

建议的 hint 数据结构：

```ts
interface ChallengeHint {
  level: 1 | 2 | 3;
  text: string;
  source: 'documentation' | 'helper-analysis' | 'manual';
}
```

- Level 1：提醒输入约束或边界条件。
- Level 2：提示适合的数据结构或关键观察。
- Level 3：提示解题分解步骤，但不提供完整实现。

### 6.3 完整生成数据流

```text
读取固定 upstream commit
  → 扫描 allowlist
  → ts-morph AST 分析
  → 分类 single-function / function-with-helpers / unsupported
  → 确定性转换
  → 清理 import 与依赖闭包
  → 格式化
  → TypeScript 校验
  → 测试适配与验证
  → 可选 LLM hint
  → 计算 hashes 和 challengeVersion
  → 输出静态 challenge bundle 和 catalog
```

相同 upstream commit、生成配置、generator version 和测试输入必须产生字节级稳定或经过规范化后 hash 稳定的结果。

## 7. 生成校验规则

每道题进入公开 catalog 前至少满足：

1. `targetExport` 存在且唯一。
2. 转换后目标 export、泛型、参数和返回类型与上游一致。
3. 原目标函数体已经移除。
4. 配置要求删除的 helper 已不存在。
5. 不存在对已删除 helper 的未解析引用。
6. 不存在由转换产生的无效 value import。
7. starter 能通过 TypeScript 编译。
8. starter 至少有一个行为测试失败，防止生成空题或无效测试。
9. 对同一套测试，原始 upstream 实现全部通过。
10. 所选测试可以在目标浏览器 runtime 中执行。
11. 生成产物不包含目标函数原实现。
12. 相同输入能够稳定重建相同题目版本。

第 11 条是资产正确性和体验校验，不是安全或保密保证。

## 8. 浏览器编辑、执行与测试

### 8.1 编辑器

使用 Monaco 管理用户可编辑文件和只读依赖文件。

第一版依赖 Monaco 自带的 TypeScript language service 能力，提供：

- 语法高亮；
- 基础补全；
- 类型诊断；
- 多虚拟文件模型；
- 跳转与悬浮信息。

第一版不额外部署独立 TypeScript LSP 服务。

### 8.2 执行环境

建议采用 Monaco + Sandpack runtime：

- Monaco 负责编辑体验；
- Sandpack 负责虚拟文件编译、模块装载和 iframe runtime；
- 不使用 Sandpack 自带编辑器作为主编辑器；
- 每次运行向 runtime 提供当前用户文件、只读依赖和测试入口。

上游已有 Sandpack playground，可以优先验证并复用其依赖配置与浏览器兼容经验。

WebContainers 暂不作为 MVP 默认方案，因为对于本项目的文件规模和测试需求偏重，并可能增加部署 header、启动成本和浏览器兼容约束。如果后续确实需要接近 Node 的包管理和测试行为，再单独评估。

### 8.3 测试 API

上游测试使用 Vitest，但产品对用户展示和内部适配采用 Jest 风格 API 子集。第一版不承诺完整 Jest runtime。

计划支持：

- `describe`；
- `it` / `test`；
- `expect` 和常用 matcher；
- Promise/async test；
- `beforeEach` / `afterEach`；
- 基础 mock function，例如 `fn`。

暂不支持：

- Node filesystem、process 和原生模块；
- snapshot 文件写入；
- 完整 module mocking 和 hoisting；
- worker threads；
- 完整 fake timers；
- 依赖 Node module resolution 的测试。

生成器负责把选定的上游 Vitest import 适配到内部测试 runtime。无法可靠适配的测试或题目不进入 MVP。

### 8.4 测试结果协议

Runner 对 UI 返回结构化结果：

```ts
interface TestRunResult {
  runId: string;
  status: 'passed' | 'failed' | 'timeout' | 'runtime-error';
  durationMs: number;
  tests: TestCaseResult[];
  console: ConsoleEntry[];
}
```

iframe/runtime 与主应用通过受控消息协议通信。协议约束是为了降低模块耦合和稳定展示结果，不作为对抗恶意用户的安全措施。

### 8.5 运行稳定性

- 每次运行使用可重建的 runtime 实例。
- 正常题目配置运行超时；同步死循环时允许销毁并重建整个 runtime。
- 捕获编译错误、运行错误和测试失败，并分别展示。
- 限制 UI 保存和显示的 console 条目数量。
- runtime 故障不应损坏已经保存在 IndexedDB 中的草稿。

## 9. IndexedDB DAO

数据库暂定名为 `lodash-challenge`。所有 IndexedDB 访问通过 DAO 完成，UI 组件不能直接操作 object store。

### 9.1 `solutions`

主键：`[challengeId, challengeVersion]`

```ts
interface SolutionRecord {
  challengeId: string;
  challengeVersion: string;
  files: Record<string, string>;
  starterHash: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  runCount: number;
  lastResult?: 'passed' | 'failed' | 'timeout' | 'runtime-error';
}
```

### 9.2 `completions`

```ts
interface CompletionRecord {
  challengeId: string;
  challengeVersion: string;
  firstPassedAt: number;
  lastPassedAt: number;
  bestDurationMs: number;
  passingSourceHash: string;
  attemptCountAtFirstPass: number;
}
```

完成记录只表达本地学习进度，不是防篡改凭证。

### 9.3 `attempts`

```ts
interface AttemptRecord {
  id: string;
  challengeId: string;
  challengeVersion: string;
  startedAt: number;
  durationMs: number;
  result: 'passed' | 'failed' | 'timeout' | 'runtime-error';
  passedTests: number;
  totalTests: number;
  sourceHash: string;
}
```

默认只保留每道题最近有限次数的尝试记录，例如最近 20 次。每次尝试不重复保存完整源码，最新源码由 `solutions` 保存。

### 9.4 `preferences`

保存不影响题目语义的本地偏好，例如：

- Monaco theme；
- 字号；
- 面板布局；
- 最近打开的题目；
- 自动保存设置。

### 9.5 DAO 接口

```ts
interface ProgressDAO {
  getSolution(key: ChallengeKey): Promise<SolutionRecord | null>;
  saveDraft(input: SaveDraftInput): Promise<void>;
  recordAttempt(input: AttemptInput): Promise<void>;
  markCompleted(input: CompletionInput): Promise<void>;
  getProgressSummary(): Promise<ProgressSummary>;
  resetChallenge(key: ChallengeKey): Promise<void>;
  exportAll(): Promise<ProgressExport>;
  importAll(data: ProgressExport): Promise<ImportResult>;
}
```

DAO 负责：

- schema version 和 migration；
- 写事务；
- 每题尝试记录裁剪；
- 导入数据的基础结构校验；
- 将存储错误转换为领域错误。

编辑器草稿采用 debounce 保存。IndexedDB 暂时不可用时，应提示用户，但不阻止当前会话继续编辑和运行。

## 10. 应用运行数据流

```text
用户打开题目
  → Challenge Service 加载 manifest 和静态 bundle
  → DAO 按 challengeId + challengeVersion 查询草稿
  → 恢复草稿，或加载 starter files
  → Monaco 注册可编辑和只读 models
  → 用户编辑，debounce 保存草稿
  → 用户点击 Run
  → Runner 组装虚拟文件和测试入口
  → Sandpack 编译并在 runtime 中执行
  → Test Adapter 返回结构化结果
  → DAO 写入 attempt
  → 全部通过时写入 completion
  → UI 更新测试面板和目录完成状态
```

当题目版本变化时，旧版本草稿和完成记录保留，但默认不自动标记新版本完成。UI 可以提供查看旧答案或复制到新版本的迁移入口。

## 11. MVP 范围

第一阶段建议提供 20–30 道人工精选题目，优先选择：

- `src/compat/array`；
- `src/compat/string`；
- `src/compat/math`；
- 简单的 `src/compat/object`；
- 简单的 `src/compat/predicate`。

候选题标准：

- 单目标文件或依赖闭包很小；
- 目标 export 明确；
- 无 Node 专属 API；
- 无复杂 timer 或 module mock；
- 测试执行时间短且结果稳定；
- JSDoc、签名和测试足以表达需求；
- 自动转换结果容易审查。

MVP 暂缓：

- `server`；
- 纯类型体操题；
- `fp` 组合层；
- 复杂 `debounce` / `throttle`；
- 高度依赖 `_internal` 的函数；
- 随机数、时间或平台敏感测试；
- 上游发布包校验和 browser-compat 全套测试；
- benchmark 和性能评分；
- 多文件自由编辑挑战。

### 11.1 MVP 验收条件

- 至少 20 道题能在支持的桌面浏览器稳定加载和运行。
- Monaco 能显示源码、只读依赖和 TypeScript 诊断。
- 测试通过、测试失败、编译错误、运行错误和超时能分别展示。
- 刷新页面后草稿和完成进度仍然存在。
- 题目进度与 `challengeVersion` 正确绑定。
- 固定输入可以重建相同的题目资产。
- 生产题目 bundle 不包含目标参考实现。
- 应用没有业务后端依赖。

## 12. 分期建议

### Phase 0：基线和技术验证

- 建立主仓库 baseline commit。
- 固定 submodule commit。
- 验证 Monaco 与 Sandpack runtime 的最小组合。
- 验证一个同步函数和一个 async 函数的测试协议。
- 确认静态部署所需配置。

### Phase 1：确定性 Generator

- 引入 ts-morph 作为 devDependency。
- 建立 allowlist、分析结果和 unsupported 报告。
- 实现 single-function 转换。
- 实现 helper 删除和 import 清理。
- 建立类型检查、测试检查、hash 和稳定性检查。
- 生成首批少量题目 bundle。

### Phase 2：学习工作台

- 接入 Challenge Catalog。
- 接入 Monaco 多文件模型。
- 实现 Runner 与测试结果面板。
- 完成 DAO、自动保存和完成记录。
- 扩充到 MVP 题目数量。

### Phase 3：内容与可用性

- 加入分级 hint。
- 对复杂题启用可选 LLM hint 生成。
- 加入进度导入导出。
- 优化首次加载、runtime 重建和错误展示。

## 13. 主要风险

本项目不把恶意用户和作弊列为风险。需要管理的是工程与教学质量风险：

1. AST 转换后源码无法编译，或公开签名发生变化。
2. helper 识别不完整，或错误删除公共声明。
3. 未使用 import 清理影响类型或副作用语义。
4. 上游测试依赖 Vitest/Node 能力，无法在浏览器测试子集中运行。
5. 用户无意写出的同步死循环导致一次 runtime 卡住。
6. Sandpack 初始化、编译或依赖加载速度影响体验。
7. 上游升级导致题目版本变化，旧进度不能直接复用。
8. IndexedDB 被浏览器清理、隐私模式限制或配额错误导致进度丢失。
9. 自动生成的题目虽然技术上可运行，但缺乏教学价值。
10. LLM hint 提示过多，接近直接泄露答案。
11. Generator override 逐渐膨胀为难以维护的第二套转换语言。

应通过 allowlist、unsupported 报告、生成校验、人工题目评审和少量显式 override 控制这些风险。

## 14. 待确认事项

以下事项留待下一轮评审：

1. 第一批题目的具体 allowlist 和难度分级。
2. Jest-compatible subset 的 matcher 清单。
3. 测试是否区分默认展示与默认不展示；两者都不提供保密保证。
4. 文档和 hint 变化是否影响 `challengeVersion`，或使用独立内容版本。
5. `attempts` 默认保留次数及 IndexedDB 配额策略。
6. 是否在 MVP 中提供 JSON 导入导出。
7. 对 async function、overload 和多公共导出文件的首批支持边界。
8. unsupported 文件是直接跳过，还是允许少量人工 starter fixture。
9. Sandpack runtime 验证失败时的备选执行方案。

## 15. 设计结论

第一版采用“固定上游版本、ts-morph 确定性生成、LLM 可选增强、静态题目 bundle、Monaco 编辑、Sandpack 浏览器执行、Jest 风格测试子集、IndexedDB DAO”的整体方案。

题目生成是可复现的构建流程，不依赖每次运行时调用 agent。LLM 只补充教学 hint 和异常分析。运行期保持纯前端和本地数据模型，并明确不建立防攻击、防作弊或可信判题能力。
