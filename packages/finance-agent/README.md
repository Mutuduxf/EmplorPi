# Finance Agent

基于 `@earendil-works/agent-base` 构建的便携式桌面金融分析助手。

## 架构

```
Finance Agent.exe (Tauri)
  ├── Rust 后端
  │   ├── Auth (check_auth_state / save_api_key)
  │   ├── Session CRUD (list/delete/rename/export)
  │   ├── File (csv_to_excel / open_data_dir)
  │   ├── Model (switch_model / get_current_model)
  │   ├── Prompt (send_prompt / abort_prompt)
  │   └── Util (get_app_version / get_data_dir_path)
  │
  ├── React 前端 (WebView2)
  │   ├── SetupPage        — 首次启动 API key 配置
  │   ├── ChatPage         — 聊天主界面
  │   │   ├── MenuBar      — File / Help 菜单
  │   │   ├── Sidebar      — 会话列表 + 搜索 + 模型选择 + 主题/语言
  │   │   ├── MessageBubble— Markdown + Thinking 折叠 + Token 用量
  │   │   └── 拖拽文件     — 自动发送文件路径给 agent
  │   ├── ExportDialog     — 会话导出 (txt/md/html)
  │   └── AboutDialog      — 版本信息
  │
  └── agent-sidecar.exe (Bun 编译)
      └── createDomainAgent()
          ├── AuthStorage      → data/auth.json
          ├── ModelRegistry    → 模型发现
          ├── SessionManager   → data/sessions/*.jsonl
          ├── Agent + AgentSession
          ├── Tools: read / grep / write
          └── runRpcMode()    → stdin/stdout JSON-RPC
```

### 数据目录

```
dist/Finance Agent/
├── Finance Agent.exe       (11 MB)  ← Tauri 外壳
├── agent-sidecar.exe       (121 MB) ← Bun agent
└── data/
    ├── auth.json                    ← API 密钥
    ├── debug.log                    ← 调试日志
    └── sessions/
        └── *.jsonl                  ← 会话记录
```

## 构建

### 前置依赖

- [Bun](https://bun.sh) 1.2+
- [Rust](https://rustup.rs) nightly
- [Tauri CLI](https://v2.tauri.app/start/cli/) 2.x
- Windows 10+ (自带 WebView2)

### 构建命令

```powershell
cd packages/finance-agent
.\build.ps1
```

输出到 `dist/Finance Agent/`，完全便携——exe 在哪 data 就在哪。

## 功能清单

### 核心体验

| 功能 | 说明 |
|---|---|
| **多 provider** | Anthropic / OpenAI / Google / DeepSeek / Groq / OpenRouter 等 |
| **API key 配置** | 首次启动引导页 |
| **流式输出** | 实时显示 thinking + 正文 |
| **Markdown 渲染** | 标题、列表、表格、代码块 |
| **代码高亮** | highlight.js 自动识别语言 |
| **Thinking 折叠** | 推理内容可展开/折叠 |
| **Token 用量** | 每条消息底部显示 tokens / cost |

### 会话管理

| 功能 | 说明 |
|---|---|
| **侧边栏** | 260px，显示所有历史会话 |
| **会话搜索** | 按名称实时过滤 |
| **重命名/删除** | 悬停显示 ✎ ✕ |
| **自动滚动** | 新内容滚底，上翻暂停 |
| **深色模式** | 跟随系统 + 手动切换 |
| **中英文** | 界面切换 |

### 消息操作

| 功能 | 说明 |
|---|---|
| **停止生成** | 红色 Stop 按钮 |
| **重新生成** | ↻ 重新生成上一条 |
| **编辑重发** | 点击用户消息 → textarea 编辑 → Enter 发送 |
| **消息分支** | 点击 ↪ 截断后续内容 |

### 文件

| 功能 | 说明 |
|---|---|
| **拖拽文件** | 拖入聊天窗口自动发送路径 |
| **read/grep/write** | agent 可读、搜索、写文件 |
| **CSV → Excel** | `csv_to_excel` 命令转换格式 |
| **导出聊天** | TXT / Markdown / HTML |
| **打开数据目录** | 文件管理器定位 data/ |

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri v2 (Rust) |
| WebView | WebView2 (Windows) |
| 前端 | React 19 + TypeScript + Vite |
| Markdown | marked + highlight.js |
| 图标 | 纯 Unicode/emoji（无外部图标库） |
| Agent 引擎 | @earendil-works/agent-base |
| LLM SDK | @earendil-works/pi-ai |
| 侧边进程 | Bun 编译单二进制 |
| 会话存储 | JSONL 文件 |

## 开发

```powershell
cd packages/finance-agent

# 只编译 sidecar（不启动 UI）
bun build ./src-agent/index.ts --compile --outfile ./src-tauri/binaries/agent-sidecar

# 前端开发（热重载）
npx vite

# 完整构建
.\build.ps1
```
