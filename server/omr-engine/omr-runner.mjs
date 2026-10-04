import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKER_PATH = path.join(__dirname, "eval-worker.mjs");

export const runOmrInWorker = (args, { timeoutMs } = {}) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_PATH, { workerData: args });
    const timeoutTimer = timeoutMs
      ? setTimeout(() => {
          const err = new Error(`OMR evaluation timed out after ${timeoutMs}ms`);
          err.code = "OMR_TIMEOUT";
          settle(err);
        }, timeoutMs)
      : null;
    const settle = (value, isReject = false) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      try {
        worker.terminate();
      } catch {
        /* already gone */
      }
      return isReject || value instanceof Error ? reject(value) : resolve(value);
    };
    worker.once("message", (msg) => {
      if (msg && msg.type === "error") {
        const err = new Error(msg.message || "OMR evaluation failed");
        err.code = msg.code;
        settle(err);
      } else {
        settle(msg);
      }
    });
    worker.once("error", (err) => settle(err));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) settle(new Error(`OMR worker exited with code ${code}`));
    });
  });