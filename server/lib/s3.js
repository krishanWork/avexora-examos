import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

// S3 storage backend for ExamOS uploads.
//
// Layout mirrors the old local-disk tree:
//   private/<tenantId>/<uuid>.<ext>   tenant-scoped inputs (OMR sheets, CSVs, docs)
//   public/<uuid>.<ext>               intentionally-public branding logos
//
// Modes:
//   - "s3":   AWS_BUCKET_NAME set; all file I/O happens in S3.
//   - "local": dev-only filesystem fallback (NODE_ENV !== "production").
//
// In production a missing or invalid S3 configuration fails fast at startup
// (never silently falls back to local disk).

let state = null;

const explicitBackend = () => String(process.env.STORAGE_BACKEND || "").trim().toLowerCase();

const bucketName = () => String(process.env.AWS_BUCKET_NAME || "").trim() || null;

const regionName = () =>
  process.env.AWS_REGION?.trim() ||
  process.env.AWS_DEFAULT_REGION?.trim() ||
  "ap-south-1";

const credentials = () => {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
    };
  }
  return undefined; // fall back to the SDK default credential chain (task/instance roles)
};

const client = () =>
  new S3Client({
    region: regionName(),
    credentials: credentials(),
    ...(process.env.AWS_S3_ENDPOINT ? { endpoint: process.env.AWS_S3_ENDPOINT, forcePathStyle: true } : {}),
  });

const isProduction = () => process.env.NODE_ENV === "production";

export function getStorageMode() {
  if (explicitBackend() === "local") return "local";
  if (explicitBackend() === "s3") return "s3";
  return bucketName() ? "s3" : "local";
}

export function getBucket() {
  return bucketName();
}

export function privateKey(tenantId, storedName) {
  return `private/${tenantId}/${storedName}`;
}

export function publicKey(storedName) {
  return `public/${storedName}`;
}

export async function headBucket(bucket = bucketName()) {
  await client().send(new HeadBucketCommand({ Bucket: bucket }));
}

/**
 * Resolves the storage mode once at startup.
 * - Production + no bucket  -> throws (fail fast).
 * - Production + S3 invalid -> throws with a descriptive S3 cause.
 * - Dev + invalid S3         -> warns and falls back to local disk.
 * - STORAGE_BACKEND=local    -> explicit override (hermetic tests/dev); never silent.
 * - STORAGE_BACKEND=s3       -> explicit s3; requires AWS_BUCKET_NAME.
 */
export async function initStorage() {
  const backend = explicitBackend();
  if (backend === "local") {
    state = { mode: "local", bucket: null };
    return state;
  }

  const bucket = bucketName();
  if (backend === "s3" && !bucket) {
    throw new Error("STORAGE_BACKEND=s3 is set but AWS_BUCKET_NAME is missing.");
  }

  if (!bucket) {
    if (isProduction()) {
      throw new Error(
        "AWS_BUCKET_NAME is not set. ExamOS production requires S3 storage for uploads; refusing to fall back to local disk."
      );
    }
    state = { mode: "local", bucket: null };
    return state;
  }

  try {
    await headBucket(bucket);
  } catch (err) {
    if (isProduction()) {
      throw new Error(
        `S3 configuration is invalid for bucket "${bucket}" (${regionName()}): ${err.message}`
      );
    }
    console.warn(
      `[storage] S3 bucket "${bucket}" could not be validated (${err.message}); falling back to local disk storage for development.`
    );
    process.env.AWS_BUCKET_NAME = "";
    state = { mode: "local", bucket: null };
    return state;
  }

  console.log(`[storage] S3 storage enabled (bucket=${bucket}, region=${regionName()})`);
  state = { mode: "s3", bucket };
  return state;
}

export function getStorage() {
  if (!state) throw new Error("Storage has not been initialized; call initStorage() at startup");
  return state;
}

export async function putObject({ Key, Body, ContentType, CacheControl }) {
  await client().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key,
      Body,
      ...(ContentType && { ContentType }),
      ...(CacheControl && { CacheControl }),
    })
  );
  return Key;
}

export async function getObject(Key) {
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucketName(), Key })
  );
  return {
    Body: res.Body,
    ContentType: res.ContentType,
    ContentLength: res.ContentLength,
    ETag: res.ETag,
  };
}

export async function getObjectBuffer(Key) {
  const { Body } = await getObject(Key);
  const chunks = [];
  for await (const chunk of Body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export async function objectExists(Key) {
  try {
    await client().send(new HeadObjectCommand({ Bucket: bucketName(), Key }));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") return false;
    throw err;
  }
}

export async function deleteObject(Key) {
  await client().send(new DeleteObjectCommand({ Bucket: bucketName(), Key }));
}

export async function listKeys(prefix, { limit = 1000 } = {}) {
  const keys = [];
  let token;
  do {
    const res = await client().send(
      new ListObjectsV2Command({
        Bucket: bucketName(),
        Prefix: prefix,
        ...(token && { ContinuationToken: token }),
      })
    );
    for (const obj of res.Contents || []) {
      keys.push(obj.Key);
      if (keys.length >= limit) return keys;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function downloadToFile(Key, filePath) {
  const { Body } = await getObject(Key);
  const { createWriteStream } = await import("node:fs");
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(filePath);
    Body.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);
    Body.on("error", reject);
  });
}