# EssayLens 作文批改 App

EssayLens 是一个 React Native + TypeScript 应用，同一套业务代码面向 Android、iOS 和 HarmonyOS。它把作文照片经过逐页视觉识别、携带原图复核和结构化评分，结果保存到本机 SQLite，并在详情页展示总体评分、五个分项、优缺点、改进建议和原文批注。

## 功能

- 拍照或从相册选择作文图片。
- 支持连续拍摄、多选作文页，逐页进入裁剪界面：拖动四角调整裁剪框、拖动框内移动选区，也可点击“原图”保留整张照片。保存失败留在编辑界面重试；取消导入会清理尚未入库的图片。图片会复制到应用文档目录，避免相机临时文件被系统回收。
- 按上传顺序逐页看图识别，每页完成后保存阶段输出；移除本地 ML Kit OCR，避免不可靠的本地文字混入原文。
- 逐页识别和原图复核都按段首缩进、留白和行间关系还原自然段：段内纸面折行连接，段间空一行，确认跨页续段后才合并。复核说明包含正文段数及不确定的段界；原文页按段落分别展示。保留学生原有错字，不润色原文；无法辨认处标明【辨认不清】。不再使用固定的虚假置信度。
- 中文批改加载 `src/assets/scoring-rules.json`，英文批改加载 `src/assets/english-scoring-rules.json`；两种模式都输出 100 分总评、分项分数、五档结果、优缺点、建议和可定位批注。
- 系统设置中的“评分与批注圆桌评审”可选 0（默认关闭）、3、5 个角色。启用时，将角色数量、会议目的、评审内容、讨论投票要求及最终结果格式加入评分提示词；由大模型在一次任务中自行组织会议并输出最终评分 JSON，App 不分角色调度、计票或主持会议。原有的结果校验、保留上下文纠正和 SDK 重试继续适用。已完成作文可从阶段输出页重新评分与批注。
- 云端图片识别、文字校对与评分共用设置中的同一个模型，模型需要支持图片输入。识别质量依赖照片清晰度与模型的手写视觉能力。
- 使用 OpenAI SDK Responses API，思考级别通过 `reasoning: { effort: "none" | "low" | "high" | "max" }` 传递。关闭对应 `none`，不同模型对级别的支持以服务商为准。
- 上下文大小用于 App 的请求预算，不会扩大模型实际容量，也不会作为不存在的 `model_context_window` 请求参数发送。OpenAI 官方 GPT/o 系列请求传入 `context_management[].compact_threshold`，由上下文大小乘以设置比例计算，同时预留输出和安全余量。
- 压缩仅处理明确传入的历史参考文字。OpenAI 官方服务使用标准 `responses.compact`；DeepSeek 和其他兼容服务使用普通 Responses 请求分段生成历史摘要，不调用专用压缩接口。原生接口不存在时也可回退历史摘要，鉴权错误不会被当作兼容问题忽略。
- 作文原文、图片和评分规则始终完整传递。当前流程的每次请求都是独立任务，通常没有需要压缩的历史；达到阈值而无历史时保持原文，必需内容超出输入预算则明确失败。压缩有收敛检查、轮数及请求数量上限，失败不会覆盖原始记录。
- 文本按 UTF-8 字节数保守估算，图片单独预留预算，不按 Base64 长度计算文本 token。OpenAI 接近阈值时优先使用服务端 token 计数；压缩后的加密内容必须经服务端计数。DeepSeek 的估算不是精确 tokenizer，最终限制仍由服务端校验，超限不会通过静默截断绕过。
- API 地址、API Key、模型名称、思考级别、上下文大小、压缩阈值、输出长度、重试次数均可在系统设置中修改。输出长度可选 4K、8K、16K、32K、64K，默认 32K；重试次数为 0 时不重试，默认 1 次。
- 默认 API 地址为 `https://api.deepseek.com`，统一云端模型为 `deepseek-flash`，上下文为 1M（1,000,000 token）。思考默认 `high`，可选 `none`（关闭）、`low`、`high`、`max`。升级时迁移旧默认值和 `medium`，保留自定义主模型并删除旧的独立 OCR 模型配置。
- 默认不预置 Token；首次使用前请在系统设置中填写你自己的 API Key。密钥只保存在设备本地，不应提交到代码仓库。
- 重试按每次 SDK 请求计数，关闭 SDK 内置重试以免叠加；只重试临时网络错误、408/409/429 和 5xx。鉴权、参数错误及输出截断会明确失败，不重复发送相同的无效请求。页面展示处理、历史压缩和重试进度，手动重试从未完成的步骤继续。
- 空结果、截断、错误 JSON、无效分数或引用原文不存在句子的批注不会保存为成功结果，不生成替代分数。
- “消耗详情”显示本篇作文累计总量、各阶段用量与可展开的逐次调用。每次实际 SDK 请求单独保存，包括多页识别、网络重试、格式纠正、兼容回退、历史摘要/压缩与输入计数；阶段重试追加记录，不覆盖旧消耗。SQLite `model_calls` 保存调用 ID、作文 ID、处理批次、阶段、操作类型、模型、状态、开始/结束时间、耗时、服务端 usage 原始数据和输入/输出/缓存读取/缓存写入/缓存未命中/思考 token。`model_usage_by_stage` 与 `model_usage_by_essay` 视图从明细汇总，避免维护两份累计数。计数接口的测量值单独保存，不加入生成用量。
- 消耗只采用服务端实际返回值；缺失字段存 NULL，显示“未返回”，部分缺失时标出缺失次数，不伪造为 0。缓存读取与思考用量属于输入/输出的分项，不重复加入总 token。缓存未命中与写入量分开：参考 [DeepSeek 缓存说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/) 和 [OpenAI 缓存说明](https://developers.openai.com/api/docs/guides/prompt-caching)。旧版未记录的调用无法补算；应用被关闭时未完成的调用保留为“请求中断”。
- SQLite `score_records` 按每次成功评分保存总分、五项数值、档次、评分时间、模型、圆桌人数、规则版本与完整 JSON，可按时间查询历史；`is_current` 标记当前结果。数字与作文结果在同一条 SQLite 语句的触发器中原子保存。已有作文迁入可核验的分数，旧时间标记为 `legacy_updated_at`，不伪造精确评分时间或原模型。单篇、批量及按时间删除作文时，同步删除调用与评分记录，迟到的模型回复不会重新生成孤立记录；设置中的日志清理不会删除统计。
- “作文管理”支持逐条选择删除、批量删除，以及按 7/30/90 天清理旧作文；删除会同步处理识别结果、评分批注、流程步骤、日志和图片。
- 首页“管理”旁的“报表”默认查看最近一个月，可通过日历或日期输入选择起止日期（本机时区，包含结束日全天）。每篇作文取时段内最后一次成功评分，展示作文篇数、平均/最高/最低总分、可切换总分及五项分数的趋势柱状图，以及五项平均分条形图；点击柱形可查看该次分数并打开作文。报表直接查询 SQLite 历史评分，重试不重复计入，删除作文后同步移除；旧版评分时间缺失时明确标记为当时的保存时间。
- 详情页使用“原文 / 阶段输出 / 评分结果 / 批改 / 消耗详情”五个页卡。原始照片以白色卡片内的大图横向列表展示，位于标题下方、页卡上方，识别前即显示并在切换页卡时保留；点击进入全屏，支持双指缩放、放大后拖动、双击缩放及左右切换照片。原文在复核完成后出现并位于首位；处理时展示阶段输出，成功后自动显示评分结果。标题随最新识别及原图复核结果更新。
- 评分结果以浅色总评开头，接着展示所有分项分数，再展示各项优缺点、改进方法、整体优点、不足和下一步建议。批注要求覆盖标题、英文书信称呼（如有）和每个正文段落，并引用原文定位。
- 批改页本地生成双栏 PDF：左侧按顺序完整展示原文一次，右侧对应段落评价和编号句子批注；亮点用绿色、问题用红色、改进处用棕色字体及下划线标记。标题单独评价，英文书信称呼单独评价，正文从第 1 段编号。页面按两栏内容适配高度并保持正常字号；极长内容分页接续，不重复原文，也不用“前页已展示”代替内容。预览按宽度适配、可滚动缩放，与导出使用相同文件；旧记录打开即可使用新布局。
- PDF 使用 pdf-lib + fontkit 生成，react-native-pdf 预览，react-native-share 导出；三端共用业务代码，鸿蒙对应组件已在工程中手动注册。内置 Noto Sans SC 字体（SIL OFL，许可证在 src/assets/fonts/OFL.txt），无需联网下载字体。字体未覆盖的罕见字符以 Unicode 编号显式保留。PDF 位于应用缓存，可由系统设置清理，删除作文也清除其批改缓存。
- 评分 JSON 不符合规则时，会保留作文、上一轮模型输出和具体校验反馈，自动追加纠正请求并继续生成完整结果；连续多轮仍不合格才保留失败状态，原始输出上下文不丢失。
- 启动时会显示本地数据库准备阶段；若数据库迁移或读取失败，会显示具体错误和“重试启动”，不会继续显示无期限的白屏转圈。
- 系统设置只清理应用日志与临时缓存，不会删除作文、图片、API/模型配置或评分 JSON。

## 本地运行

```sh
npm install
npm start
npm run android
# iOS 需要在 macOS 上先执行 bundle exec pod install
npm run ios
```

当前依赖的 OpenAI Node SDK 要求 Node.js 22 或更高版本。Android 发布工作流会在构建前执行类型检查、无警告 lint 和完整测试。

首页可切换“作文”和“英文作文”两种批改类型。英文评分使用 `src/assets/english-scoring-rules.json` 的英语五项量表；缺少原始命题和可直接核验的卷面时，结果会标记为“待核题、待核原图”的训练预评。英语评分保留分项真实合计，若文字准入条件触发封顶，会单列 `admissionAdjustment`，不会重复扣改分项。

HarmonyOS 工程在 `harmony/`，用 DevEco Studio 打开；Metro 配置已经合并 RNOH。同步 entry 的 HAR 依赖后构建；PDF 预览使用 PDFKit，需具备该能力的 HarmonyOS SDK 和设备。

## 发布规则

- `.github/workflows/release-android.yml` 只响应 `v*` tag，构建 release APK 并上传到 GitHub Release。
- Android 正式包使用本 App 独立的固定签名密钥，别名为 `essaylens-release`。每次构建只从 Actions Secrets 还原同一份密钥，结束后删除临时副本；发布流程不生成新密钥。
- 公共证书指纹保存在 `android/signing/release-certificate.sha256`。缺少密钥、证书不符或 APK 验签失败时停止发布；禁止回退调试签名。本地 release 构建也执行同样的校验。
- 正式密钥应保存在仓库外的私有目录，证书有效期约 100 年。整个目录需要独立备份，尤其是 `.p12` 和密码文件；这些私有文件不提交 Git。当前旧安装包使用调试证书，首次换签不能直接覆盖安装，需先处理本地作文数据。
- iOS 与 HarmonyOS 发布模板保存在 `.github/release-templates/`，不属于 GitHub 活跃工作流，不会触发。模板预设仅 `v*` tag 触发并禁用作业；后续配置签名和分发凭据后，再移入 workflows 并启用。

首次创建一份全新的签名密钥时，在仓库根目录运行以下命令（本机已执行，不要重复生成）：

```sh
bash scripts/create-android-signing.sh
```

需要本机安装 Java 的 `keytool` 和 Python 3。脚本默认保存在 `$HOME/.local/share/essaylens/signing/`（设置了 `XDG_DATA_HOME` 时使用该目录下的 `essaylens/signing/`），目录已存在就停止，避免替换旧密钥。它生成一份 PKCS12 密钥、随机长密码、Base64 文件和 GitHub 配置文件，并自动更新仓库中的公共证书指纹。`password.txt` 同时作为密钥库密码和私钥密码。

在 [writer 的 Actions Secrets 页面](https://github.com/bise86/writer/settings/secrets/actions) 中点击 **New repository secret**（已有同名项则更新），配置：

| Name | Secret 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 私有目录内 `keystore.base64` 的完整文本 |
| `ANDROID_KEYSTORE_PASSWORD` | `password.txt` 的内容，去掉末尾换行 |
| `ANDROID_KEY_ALIAS` | `essaylens-release` |
| `ANDROID_KEY_PASSWORD` | 与 `ANDROID_KEYSTORE_PASSWORD` 相同 |

有 GitHub CLI 且已登录的机器，也可一次导入四项：

```sh
gh secret set --repo bise86/writer --env-file "$HOME/.local/share/essaylens/signing/github-secrets.env"
```

私有目录需要长期保留、备份和复用，不要在每次发布前运行生成命令。配置 Secrets、提交并推送匹配的证书指纹后，再推送版本 tag 触发发布。

```sh
git tag v0.1.0
git push origin v0.1.0
```

系统设置保存在设备本地 SQLite。

PDF 字体来源：[Noto CJK 官方简体中文字体](https://github.com/notofonts/noto-cjk/blob/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf)，通过 FontTools 固定为 400 字重、字形按 4 字节对齐的 TrueType 字体，资源以 Base64 JSON 内置，在打开批改页时延迟加载。可用 scripts/build-pdf-font.py 重建（开发工具需 fonttools 4.60.1）。

安装依赖时自动将鸿蒙 PDF 包中无 JSX 的 `.tsx` 规格文件改为 `.ts`，并去掉本地文件预览不使用的任意 HTTP 头类型、明确浮点字段，兼容 RN 0.77 codegen；鸿蒙分享包的 iOS 自动链接已禁用，避免重复 RNShare pod。
