const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { startServer, isBcryptHash } = require("../server");

function postJson(baseUrl, route, body) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("auth flow and legacy password migration", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-auth-"));
  const authDbPath = path.join(tmpDir, "auth.db");
  const poseDbPath = path.join(tmpDir, "pose.db");
  const { server, close } = startServer({ port: 0, authDbPath, poseDbPath, bcryptRounds: 8 });

  t.after(() => {
    server.close();
    close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const registerRes = await postJson(baseUrl, "/register", {
    email: "User@Example.com",
    password: "password123"
  });
  assert.equal(registerRes.status, 200);
  const registerBody = await registerRes.json();
  assert.equal(registerBody.success, true);

  const duplicateRes = await postJson(baseUrl, "/register", {
    email: "user@example.com",
    password: "password123"
  });
  assert.equal(duplicateRes.status, 409);

  const badLoginRes = await postJson(baseUrl, "/login", {
    email: "user@example.com",
    password: "wrong-password"
  });
  assert.equal(badLoginRes.status, 401);

  const loginRes = await postJson(baseUrl, "/login", {
    email: "USER@example.com",
    password: "password123"
  });
  assert.equal(loginRes.status, 200);
  const loginBody = await loginRes.json();
  assert.equal(loginBody.success, true);
  assert.equal(loginBody.email, "user@example.com");

  const db = new Database(authDbPath);
  const stored = db.prepare("SELECT password FROM users WHERE email = ?").get("user@example.com");
  assert.equal(isBcryptHash(stored.password), true);
  db.close();

  // Insert a legacy plaintext user and verify one-time migration during login.
  const legacyDb = new Database(authDbPath);
  legacyDb
    .prepare("INSERT INTO users (email, password) VALUES (?, ?)")
    .run("legacy@example.com", "plain-secret");
  legacyDb.close();

  const legacyLoginRes = await postJson(baseUrl, "/login", {
    email: "legacy@example.com",
    password: "plain-secret"
  });
  assert.equal(legacyLoginRes.status, 200);

  const migratedDb = new Database(authDbPath);
  const migrated = migratedDb.prepare("SELECT password FROM users WHERE email = ?").get("legacy@example.com");
  assert.equal(isBcryptHash(migrated.password), true);
  migratedDb.close();
});

test("qwen endpoint returns config error when API key is missing", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-qwen-"));
  const authDbPath = path.join(tmpDir, "auth.db");
  const poseDbPath = path.join(tmpDir, "pose.db");
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const { server, close } = startServer({ port: 0, authDbPath, poseDbPath });

  t.after(() => {
    if (previousApiKey) {
      process.env.OPENAI_API_KEY = previousApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    server.close();
    close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const response = await postJson(`http://127.0.0.1:${port}`, "/api/qwen-chat", {
    message: "hello",
    context: "latest pose analysis context"
  });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.success, false);
});

test("qwen stream endpoint returns config error when API key is missing", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-qwen-stream-"));
  const authDbPath = path.join(tmpDir, "auth.db");
  const poseDbPath = path.join(tmpDir, "pose.db");
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const { server, close } = startServer({ port: 0, authDbPath, poseDbPath });

  t.after(() => {
    if (previousApiKey) {
      process.env.OPENAI_API_KEY = previousApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    server.close();
    close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const response = await postJson(`http://127.0.0.1:${port}`, "/api/qwen-chat-stream", {
    message: "hello"
  });

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.success, false);
});

test("pose data pipeline scaffold endpoints work for a basic session", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-pose-"));
  const authDbPath = path.join(tmpDir, "auth.db");
  const poseDbPath = path.join(tmpDir, "pose.db");
  const { server, close } = startServer({ port: 0, authDbPath, poseDbPath });

  t.after(() => {
    server.close();
    close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const createRes = await postJson(base, "/api/pose/sessions", {
    userEmail: "coach@example.com",
    exercise: "squat",
    cameraMode: "side",
    meta: { app: "web-demo" }
  });
  assert.equal(createRes.status, 201);
  const createBody = await createRes.json();
  assert.equal(createBody.success, true);
  const sessionId = createBody.session.id;
  assert.ok(sessionId);

  const framesRes = await postJson(base, `/api/pose/sessions/${sessionId}/frames`, {
    frames: [
      { tsMs: 100, trackingStatus: "TRACKING", confidence: 0.9, metrics: { kneeAngle: 82 } },
      { tsMs: 140, trackingStatus: "NO_POSE", confidence: 0.1, metrics: {} }
    ]
  });
  assert.equal(framesRes.status, 200);

  const actionsRes = await postJson(base, `/api/pose/sessions/${sessionId}/actions`, {
    samples: [
      {
        tsMs: 100,
        trackingStatus: "TRACKING",
        confidence: 0.9,
        fullBodyVisible: true,
        metrics: { leftKneeAngle: 82, rightKneeAngle: 85, torsoLeanDeg: 13 }
      },
      {
        tsMs: 140,
        trackingStatus: "NO_POSE",
        confidence: 0.2,
        fullBodyVisible: false,
        metrics: {}
      }
    ]
  });
  assert.equal(actionsRes.status, 200);

  const eventsRes = await postJson(base, `/api/pose/sessions/${sessionId}/events`, {
    events: [
      {
        tsMs: 150,
        type: "KNEE_VALGUS",
        severity: "MESSAGE",
        confidence: 0.77,
        metrics: { leftKneeAngle: 21 },
        cue: "Keep knee aligned with toe."
      }
    ]
  });
  assert.equal(eventsRes.status, 200);

  const closeRes = await postJson(base, `/api/pose/sessions/${sessionId}/close`, {});
  assert.equal(closeRes.status, 200);

  const summaryRes = await fetch(`${base}/api/pose/sessions/${sessionId}/summary`);
  assert.equal(summaryRes.status, 200);
  const summaryBody = await summaryRes.json();
  assert.equal(summaryBody.success, true);
  assert.equal(summaryBody.summary.session.exercise, "squat");
  assert.equal(summaryBody.summary.aggregate.totalFrames, 2);
  assert.equal(summaryBody.summary.aggregate.noPoseFrames, 1);
  assert.equal(summaryBody.summary.aggregate.totalActionSamples, 2);
  assert.equal(summaryBody.summary.aggregate.fullBodyActionSamples, 1);
  assert.equal(Array.isArray(summaryBody.summary.aggregate.riskDistribution), true);
  assert.equal(summaryBody.summary.llmSummary.schemaVersion, "1.1");

  const customSummaryRes = await postJson(base, `/api/pose/sessions/${sessionId}/llm-summary`, {
    schemaVersion: "1.1",
    reviewer: "llm",
    notes: ["knee alignment risk remains high"]
  });
  assert.equal(customSummaryRes.status, 200);

  const summaryRes2 = await fetch(`${base}/api/pose/sessions/${sessionId}/summary`);
  assert.equal(summaryRes2.status, 200);
  const summaryBody2 = await summaryRes2.json();
  assert.equal(summaryBody2.summary.llmSummary.schemaVersion, "1.1");
});

test("latest pose LLM analysis endpoint returns config error when key missing", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-pose-llm-"));
  const authDbPath = path.join(tmpDir, "auth.db");
  const poseDbPath = path.join(tmpDir, "pose.db");
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const { server, close } = startServer({ port: 0, authDbPath, poseDbPath });

  t.after(() => {
    if (previousApiKey) {
      process.env.OPENAI_API_KEY = previousApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    server.close();
    close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const createRes = await postJson(base, "/api/pose/sessions", {
    userEmail: "coach@example.com",
    exercise: "general"
  });
  assert.equal(createRes.status, 201);

  const missingUserRes = await postJson(base, "/api/pose/sessions/latest/llm-analyze", {});
  assert.equal(missingUserRes.status, 400);

  const wrongUserRes = await postJson(base, "/api/pose/sessions/latest/llm-analyze", {
    userEmail: "other@example.com"
  });
  assert.equal(wrongUserRes.status, 404);

  const analyzeRes = await postJson(base, "/api/pose/sessions/latest/llm-analyze", {
    userEmail: "coach@example.com"
  });
  assert.equal(analyzeRes.status, 503);
  const analyzeBody = await analyzeRes.json();
  assert.equal(analyzeBody.success, false);
});

test("serial endpoints work with injected mock service", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-serial-"));
  const authDbPath = path.join(tmpDir, "auth.db");
  const poseDbPath = path.join(tmpDir, "pose.db");
  const mockService = {
    state: { connected: false, path: null, baudRate: null },
    logs: [],
    async listPorts() {
      return [{ path: "/dev/tty.usbserial-1410", isLikelyCh340: true }];
    },
    getStatus() {
      return this.state;
    },
    getLogs() {
      return this.logs;
    },
    async connect({ path, baudRate }) {
      this.state = { connected: true, path, baudRate };
      this.logs.push({ id: 1, ts: new Date().toISOString(), direction: "system", text: "connected" });
      return this.state;
    },
    async disconnect() {
      this.state = { connected: false, path: null, baudRate: null };
      return this.state;
    },
    async write(data) {
      this.logs.push({ id: 2, ts: new Date().toISOString(), direction: "out", text: data });
      return { ok: true };
    }
  };

  const { server, close } = startServer({ port: 0, authDbPath, poseDbPath, serialService: mockService });

  t.after(() => {
    server.close();
    close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const portsRes = await fetch(`${base}/api/serial/ports`);
  assert.equal(portsRes.status, 200);

  const connectRes = await postJson(base, "/api/serial/connect", {
    path: "/dev/tty.usbserial-1410",
    baudRate: 115200
  });
  assert.equal(connectRes.status, 200);

  const writeRes = await postJson(base, "/api/serial/write", { data: "AT" });
  assert.equal(writeRes.status, 200);

  const logsRes = await fetch(`${base}/api/serial/logs?limit=20`);
  assert.equal(logsRes.status, 200);
  const logsBody = await logsRes.json();
  assert.equal(logsBody.success, true);
  assert.equal(Array.isArray(logsBody.logs), true);
  assert.equal(logsBody.logs.length >= 1, true);

  const disconnectRes = await postJson(base, "/api/serial/disconnect", {});
  assert.equal(disconnectRes.status, 200);
});
