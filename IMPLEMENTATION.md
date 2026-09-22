# 企业知识库实施约定

本次实施采用 React/Vite + Node.js 24 + SQLite 的单节点可部署架构。真实文件、知识版本、权限、任务、反馈和审计持久化。模型服务可配置；未配置时明确提供原文证据检索，不伪造生成答案。

## API 约定

- 基础路径 `/api`；JSON 成功直接返回对象，错误 `{error:{code,message}}`。
- HttpOnly 会话 Cookie；所有写操作校验 Origin；所有知识访问在服务端校验。
- 用户 `{id,username,name,role:'admin'|'editor'|'viewer',department,active}`。
- `GET /api/setup` -> `{required}`；`POST /api/setup` `{username,name,password}` -> `{user}`；初始化仅限环回地址，可通过环境变量引导。
- `POST /api/auth/login` `{username,password}` -> `{user}`；`GET /api/auth/me` -> `{user}`；`POST /api/auth/logout`；`POST /api/auth/password` `{currentPassword,newPassword}`。
- `GET /api/dashboard` -> `{stats,recentDocuments,tasks,activity,model}`。
- `GET /api/bases` -> `{bases}`；`POST /api/bases` `{name,description,department,visibility:'company'|'department'|'private'}`；`PATCH /api/bases/:id` 同字段及成员。
- 知识库 `{id,name,description,department,visibility,ownerId,documentCount,createdAt}`。
- `GET /api/documents?baseId=&status=&q=` -> `{documents}`。
- 文档 `{id,baseId,title,fileName,mimeType,size,sha256,version,status:'queued'|'processing'|'review'|'published'|'rejected'|'failed'|'archived'|'superseded',stage,progress,error,ownerId,ownerName,department,sensitivity:'internal'|'confidential',createdAt,updatedAt,effectiveAt,expiresAt,chunkCount,pageCount,tags,summary,previousVersionId,revision}`。
- `POST /api/documents` JSON `{fileName,contentBase64,baseId,title,sensitivity,effectiveAt,expiresAt,duplicateAction:'skip'|'version'|'copy',previousVersionId?}` -> `{document,duplicate?}`；最多 25MB/件，前端逐件上传。
- `GET /api/documents/:id` -> `{document,chunks,versions,events}`；chunk `{id,documentId,text,page,heading,ordinal}`；原件 `GET /api/documents/:id/file`。
- `PATCH /api/documents/:id` `{title,summary,tags,effectiveAt,expiresAt,revision,chunks?:[{id,text}]}`；编辑已发布文档须生成待审核版本（后端明确返回新文档）。
- `POST /api/documents/:id/actions` `{action:'publish'|'reject'|'archive'|'retry'|'restore',reason?,revision?}` -> `{document}`。
- `GET /api/search?q=&baseId=&limit=` -> `{results,query,strategy}`；结果 `{id,documentId,title,fileName,baseId,version,text,page,heading,score,matchReason,updatedAt}`。
- `POST /api/chat` `{question,baseId?,conversationId?}` -> `{id,conversationId,answer,mode:'extractive'|'model'|'insufficient',citations:searchResult[],warning?}`；`GET /api/conversations` -> `{conversations}`；`GET /api/conversations/:id` -> `{conversation,messages}`。
- `GET /api/feedback` -> `{feedback}`；`POST /api/feedback` `{messageId?,question,type,comment,documentId?}`；`PATCH /api/feedback/:id` `{status:'open'|'in_progress'|'resolved',resolution}`。
- `GET /api/governance` -> `{issues,stats}`；`GET /api/tasks` -> `{tasks}`；`GET /api/audit` -> `{events}`。
- `GET /api/users` -> `{users}`；`POST /api/users` `{username,name,password,role,department}`；`PATCH /api/users/:id` `{role,department,active,name,password?}`。
- `GET /api/settings` -> `{settings,capabilities}`；`PUT /api/settings` 只保存允许字段；模型 `{provider:'disabled'|'compatible'|'ollama',baseUrl,model,embeddingModel,apiKey?,timeoutMs}`，API 不回显密钥；`POST /api/settings/model/test` 真正测试连接。
- `GET /api/operations` -> `{health,storage,model,metrics,backups}`；`POST /api/operations/backup`；备份只服务端生成，普通用户不可下载。
- `GET /api/connectors` / `POST /api/connectors` / `POST /api/connectors/:id/sync`：管理员允许目录内受控文件夹同步，来源只接受配置白名单根目录。
- `GET /ready.json` 检查数据库和文件存储，失败返回 503。

## 协作文件范围

- 后端代理：`server/api.mjs`、`server/database.mjs`、`server/retrieval.mjs` 及其需要的其他服务器文件（除 parser）。尽快提供完整 API 并与前端对齐。
- 解析代理：`server/parser.mjs` 及解析测试/测试样本，约定 `parseDocument({filePath,fileName,mimeType}) -> {pages:[{page,text,heading?}],warnings:[],parser}`；`chunkPages(pages) -> [{text,page,heading,ordinal}]`。不得执行上传文件中的代码。只做原文解析，不调用外部模型。
- 前端代理：新建 `src/enterprise/*` 及 `src/enterprise/EnterpriseApp.tsx`，不修改旧模块，不改 App.tsx/package.json。完整正式应用入口，覆盖登录初始化、首页、文件接入及详情审核、搜索问答、知识库、治理、反馈、用户、设置、运维。根代理会承接部分管理页面并联调。
- 根代理：入口/构建/部署/启动、API 合约协调、集成回归、安全验证、交付说明。用户模型选择未答复前不创建密钥、不调用付费模型；独立业务能力继续实现。

## 后台数据建设说明

业务数据库、文档数据库和索引是正式部署的建设对象；当前单节点实现与后续建设边界见 [后台数据与文档数据库建设说明](docs/后台数据与文档数据库建设说明.md)。资料源页面不常驻显示服务器允许目录和同步机制说明，相关约束仍由后台执行。
