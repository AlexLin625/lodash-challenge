# Lodash Challenge

一个纯前端的 TypeScript 工具函数挑战站。它在浏览器里提供 Monaco 编辑器、类型检查、自动补全和原始行为测试，不需要服务端运行用户代码。

线上地址：[lodash-quiz.a1exl.in](https://lodash-quiz.a1exl.in)

## 本地开发

需要 Node.js 和 pnpm。

```bash
pnpm install
pnpm dev
```

常用检查：

```bash
pnpm test
pnpm build
pnpm lint
```

挑战数据由 `generator/` 生成：

```bash
pnpm generate
```

## 部署

站点使用 Cloudflare Workers Static Assets：

```bash
pnpm deploy
```

## Credit

网站由 [Alex Lin](mailto:me@a1exlin.cn) 开发。Puzzle 主体源码与测试改编自 [toss/es-toolkit@32f4c8fb](https://github.com/toss/es-toolkit/tree/32f4c8fb33828ad6512064ba84b0fdd8fda966a3)，其源码遵循 MIT License。
