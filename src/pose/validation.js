const { RISK_SEVERITY, TRACKING_STATUS, DEFAULT_EXERCISE } = require("./contracts");

const VALID_SEVERITY = new Set(Object.values(RISK_SEVERITY));
const VALID_TRACKING = new Set(Object.values(TRACKING_STATUS));

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeTrackingStatus(value) {
  const trackingStatus = String(value || TRACKING_STATUS.TRACKING).trim().toUpperCase();
  return VALID_TRACKING.has(trackingStatus) ? trackingStatus : null;
}

function normalizeConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateCreateSession(payload) {
  const body = isObject(payload) ? payload : {};
  const exercise = String(body.exercise || DEFAULT_EXERCISE).trim().toLowerCase();
  const userEmail = String(body.userEmail || "").trim().toLowerCase();
  const cameraMode = String(body.cameraMode || "front").trim().toLowerCase();
  const device = String(body.device || "web").trim();

  if (!exercise) {
    return { ok: false, status: 400, message: "exercise is required." };
  }

  return {
    ok: true,
    value: {
      exercise,
      userEmail,
      cameraMode,
      device,
      meta: isObject(body.meta) ? body.meta : {}
    }
  };
}

function validateFrameFeatures(payload) {
  const body = isObject(payload) ? payload : {};
  const frames = Array.isArray(body.frames) ? body.frames : [];

  if (frames.length === 0) {
    return { ok: false, status: 400, message: "frames is required and must be non-empty." };
  }

  if (frames.length > 120) {
    return { ok: false, status: 400, message: "frames batch too large (max 120)." };
  }

  const normalized = [];
  for (const frame of frames) {
    const item = isObject(frame) ? frame : {};
    const tsMs = Number(item.tsMs);
    const trackingStatus = normalizeTrackingStatus(item.trackingStatus);

    if (!Number.isFinite(tsMs) || tsMs < 0) {
      return { ok: false, status: 400, message: "frame tsMs must be a non-negative number." };
    }
    if (!trackingStatus) {
      return { ok: false, status: 400, message: `invalid trackingStatus: ${item.trackingStatus}` };
    }

    normalized.push({
      tsMs,
      trackingStatus,
      confidence: normalizeConfidence(item.confidence),
      metrics: isObject(item.metrics) ? item.metrics : {}
    });
  }

  return { ok: true, value: { frames: normalized } };
}

function validateActionSamples(payload) {
  const body = isObject(payload) ? payload : {};
  const samples = Array.isArray(body.samples) ? body.samples : [];

  if (samples.length === 0) {
    return { ok: false, status: 400, message: "samples is required and must be non-empty." };
  }

  if (samples.length > 180) {
    return { ok: false, status: 400, message: "samples batch too large (max 180)." };
  }

  const normalized = [];
  for (const sample of samples) {
    const item = isObject(sample) ? sample : {};
    const tsMs = Number(item.tsMs);
    const trackingStatus = normalizeTrackingStatus(item.trackingStatus || TRACKING_STATUS.TRACKING);

    if (!Number.isFinite(tsMs) || tsMs < 0) {
      return { ok: false, status: 400, message: "sample tsMs must be a non-negative number." };
    }
    if (!trackingStatus) {
      return { ok: false, status: 400, message: `invalid trackingStatus: ${item.trackingStatus}` };
    }

    const metrics = isObject(item.metrics) ? item.metrics : {};
    const fullBodyVisible = typeof item.fullBodyVisible === "boolean"
      ? item.fullBodyVisible
      : typeof metrics.fullBodyVisible === "boolean"
        ? metrics.fullBodyVisible
        : null;

    normalized.push({
      tsMs,
      trackingStatus,
      confidence: normalizeConfidence(item.confidence),
      fullBodyVisible,
      metrics
    });
  }

  return { ok: true, value: { samples: normalized } };
}

function validateRiskEvents(payload) {
  const body = isObject(payload) ? payload : {};
  const events = Array.isArray(body.events) ? body.events : [];

  if (events.length === 0) {
    return { ok: false, status: 400, message: "events is required and must be non-empty." };
  }

  if (events.length > 60) {
    return { ok: false, status: 400, message: "events batch too large (max 60)." };
  }

  const normalized = [];
  for (const event of events) {
    const item = isObject(event) ? event : {};
    const tsMs = Number(item.tsMs);
    const type = String(item.type || "").trim();
    const severity = String(item.severity || RISK_SEVERITY.WARN).trim().toUpperCase();

    if (!Number.isFinite(tsMs) || tsMs < 0) {
      return { ok: false, status: 400, message: "event tsMs must be a non-negative number." };
    }
    if (!type) {
      return { ok: false, status: 400, message: "event type is required." };
    }
    if (!VALID_SEVERITY.has(severity)) {
      return { ok: false, status: 400, message: `invalid severity: ${severity}` };
    }

    normalized.push({
      tsMs,
      type,
      severity,
      confidence: normalizeConfidence(item.confidence),
      metrics: isObject(item.metrics) ? item.metrics : {},
      cue: String(item.cue || "").trim()
    });
  }

  return { ok: true, value: { events: normalized } };
}

module.exports = {
  validateCreateSession,
  validateFrameFeatures,
  validateActionSamples,
  validateRiskEvents
};
