# EssayLens 作文改进 App

EssayLens 是一个 React Native + TypeScript 应用，同一套业务代码面向 Android、iOS 和 HarmonyOS。它把作文照片经过本地 OCR、视觉模型复核、双路差异合并和结构化评分，结果保存到本机 SQLite，并在详情页展示总体评分、五个分项、优缺点、改进建议和原文批注。

## 功能

- 拍照或从相册选择作文图片。
- 本地 OCR 适配器优先识别；没有安装原生本地模型时会明确显示不可用，再使用视觉模型识别。
- 本地 OCR 与视觉 OCR 对照后由模型合并，保留段落和标点并记录差异。
- 加载 `src/assets/scoring-rules.json` 作为评分资源，输出 100 分总评、分项分数、五档结果、优缺点、建议和可定位批注。
- 云端图片识别、文字校对与评分共用设置中的同一个模型，模型需要支持图片输入。本地 OCR 使用设备上的识别组件，无需配置云端模型。
- 使用 OpenAI SDK Responses API，思考级别通过 `reasoning: { effort: "none" | "low" | "high" | "max" }` 传递。关闭对应 `none`，不同模型对级别的支持以服务商为准。
- 上下文大小用于 App 的请求预算，不会扩大模型实际容量，也不会作为不存在的 `model_context_window` 请求参数发送。OpenAI 官方 GPT/o 系列请求传入 `context_management[].compact_threshold`，由上下文大小乘以设置比例计算，同时预留输出和安全余量。
- 压缩仅处理明确传入的历史参考文字。OpenAI 官方服务使用标准 `responses.compact`；DeepSeek 和其他兼容服务使用普通 Responses 请求分段生成历史摘要，不调用专用压缩接口。原生接口不存在时也可回退历史摘要，鉴权错误不会被当作兼容问题忽略。
- 作文原文、图片和评分规则始终完整传递。当前流程的每次请求都是独立任务，通常没有需要压缩的历史；达到阈值而无历史时保持原文，必需内容超出输入预算则明确失败。压缩有收敛检查、轮数及请求数量上限，失败不会覆盖原始记录。
- 文本按 UTF-8 字节数保守估算，图片单独预留预算，不按 Base64 长度计算文本 token。OpenAI 接近阈值时优先使用服务端 token 计数；压缩后的加密内容必须经服务端计数。DeepSeek 的估算不是精确 tokenizer，最终限制仍由服务端校验，超限不会通过静默截断绕过。
- API 地址、API Key、模型名称、思考级别、上下文大小、压缩阈值、输出长度、重试次数均可在系统设置中修改。重试次数为 0 时不重试，默认 1 次。
- 默认 API 地址为 `https://api.deepseek.com`，统一云端模型为 `deepseek-flash`，上下文为 1M（1,000,000 token）。思考默认 `high`，可选 `none`（关闭）、`low`、`high`、`max`。升级时迁移旧默认值和 `medium`，保留自定义主模型并删除旧的独立 OCR 模型配置。
- 重试按每次 SDK 请求计数，关闭 SDK 内置重试以免叠加；只重试临时网络错误、408/409/429 和 5xx。鉴权、参数错误及输出截断会明确失败，不重复发送相同的无效请求。页面展示处理、历史压缩和重试进度，手动重试从未完成的步骤继续。
- 空结果、截断、错误 JSON、无效分数或引用原文不存在句子的批注不会保存为成功结果，不生成替代分数。
- “作文管理”支持逐条选择删除、批量删除，以及按 7/30/90 天清理旧作文；删除会同步处理识别结果、评分批注、流程步骤、日志和图片。
- 系统设置只清理应用日志与临时缓存，不会删除作文、图片、API/模型配置或评分 JSON。

## 本地运行

```sh
npm install
npm start
npm run android
# iOS 需要在 macOS 上先执行 bundle exec pod install
npm run ios
```

HarmonyOS 工程在 `harmony/`，用 DevEco Studio 打开；Metro 配置已经合并 RNOH。首次接入真实本地 OCR 时，实现原生模块 `NativeModules.EssayOcr.recognize(uri)`，返回 `{ text, confidence }` 即可接入现有流程。

## 发布规则

- `.github/workflows/release-android.yml` 只响应 `v*` tag，构建 release APK 并上传到 GitHub Release。
- iOS 与 HarmonyOS 工作流目前使用空触发器并由条件永久跳过，不会因 push、tag、PR 或手动操作发布。后续配置签名和分发凭据后，再启用对应工作流。

```sh
git tag v0.1.0
git push origin v0.1.0
```

API Key 只写入设备本地 SQLite，不会提交到仓库；生产环境建议改为系统安全存储并通过自有服务代理模型请求。
