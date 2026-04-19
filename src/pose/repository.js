const { toIsoNow } = require("./contracts");

const ANGLE_KEYS = [
  "leftElbowAngle",
  "rightElbowAngle",
  "leftKneeAngle",
  "rightKneeAngle",
  "leftShoulderAngle",
  "rightShoulderAngle",
  "leftHipAngle",
  "rightHipAngle",
  "torsoLeanDeg"
];

function initPoseTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pose_sessions (
      id TEXT PRIMARY KEY,
      user_email TEXT,
      exercise TEXT NOT NULL,
      camera_mode TEXT,
      device TEXT,
      meta_json TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS pose_frame_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ts_ms REAL NOT NULL,
      tracking_status TEXT NOT NULL,
      confidence REAL,
      metrics_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES pose_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS pose_action_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ts_ms REAL NOT NULL,
      tracking_status TEXT NOT NULL,
      confidence REAL,
      full_body_visible INTEGER,
      metrics_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES pose_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS pose_risk_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ts_ms REAL NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      confidence REAL,
      cue TEXT,
      metrics_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES pose_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS pose_session_summaries (
      session_id TEXT PRIMARY KEY,
      summary_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES pose_sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pose_frames_session ON pose_frame_features(session_id);
    CREATE INDEX IF NOT EXISTS idx_pose_actions_session ON pose_action_samples(session_id);
    CREATE INDEX IF NOT EXISTS idx_pose_events_session ON pose_risk_events(session_id);
  `);
}

function createPoseSession(db, session) {
  const now = toIsoNow();
  db.prepare(
    `INSERT INTO pose_sessions (id, user_email, exercise, camera_mode, device, meta_json, started_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
  ).run(
    session.id,
    session.userEmail || null,
    session.exercise,
    session.cameraMode || null,
    session.device || null,
    JSON.stringify(session.meta || {}),
    now
  );

  return getPoseSession(db, session.id);
}

function getPoseSession(db, sessionId) {
  const row = db.prepare("SELECT * FROM pose_sessions WHERE id = ?").get(sessionId);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userEmail: row.user_email,
    exercise: row.exercise,
    cameraMode: row.camera_mode,
    device: row.device,
    meta: safeParse(row.meta_json),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status
  };
}

function getLatestPoseSession(db, options = {}) {
  const userEmail = String(options.userEmail || "").trim().toLowerCase();
  const row = userEmail
    ? db.prepare(
      `SELECT id
       FROM pose_sessions
       WHERE user_email = ?
       ORDER BY COALESCE(ended_at, started_at) DESC
       LIMIT 1`
    ).get(userEmail)
    : db.prepare(
      `SELECT id
       FROM pose_sessions
       ORDER BY COALESCE(ended_at, started_at) DESC
       LIMIT 1`
    ).get();
  if (!row) {
    return null;
  }
  return getPoseSession(db, row.id);
}

