# Pose Data Contract (Scaffold)

用于健身风险识别与 LLM 总结的后端结构化接口。

## Session Lifecycle

1. `POST /api/pose/sessions`
2. `POST /api/pose/sessions/:sessionId/frames`
3. `POST /api/pose/sessions/:sessionId/events`
4. `POST /api/pose/sessions/:sessionId/actions` (动作样本，推荐给 LLM)
5. `POST /api/pose/sessions/:sessionId/close`
6. `GET /api/pose/sessions/:sessionId/summary`
7. `POST /api/pose/sessions/:sessionId/llm-summary` (可选，写回外部 LLM 分析结果)
8. `POST /api/pose/sessions/latest/llm-analyze` (用服务端同一API key分析“当前用户”的最近会话并回写)

请求体示例：

```json
{
  "userEmail": "user@example.com"
}
```

## Create Session

```json
{
  "userEmail": "user@example.com",
  "exercise": "squat",
  "cameraMode": "side",
  "device": "web",
  "meta": { "appVersion": "0.1.0" }
}
```

## Frames Payload

```json
{
  "frames": [
    {
      "tsMs": 120,
      "trackingStatus": "TRACKING",
      "confidence": 0.92,
      "metrics": {
        "leftKneeAngle": 86,
        "hipAngle": 95,
        "torsoLean": 14
      }
    }
  ]
}
```

## Risk Events Payload

```json
{
  "events": [
    {
      "tsMs": 180,
      "type": "KNEE_VALGUS",
      "severity": "WARN",
      "confidence": 0.78,
      "metrics": { "leftKneeToToeOffset": 0.13 },
      "cue": "Keep knee aligned with toe."
    }
  ]
}
```

## Action Samples Payload

```json
{
  "samples": [
    {
      "tsMs": 200,
      "trackingStatus": "TRACKING",
      "confidence": 0.88,
      "fullBodyVisible": true,
      "metrics": {
        "leftKneeAngle": 84,
        "rightKneeAngle": 88,
        "torsoLeanDeg": 12
      }
    }
  ]
}
```

## Summary Shape for LLM

`GET /summary` 将返回聚合统计以及 `llmSummary` 字段。
`llmSummary` 可直接作为后续 LLM 分析输入（会话信息 + 风险分布 + 关键计数）。
