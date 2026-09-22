# ASR 模型准备与离线校验

本说明对应 scripts/prepare-asr.py，版本日期 2026-09-08。模型固定为 Systran/faster-whisper-small，官方仓库 revision 为：

    536b0662742c02347bc0e980a01041f333bce120

model.bin 的预期大小为 **483,546,902 字节**，SHA-256 为：

    3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671

这些是准备与完整性检查基准，不表示已完成真实语音转写质量验收。

## 明确准备

在项目根目录，使用已安装 scripts/asr-requirements.lock.txt 的隔离 Python 环境：

    & .runtime/asr-env/Scripts/python.exe scripts/prepare-asr.py

准备目标默认是 models/faster-whisper-small。脚本只准备 config.json、model.bin、tokenizer.json、vocabulary.txt，所有下载固定到上述 revision。不会采用浮动 main。

正确的 model.bin 通过已知大小和 SHA-256 校验后跳过网络。辅助文件只有在当前版本 manifest 完整匹配，或 Hugging Face 本地元数据为相同 revision 且文件实际内容匹配 ETag 时才直接复用；无法证明出处时只补取需要的小文件。首次下载是显式操作，运行时转写不会自动下载。

已存在但大小或哈希错误的 model.bin 会报告错误并保留，不会静默覆盖。如果目录中已有 model.bin.download 且尚无正确 model.bin，准备会返回 ASR_DOWNLOAD_IN_PROGRESS；应先由原下载任务的操作者完成处理。脚本不擅自重命名、采用或删除外部断点下载文件。

## 严格离线校验

    & .runtime/asr-env/Scripts/python.exe scripts/prepare-asr.py --verify

--verify 只使用 Python 标准库，不导入 huggingface_hub，不创建目录、不写清单、不下载或移动文件。正确完成时输出 ok:true、mode:verify、固定 revision、各文件大小与哈希、networkRequests:0，并以退出码 0 结束；失败输出明确错误代码，退出码为 1。

可通过 --model-dir 指定另一个模型目录。此参数不会改变固定仓库、版本或权重校验基准。

校验要求 xrag-manifest.json 已由明确准备生成，且 manifest 的 schemaVersion、source、revision、runtimeNetwork、文件名集合、大小和哈希全部符合实际文件。刚手工放入模型文件但没有清单时，需先运行明确准备以核验来源并生成清单；不能仅凭文件存在视为已验收。

清单只包含上述四个正式文件，不扫描或收录 .cache、.download、.tmp、其他配置、旧清单及任意嵌套路径。manifest 采用临时文件写入后原子替换；该替换仅针对清单，不触碰 model.bin。

## 常见错误

| 错误代码 | 含义与处理 |
| --- | --- |
| ASR_MODEL_MISSING | 模型或必要普通文件不存在；完成准备后再验 |
| ASR_MODEL_SIZE_MISMATCH | 权重长度不符，可能未下载完成；保留原件并核对下载进度 |
| ASR_MODEL_HASH_MISMATCH | 权重内容不符；核对来源及完整性，不继续转写 |
| ASR_DOWNLOAD_IN_PROGRESS | 外部断点下载文件仍存在，原操作者先完成处理 |
| ASR_MANIFEST_MISSING / ASR_MANIFEST_INVALID | 清单缺失、版本错误或文件集合不合规；明确准备后再验 |
| ASR_MANIFEST_HASH_MISMATCH | 配置或权重与当前清单不一致，不应当作同一已验证部署 |
| ASR_PREPARE_DEPENDENCY_MISSING | 明确下载所需 SDK 未安装；--verify 本身不需要该 SDK |
| ASR_PREPARE_FAILED | 准备发生其他错误；输出不会包含签名下载地址、代理详情或凭据 |

本脚本校验文件完整性与固定版本。Python/模型依赖安装、权重校验、真实转写、专业术语质量、时间轴与浏览器定位应分别验收。离线校验通过不意味着站名、设备编号、金额或否定词已经识别正确。

## 本地回归

    & .runtime/asr-env/Scripts/python.exe scripts/prepare-asr.test.py

测试使用微型临时文件和固定的模拟下载函数，验证无模型错误、固定常量、离线复用、缓存与临时文件排除、权重错误保留、外部下载保护及清单篡改识别。不会下载或移动正式模型，也不调用语音转写。
