const RISK_SEVERITY = {
  INFO: "INFO",
  MESSAGE: "MESSAGE",
  HIGH: "HIGH"
};

const TRACKING_STATUS = {
  TRACKING: "TRACKING",
  NO_POSE: "NO_POSE",
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
  UNSTABLE: "UNSTABLE"
};

const DEFAULT_EXERCISE = "general";

function toIsoNow() {
  return new Date().toISOString();
}

module.exports = {
  RISK_SEVERITY,
  TRACKING_STATUS,
  DEFAULT_EXERCISE,
  toIsoNow
};