function appendFrameFeatures(db, sessionId, frames) {
  const insert = db.prepare(
    `INSERT INTO pose_frame_features (session_id, ts_ms, tracking_status, confidence, metrics_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const now = toIsoNow();
  const tx = db.transaction((list) => {
    for (const frame of list) {
      insert.run(
        sessionId,
        frame.tsMs,
        frame.trackingStatus,
        frame.confidence,
        JSON.stringify(frame.metrics || {}),
        now
      );
    }
  });
  tx(frames);
}

function appendActionSamples(db, sessionId, samples) {
  const insert = db.prepare(
    `INSERT INTO pose_action_samples (session_id, ts_ms, tracking_status, confidence, full_body_visible, metrics_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const now = toIsoNow();
  const tx = db.transaction((list) => {
    for (const sample of list) {
      insert.run(
        sessionId,
        sample.tsMs,
        sample.trackingStatus,
        sample.confidence,
        typeof sample.fullBodyVisible === "boolean" ? (sample.fullBodyVisible ? 1 : 0) : null,
        JSON.stringify(sample.metrics || {}),
        now
      );
    }
  });
  tx(samples);
}

function appendRiskEvents(db, sessionId, events) {
  const insert = db.prepare(
    `INSERT INTO pose_risk_events (session_id, ts_ms, type, severity, confidence, cue, metrics_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = toIsoNow();
  const tx = db.transaction((list) => {
    for (const event of list) {
      insert.run(
        sessionId,
        event.tsMs,
        event.type,
        event.severity,
        event.confidence,
        event.cue || null,
        JSON.stringify(event.metrics || {}),
        now
      );
    }
  });
  tx(events);
}

function closePoseSession(db, sessionId) {
  db.prepare(
    "UPDATE pose_sessions SET ended_at = ?, status = 'COMPLETED' WHERE id = ?"
  ).run(toIsoNow(), sessionId);
}

function upsertPoseSummary(db, sessionId, summary) {
  db.prepare(
    `INSERT INTO pose_session_summaries (session_id, summary_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       summary_json = excluded.summary_json,
       updated_at = excluded.updated_at`
  ).run(sessionId, JSON.stringify(summary), toIsoNow());
}

function getPoseSummary(db, sessionId) {
  const summaryRow = db.prepare("SELECT summary_json, updated_at FROM pose_session_summaries WHERE session_id = ?").get(sessionId);
  const session = getPoseSession(db, sessionId);
  if (!session) {
    return null;
  }

  const frameStats = db.prepare(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN tracking_status = 'NO_POSE' THEN 1 ELSE 0 END) as no_pose_count,
            AVG(confidence) as avg_confidence
     FROM pose_frame_features
     WHERE session_id = ?`
  ).get(sessionId);

  const actionRows = db.prepare(
    `SELECT confidence, full_body_visible, metrics_json
     FROM pose_action_samples
     WHERE session_id = ?`
  ).all(sessionId);

  const riskRows = db.prepare(
    `SELECT severity, type, COUNT(*) as cnt
     FROM pose_risk_events
     WHERE session_id = ?
     GROUP BY severity, type
     ORDER BY cnt DESC`
  ).all(sessionId);

  const actionAggregate = computeActionAggregate(actionRows);

  return {
    session,
    aggregate: {
      totalFrames: Number(frameStats?.total || 0),
      noPoseFrames: Number(frameStats?.no_pose_count || 0),
      avgConfidence: Number.isFinite(frameStats?.avg_confidence) ? Number(frameStats.avg_confidence) : null,
      totalActionSamples: actionAggregate.total,
      fullBodyActionSamples: actionAggregate.fullBodyCount,
      fullBodyRate: actionAggregate.fullBodyRate,
      avgActionConfidence: actionAggregate.avgConfidence,
      avgAngles: actionAggregate.avgAngles,
      riskDistribution: riskRows.map((row) => ({
        severity: row.severity,
        type: row.type,
        count: Number(row.cnt)
      }))
    },
    llmSummary: summaryRow ? safeParse(summaryRow.summary_json) : null,
    llmSummaryUpdatedAt: summaryRow?.updated_at || null
  };
}

function computeActionAggregate(rows) {
  const total = rows.length;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let fullBodyCount = 0;
  const angleSums = Object.fromEntries(ANGLE_KEYS.map((k) => [k, 0]));
  const angleCounts = Object.fromEntries(ANGLE_KEYS.map((k) => [k, 0]));

  for (const row of rows) {
    if (Number.isFinite(row.confidence)) {
      confidenceSum += Number(row.confidence);
      confidenceCount += 1;
    }
    if (row.full_body_visible === 1) {
      fullBodyCount += 1;
    }

    const metrics = safeParse(row.metrics_json) || {};
    for (const key of ANGLE_KEYS) {
      const value = Number(metrics[key]);
      if (Number.isFinite(value)) {
        angleSums[key] += value;
        angleCounts[key] += 1;
      }
    }
  }

  const avgAngles = {};
  for (const key of ANGLE_KEYS) {
    avgAngles[key] = angleCounts[key] ? Number((angleSums[key] / angleCounts[key]).toFixed(3)) : null;
  }

  return {
    total,
    fullBodyCount,
    fullBodyRate: total ? Number((fullBodyCount / total).toFixed(4)) : null,
    avgConfidence: confidenceCount ? Number((confidenceSum / confidenceCount).toFixed(4)) : null,
    avgAngles
  };
}

function safeParse(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

module.exports = {
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
};
