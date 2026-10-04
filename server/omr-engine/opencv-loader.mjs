import { Jimp } from "jimp";

let cvPromise = null;
let jimpPromise = null;

export const getCV = () => {
  if (!cvPromise) {
    cvPromise = (async () => {
      const mod = await import("@techstark/opencv-js");
      const cv = mod.default ?? mod;
      if (cv instanceof Promise) {
        return await cv;
      }
      if (cv.Mat) {
        return cv;
      }
      return await new Promise((resolve) => {
        cv.onRuntimeInitialized = () => resolve(cv);
      });
    })();
  }
  return cvPromise;
};

export const getJimp = () => {
  if (!jimpPromise) {
    jimpPromise = Promise.resolve(Jimp);
  }
  return jimpPromise;
};

export const withMat = async (mat, fn) => {
  try {
    return await fn(mat);
  } finally {
    try {
      mat.delete();
    } catch {
      /* already deleted */
    }
  }
};

export const withMats = async (mats, fn) => {
  try {
    return await fn(mats);
  } finally {
    for (const m of mats) {
      try {
        m.delete();
      } catch {
        /* already deleted */
      }
    }
  }
};