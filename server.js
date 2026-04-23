require("dotenv").config();
const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("node:crypto");
const {
  initPoseTables,
  createPoseSession,
  getPoseSession,
  getLatestPoseSession,
  appendFrameFeatures,
  appendActionSamples,
  appendRiskEvents,
  closePoseSession,
  upsertPoseSummary,
  getPoseSummary
} = require("./src/pose/repository");
const {
  validateCreateSession,
  validateFrameFeatures,
  validateActionSamples,
  validateRiskEvents
} = require("./src/pose/validation");
const { buildSessionSummaryForLlm } = require("./src/pose/summary");
const { SerialService, DEFAULT_BAUD_RATE } = require("./src/serial/service");

const DEFAULT_PORT = 4922;
const DEFAULT_AUTH_DB_PATH = "auth.db";
const DEFAULT_POSE_DB_PATH = "pose.db";
const DEFAULT_BCRYPT_ROUNDS = 10;
const DEFAULT_OPENAI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_QWEN_MODEL = "qwen-plus";
const DEFAULT_JSON_BODY_LIMIT = "2mb";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateCredentials(rawEmail, rawPassword) {
  const email = normalizeEmail(rawEmail);
  const password = String(rawPassword || "").trim();

  if (!email || !password) {
    return { ok: false, status: 400, message: "Email and password are required." };
  }

  if (!isValidEmail(email)) {
    return { ok: false, status: 400, message: "Please provide a valid email address." };
  }

  if (password.length < 8) {
    return { ok: false, status: 400, message: "Password must be at least 8 characters." };
  }

  return { ok: true, email, password };
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

async function requestQwenChat({
  apiKey,
  baseUrl,
  model,
  message,
  messages,
  timeoutMs = 30000
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const finalMessages = Array.isArray(messages) && messages.length
      ? messages
      : [{ role: "user", content: message }];

    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: finalMessages,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = result?.error?.message || result?.message || "Provider request failed.";
      throw new Error(detail);
    }

    const content = result?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Provider response did not include message content.");
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function extractSseDataLines(chunkBuffer, onLine) {
  let start = 0;
  let newlineIndex = chunkBuffer.indexOf("\n", start);
  while (newlineIndex !== -1) {
    const rawLine = chunkBuffer.slice(start, newlineIndex);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    onLine(line);
    start = newlineIndex + 1;
    newlineIndex = chunkBuffer.indexOf("\n", start);
  }
  return chunkBuffer.slice(start);
}

async function streamQwenChat({
  apiKey,
  baseUrl,
  model,
  message,
  messages,
  onToken,
  timeoutMs = 60000
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const finalMessages = Array.isArray(messages) && messages.length
      ? messages
      : [{ role: "user", content: message }];

    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: finalMessages,
        temperature: 0.7,
        stream: true
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      const detail = result?.error?.message || result?.message || "Provider request failed.";
      throw new Error(detail);
    }

    if (!response.body) {
      throw new Error("Provider did not return a stream body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = extractSseDataLines(buffer, (line) => {
        if (!line.startsWith("data:")) {
          return;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          return;
        }

        let data;
        try {
          data = JSON.parse(payload);
        } catch (_error) {
          return;
        }

        const delta = data?.choices?.[0]?.delta?.content;
        if (delta) {
          onToken(delta);
        }
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function createApp(options = {}) {
  const legacyDbPath = options.dbPath ?? process.env.DB_PATH ?? null;
  const authDbPath = options.authDbPath ?? process.env.AUTH_DB_PATH ?? legacyDbPath ?? DEFAULT_AUTH_DB_PATH;
  const poseDbPath = options.poseDbPath ?? process.env.POSE_DB_PATH ?? legacyDbPath ?? DEFAULT_POSE_DB_PATH;
  const bcryptRounds = Number(options.bcryptRounds ?? process.env.BCRYPT_ROUNDS ?? DEFAULT_BCRYPT_ROUNDS);
  const jsonBodyLimit = options.jsonBodyLimit ?? process.env.JSON_BODY_LIMIT ?? DEFAULT_JSON_BODY_LIMIT;
  const app = express();
  const authDb = new Database(authDbPath);
  const poseDb = new Database(poseDbPath);
  const serialService = options.serialService || new SerialService();

  authDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  initPoseTables(poseDb);

  app.locals.authDb = authDb;
  app.locals.poseDb = poseDb;
  app.locals.serialService = serialService;
  app.locals.bcryptRounds = Number.isFinite(bcryptRounds) && bcryptRounds >= 8 ? Math.floor(bcryptRounds) : DEFAULT_BCRYPT_ROUNDS;

  app.disable("x-powered-by");
  app.use(express.json({ limit: jsonBodyLimit }));

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

  app.post("/register", (req, res) => {
    const validation = validateCredentials(req.body?.email, req.body?.password);

    if (!validation.ok) {
      return res.status(validation.status).json({ success: false, message: validation.message });
    }

    const passwordHash = bcrypt.hashSync(validation.password, app.locals.bcryptRounds);

    try {
      const statement = authDb.prepare(`
        INSERT INTO users (email, password)
        VALUES (?, ?)
      `);

      statement.run(validation.email, passwordHash);

      return res.json({ success: true, message: "Registration successful." });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        return res.status(409).json({ success: false, message: "This email is already registered." });
      }

      return res.status(500).json({ success: false, message: "Server error." });
    }
  });

  app.post("/login", (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "").trim();

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const statement = authDb.prepare(`
      SELECT id, email, password
      FROM users
      WHERE email = ?
    `);

    const user = statement.get(email);
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    let isValidPassword = false;

    if (isBcryptHash(user.password)) {
      isValidPassword = bcrypt.compareSync(password, user.password);
    } else {
      // Compatibility path for legacy plaintext records: validate once, then upgrade to hash.
      isValidPassword = user.password === password;
      if (isValidPassword) {
        const upgradedHash = bcrypt.hashSync(password, app.locals.bcryptRounds);
        authDb.prepare("UPDATE users SET password = ? WHERE id = ?").run(upgradedHash, user.id);
      }
    }

    if (!isValidPassword) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    return res.json({ success: true, message: "Login successful.", email: user.email });
  });

  app.post("/api/qwen-chat", async (req, res) => {
    const message = String(req.body?.message || "").trim();
    const context = String(req.body?.context || "").trim();
    if (!message) {
      return res.status(400).json({ success: false, message: "Message is required." });
    }
    if (message.length > 4000) {
      return res.status(400).json({ success: false, message: "Message is too long (max 4000 chars)." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL;
    const model = process.env.QWEN_MODEL || DEFAULT_QWEN_MODEL;

    if (!apiKey) {
      return res.status(503).json({
        success: false,
        message: "OPENAI_API_KEY is not configured on the server."
      });
    }

    const messages = [];
    if (context) {
      messages.push({
        role: "system",
        content: `Additional context from recent pose analysis:\n${context}`
      });
    }
    messages.push({ role: "user", content: message });

    try {
      const reply = await requestQwenChat({ apiKey, baseUrl, model, messages, message });
      return res.json({ success: true, reply, model });
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: `Qwen request failed: ${error.message}`
      });
    }
  });

  app.post("/api/qwen-chat-stream", async (req, res) => {
    const message = String(req.body?.message || "").trim();
    const context = String(req.body?.context || "").trim();
    if (!message) {
      return res.status(400).json({ success: false, message: "Message is required." });
    }
    if (message.length > 4000) {
      return res.status(400).json({ success: false, message: "Message is too long (max 4000 chars)." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL;
    const model = process.env.QWEN_MODEL || DEFAULT_QWEN_MODEL;

    if (!apiKey) {
      return res.status(503).json({
        success: false,
        message: "OPENAI_API_KEY is not configured on the server."
      });
    }

    const messages = [];
    if (context) {
      messages.push({
        role: "system",
        content: `Additional context from recent pose analysis:\n${context}`
      });
    }
    messages.push({ role: "user", content: message });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      await streamQwenChat({
        apiKey,
        baseUrl,
        model,
        messages,
        message,
        onToken: (token) => {
          res.write(token);
        }
      });
      return res.end();
    } catch (error) {
      if (!res.headersSent) {
        return res.status(502).json({
          success: false,
          message: `Qwen stream failed: ${error.message}`
        });
      }
      res.write(`\n\n[stream_error] ${error.message}`);
      return res.end();
    }
  });

  app.post("/api/pose/sessions", (req, res) => {
    const validation = validateCreateSession(req.body);
    if (!validation.ok) {
      return res.status(validation.status).json({ success: false, message: validation.message });
    }

    const created = createPoseSession(poseDb, {
      id: randomUUID(),
      ...validation.value
    });
    return res.status(201).json({ success: true, session: created });
  });

  app.post("/api/pose/sessions/:sessionId/frames", (req, res) => {
    const { sessionId } = req.params;
    const session = getPoseSession(poseDb, sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Pose session not found." });
    }

    const validation = validateFrameFeatures(req.body);
    if (!validation.ok) {
      return res.status(validation.status).json({ success: false, message: validation.message });
    }

    appendFrameFeatures(poseDb, sessionId, validation.value.frames);
    return res.json({ success: true, ingested: validation.value.frames.length });
  });

  app.post("/api/pose/sessions/:sessionId/events", (req, res) => {
    const { sessionId } = req.params;
    const session = getPoseSession(poseDb, sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Pose session not found." });
    }

    const validation = validateRiskEvents(req.body);
    if (!validation.ok) {
      return res.status(validation.status).json({ success: false, message: validation.message });
    }

    appendRiskEvents(poseDb, sessionId, validation.value.events);
    return res.json({ success: true, ingested: validation.value.events.length });
  });

  app.post("/api/pose/sessions/:sessionId/actions", (req, res) => {
    const { sessionId } = req.params;
    const session = getPoseSession(poseDb, sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Pose session not found." });
    }

    const validation = validateActionSamples(req.body);
    if (!validation.ok) {
      return res.status(validation.status).json({ success: false, message: validation.message });
    }

    appendActionSamples(poseDb, sessionId, validation.value.samples);
    return res.json({ success: true, ingested: validation.value.samples.length });
  });

  app.post("/api/pose/sessions/:sessionId/close", (req, res) => {
    const { sessionId } = req.params;
    const session = getPoseSession(poseDb, sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Pose session not found." });
    }

    closePoseSession(poseDb, sessionId);
    const refreshed = getPoseSummary(poseDb, sessionId);
    if (refreshed) {
      const llmPayload = buildSessionSummaryForLlm(refreshed);
      upsertPoseSummary(poseDb, sessionId, llmPayload);
    }
    return res.json({ success: true });
  });

  app.get("/api/pose/sessions/:sessionId/summary", (req, res) => {
    const { sessionId } = req.params;
    const summary = getPoseSummary(poseDb, sessionId);
    if (!summary) {
      return res.status(404).json({ success: false, message: "Pose session not found." });
    }
    return res.json({ success: true, summary });
  });

  app.post("/api/pose/sessions/:sessionId/llm-summary", (req, res) => {
    const { sessionId } = req.params;
    const session = getPoseSession(poseDb, sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: "Pose session not found." });
    }
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: "summary payload must be an object." });
    }

    upsertPoseSummary(poseDb, sessionId, req.body);
    return res.json({ success: true });
  });

  app.post("/api/pose/sessions/latest/llm-analyze", async (req, res) => {
    const userEmail = normalizeEmail(req.body?.userEmail);
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: "userEmail is required to bind analysis to the current account."
      });
    }

    const latestSession = getLatestPoseSession(poseDb, { userEmail });
    if (!latestSession) {
      return res.status(404).json({
        success: false,
        message: "No pose session found for the current account."
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL;
    const model = process.env.QWEN_MODEL || DEFAULT_QWEN_MODEL;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        message: "OPENAI_API_KEY is not configured on the server."
      });
    }

    const summary = getPoseSummary(poseDb, latestSession.id);
    if (!summary) {
      return res.status(404).json({ success: false, message: "Latest pose session summary not found." });
    }

    const baseStructured = summary.llmSummary || buildSessionSummaryForLlm(summary);
    const prompt = [
      "你是运动动作分析助手。请仅基于以下结构化JSON给出简明分析。",
      "输出格式要求：",
      "1) overall_quality: 一句话",
      "2) key_observations: 3条以内",
      "3) next_actions: 3条以内",
      "4) confidence_note: 说明数据质量（尤其fullBodyRate）",
      "",
      "结构化数据如下：",
      JSON.stringify(baseStructured)
    ].join("\n");

    try {
      const analysisText = await requestQwenChat({
        apiKey,
        baseUrl,
        model,
        message: prompt
      });

      const enrichedSummary = {
        ...baseStructured,
        analysis: {
          provider: "qwen",
          model,
          generatedAt: new Date().toISOString(),
          text: analysisText
        }
      };
      upsertPoseSummary(poseDb, latestSession.id, enrichedSummary);

      return res.json({
        success: true,
        sessionId: latestSession.id,
        model,
        analysis: analysisText
      });
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: `LLM analysis failed: ${error.message}`
      });
    }
  });

  app.get("/api/serial/ports", async (_req, res) => {
    try {
      const ports = await serialService.listPorts();
      return res.json({ success: true, ports });
    } catch (error) {
      return res.status(500).json({ success: false, message: `List ports failed: ${error.message}` });
    }
  });

  app.get("/api/serial/status", (_req, res) => {
    return res.json({ success: true, status: serialService.getStatus() });
  });

  app.get("/api/serial/logs", (req, res) => {
    const limit = Number(req.query.limit || 200);
    const logs = serialService.getLogs({ limit });
    return res.json({ success: true, logs });
  });

  app.post("/api/serial/connect", async (req, res) => {
    const path = String(req.body?.path || "").trim();
    const baudRate = Number(req.body?.baudRate || DEFAULT_BAUD_RATE);
    if (!path) {
      return res.status(400).json({ success: false, message: "path is required." });
    }

    try {
      const status = await serialService.connect({
        path,
        baudRate,
        dataBits: req.body?.dataBits,
        stopBits: req.body?.stopBits,
        parity: req.body?.parity
      });
      return res.json({ success: true, status });
    } catch (error) {
      return res.status(400).json({ success: false, message: `Connect failed: ${error.message}` });
    }
  });

  app.post("/api/serial/disconnect", async (_req, res) => {
    try {
      const status = await serialService.disconnect();
      return res.json({ success: true, status });
    } catch (error) {
      return res.status(500).json({ success: false, message: `Disconnect failed: ${error.message}` });
    }
  });

  app.post("/api/serial/write", async (req, res) => {
    const data = String(req.body?.data || "");
    if (!data) {
      return res.status(400).json({ success: false, message: "data is required." });
    }

    try {
      await serialService.write(data, { appendNewline: Boolean(req.body?.appendNewline) });
      return res.json({ success: true });
    } catch (error) {
      return res.status(400).json({ success: false, message: `Write failed: ${error.message}` });
    }
  });

  app.use((err, _req, res, next) => {
    if (err?.type === "entity.too.large" || err?.status === 413) {
      return res.status(413).json({
        success: false,
        message: `Request body too large. Current JSON_BODY_LIMIT is ${jsonBodyLimit}.`
      });
    }
    return next(err);
  });

  app.use((err, _req, res, _next) => {
    console.error("Unhandled error:", err);
    if (res.headersSent) {
      return;
    }
    res.status(500).json({ success: false, message: "Unexpected server error." });
  });

  return {
    app,
    authDb,
    poseDb,
    close: () => {
      serialService.disconnect().catch(() => {});
      if (authDb.open) {
        authDb.close();
      }
      if (poseDb.open) {
        poseDb.close();
      }
    }
  };
}

function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? DEFAULT_PORT);
  const { app, authDb, poseDb, close } = createApp(options);
  const server = app.listen(port, () => {
    const address = server.address();
    const resolvedPort = typeof address === "object" && address ? address.port : port;
    console.log(`Server running at http://localhost:${resolvedPort}`);
  });

  const shutdown = () => {
    server.close(() => {
      close();
      process.exit(0);
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return { app, authDb, poseDb, server, close };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer,
  normalizeEmail,
  isValidEmail,
  validateCredentials,
  isBcryptHash,
  requestQwenChat,
  streamQwenChat
};
