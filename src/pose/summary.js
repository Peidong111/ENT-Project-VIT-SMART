const { RISK_SEVERITY } = require("./contracts");

function buildSessionSummaryForLlm({ session, aggregate }) {
  const severityMap = {
    [RISK_SEVERITY.INFO]: 0,
    [RISK_SEVERITY.MESSAGE]: 0,
    [RISK_SEVERITY.HIGH]: 0
  };

  for (const item of aggregate.riskDistribution || []) {
    if (severityMap[item.severity] === undefined) {
      continue;
    }
    severityMap[item.severity] += Number(item.count || 0);
  }

  return {
    schemaVersion: "1.1",
    session: {
      id: session.id,
      exercise: session.exercise,
      userEmail: session.userEmail,
      cameraMode: session.cameraMode,
      device: session.device,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      status: session.status
    },
    motion: {
      totalSamples: aggregate.totalActionSamples,
      fullBodySamples: aggregate.fullBodyActionSamples,
      fullBodyRate: aggregate.fullBodyRate,
      avgConfidence: aggregate.avgActionConfidence,
      avgAngles: aggregate.avgAngles
    },
    riskSummary: {
      highCount: severityMap[RISK_SEVERITY.HIGH],
      messageCount: severityMap[RISK_SEVERITY.MESSAGE],
      infoCount: severityMap[RISK_SEVERITY.INFO],
      topRisks: (aggregate.riskDistribution || []).slice(0, 5)
    }
  };
}

module.exports = {
  buildSessionSummaryForLlm
};
