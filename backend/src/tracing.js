/**
 * tracing.js — 可選 OpenTelemetry 啟動器（默認完全關閉，零依賴負擔）
 * ---------------------------------------------------------------------------
 * 設計原則：
 *   現階段流量太低，唔值得長開 OTel SDK（會拉幾十個 npm 包、加記憶體同啟動時間）。
 *   但要把「開關」做好，將來要開只需：
 *
 *     1) npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
 *                    @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources \
 *                    @opentelemetry/semantic-conventions @opentelemetry/api
 *     2) export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
 *     3) pm2 restart zenpass-api --update-env
 *
 *   冇 set env 或冇裝包 → 一行 log「otel disabled」，行為同今日完全一樣。
 *
 * 為什麼唔直接寫入 index.js：SDK 必須喺 express / http 之前載入，
 * 而且要防止 OTel 掛掉令整個 API 起唔到。
 */

let state = { enabled: false, sdk: null, api: null };

function init() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.log(JSON.stringify({ level: "info", msg: "otel_disabled", reason: "no_endpoint" }));
    return state;
  }
  try {
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
    const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
    const { Resource } = require("@opentelemetry/resources");
    const semconv = require("@opentelemetry/semantic-conventions");
    const api = require("@opentelemetry/api");

    const serviceName = process.env.SERVICE_NAME || "zenpass-api";
    const resource = new Resource({
      [semconv.ATTR_SERVICE_NAME || "service.name"]: serviceName,
      [semconv.ATTR_SERVICE_VERSION || "service.version"]: process.env.SERVICE_VERSION || "1.0.0",
      "deployment.environment": process.env.NODE_ENV || "production",
    });

    const sdk = new NodeSDK({
      resource,
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
          "@opentelemetry/instrumentation-dns": { enabled: false },
          "@opentelemetry/instrumentation-http": {
            ignoreIncomingRequestHook: (req) => {
              const u = req.url || "";
              return u.startsWith("/api/health");
            },
          },
        }),
      ],
    });
    sdk.start();
    api.trace.getTracer(serviceName).startSpan("otel.bootstrap").end();

    state = { enabled: true, sdk, api };
    console.log(JSON.stringify({ level: "info", msg: "otel_sdk_started", service: serviceName, endpoint }));

    const shutdown = async () => { try { await sdk.shutdown(); } catch (e) {} };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (e) {
    // 套件未裝 / 版本唔夾 → 唔可以影響 API 啟動
    console.log(JSON.stringify({ level: "warn", msg: "otel_disabled", reason: e.message }));
  }
  return state;
}

/**
 * 把 active span 嘅 trace_id / span_id 寫入 AsyncLocalStorage logger context，
 * 令 log 同 trace 用同一組 ID。OTel 未開時直接 pass-through。
 */
function syncMiddleware(req, res, next) {
  if (!state.enabled) return next();
  try {
    const { trace, context } = state.api;
    const span = trace.getSpan(context.active());
    if (span) {
      const sc = span.spanContext();
      if (sc && sc.traceId) {
        req.traceId = sc.traceId;
        require("./services/event-log").assign({ trace_id: sc.traceId, span_id: sc.spanId });
      }
    }
  } catch (e) {
    /* 追蹤同步失敗唔影響請求 */
  }
  next();
}

module.exports = { init, syncMiddleware, state };
