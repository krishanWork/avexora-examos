import { parentPort, workerData } from "node:worker_threads";
import { evaluateOMR } from "./evaluator.mjs";
import { generateOMR } from "./generate-sample-omr.mjs";
import { getCV } from "./opencv-loader.mjs";
import { writePng } from "./png-writer.mjs";

if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function () {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
if (typeof Promise.try !== "function") {
  Promise.try = function (fn) {
    return new Promise((resolve) => resolve(typeof fn === "function" ? fn() : fn));
  };
}

const send = (payload) => {
  if (parentPort) parentPort.postMessage(payload);
};

const makeCorrupt = async (outputPath) => {
  const cv = await getCV();
  const img = new cv.Mat(1200, 800, cv.CV_8UC3, new cv.Scalar(245, 245, 245));
  try {
    cv.putText(img, "NO ALIGNMENT MARKERS HERE", new cv.Point(80, 300), cv.FONT_HERSHEY_SIMPLEX, 1.0, new cv.Scalar(20, 20, 20), 2);
    await writePng(cv, img, outputPath);
  } finally {
    img.delete();
  }
};

try {
  const job = workerData && workerData.job;
  let result;
  if (job === "generate") {
    const { templatePath, outputPath, answers, numQuestions, admissionNumber, rotation, perspective, blur, brightness, noise } = workerData;
    result = await generateOMR({
      templatePath,
      outputPath,
      answers,
      numQuestions,
      admissionNumber,
      rotation,
      perspective,
      blur,
      brightness,
      noise,
    });
  } else if (job === "corrupt") {
    await makeCorrupt(workerData.outputPath);
    result = { outputPath: workerData.outputPath };
  } else {
    result = await evaluateOMR(workerData || {});
  }
  send({ type: "result", result });
} catch (e) {
  send({ type: "error", code: e.code || "OMR_EVALUATION_FAILED", message: e.message || String(e) });
} finally {
  try {
    parentPort?.close();
  } catch {
    /* worker may already be terminating */
  }
}