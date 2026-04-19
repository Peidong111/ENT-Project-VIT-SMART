# Simple Portal Demo

一个基于 Node.js + Express + SQLite 的简单登录示例，支持注册、登录和 Dashboard 页面。

## 功能

- 用户注册（密码哈希存储）
- 用户登录
- Dashboard 页面
- Dashboard 内置 Qwen 对话面板（通过后端代理调用，支持流式输出）
- 预置姿态结构化接口（会话/帧特征/动作样本/风险事件/摘要）
- 串口通信面板（CH340），支持端口扫描、连接、发送、接收日志

## 运行环境

- Node.js 18+

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 配置环境变量（用于 Qwen）

可先复制模板：

```bash
cp .env.example .env
```

```bash
export OPENAI_API_KEY="your_api_key"
# 可选
export OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
export QWEN_MODEL="qwen-plus"
```

请勿将真实 API Key 提交到 GitHub。

3. 启动服务

```bash
npm start
```

默认会在项目根目录创建两个数据库文件：
- `auth.db`：账户与登录
- `pose.db`：姿态与异常上报

可通过环境变量覆盖：
- `AUTH_DB_PATH`
- `POSE_DB_PATH`
- `JSON_BODY_LIMIT`（默认 `2mb`，用于大批量姿态上报）

4. 打开浏览器

```text
http://localhost:4922
```

## 常用命令

- `npm start`：启动服务
- `npm test`：运行测试

## 项目结构

```text
.
├── server.js
├── src/pose/
│   ├── contracts.js
│   ├── repository.js
│   ├── summary.js
│   └── validation.js
├── docs/
│   └── pose-data-contract.md
├── public/
│   ├── index.html
│   └── dashboard.html
├── test/
│   └── auth.test.js
└── package.json
```
