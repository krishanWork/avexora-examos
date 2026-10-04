import crypto from "node:crypto";

const API_START_TAG = "[API START]";
const API_END_TAG = "[API END]";
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

const isApiRequest = (req) =>
  req.method !== "OPTIONS" &&
  !req.path.startsWith("/uploads") &&
  !req.path.startsWith("/api/uploads") &&
  (req.path === "/api" || req.path.startsWith("/api/"));

const getRequestId = (req) => {
  const provided = req.get("x-request-id");
  if (provided && SAFE_REQUEST_ID.test(provided)) return provided;
  return crypto.randomUUID();
};

export const installApiLogging = (app) => {
  app.use((req, res, next) => {
    if (!isApiRequest(req)) return next();

    req.requestId = getRequestId(req);
    res.setHeader("X-Request-ID", req.requestId);

    const start = process.hrtime.bigint();
    const method = req.method;
    const path = req.path;

    console.log(`${API_START_TAG} requestId=${req.requestId} method=${method} path=${path}`);

    const originalJson = res.json;
    res.json = function (body) {
      if (body && typeof body === "object" && typeof body.error === "string") {
        res.locals.logError = body.error;
      }
      return originalJson.call(this, body);
    };

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const errorSuffix = res.locals.logError ? ` error="${res.locals.logError}"` : "";
      console.log(
        `${API_END_TAG} requestId=${req.requestId} method=${method} path=${path} status=${res.statusCode} duration=${Math.round(durationMs)}ms${errorSuffix}`
      );
    });

    next();
  });
};