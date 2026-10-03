# EssayLens 作文改进 App

EssayLens 是一个 React Native + TypeScript 应用，同一套业务代码面向 Android、iOS 和 HarmonyOS。它把作文照片经过本地 OCR、视觉模型复核、双路差异合并和结构化评分，结果保存到本机 SQLite，并在详情页展示总体评分、五个分项、优缺点、改进建议和原文批注。

## 功能

- 拍照或从相册选择作文图片。
- 本地 OCR 适配器优先识别；没有安装原生本地模型时会明确显示不可用，再使用视觉模型识别。
- 本地 OCR 与视觉 OCR 对照后由模型合并，保留段落和标点并记录差异。
- 加载 `src/assets/scoring-rules.json` 作为评分资源，输出 100 分总评、分项分数、五档结果、优缺点、建议和可定位批注。
- 使用 OpenAI SDK Responses API；输入估算超过设置阈值时调用 Responses compact，再执行评分或 OCR 请求。
- API 地址、API Key、模型名称、思考级别、上下文大小、压缩阈值、输出长度、重试次数均可在系统设置中修改。重试次数为 0 时不重试，默认 1 次。
- 每个流程步骤都持久化状态，失败后可以从详情页重试。
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
