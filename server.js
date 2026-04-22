import express from "express";
import basicAuth from "express-basic-auth";
import multer from "multer";
import {Client as MinioClient} from "minio";

// --- Environment ---
const {
  PORT = 3000,
  ADMIN_USER,
  ADMIN_PASS,
  MINIO_ENDPOINT,
  MINIO_PORT = "9000",
  MINIO_USE_SSL = "false",
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
} = process.env;

// Fail fast on missing required envs
const required = {ADMIN_USER, ADMIN_PASS, MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY};
for (const [key, value] of Object.entries(required)) {
  if (!value) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

// --- MinIO client ---
const minio = new MinioClient({
  endPoint: MINIO_ENDPOINT,
  port: Number(MINIO_PORT),
  useSSL: MINIO_USE_SSL === "true",
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

// --- Policy helpers ---
// Builds an AWS-style bucket policy equivalent to `mc anonymous set <level>`
function buildPolicy(bucket, level) {
  const policy = {Version: "2012-10-17", Statement: []};
  const bucketArn = `arn:aws:s3:::${bucket}`;
  const objectsArn = `arn:aws:s3:::${bucket}/*`;

  if (level === "download" || level === "public") {
    policy.Statement.push({
      Effect: "Allow",
      Principal: {AWS: ["*"]},
      Action: ["s3:GetBucketLocation", "s3:ListBucket"],
      Resource: [bucketArn],
    });
    policy.Statement.push({
      Effect: "Allow",
      Principal: {AWS: ["*"]},
      Action: ["s3:GetObject"],
      Resource: [objectsArn],
    });
  }
  if (level === "upload" || level === "public") {
    policy.Statement.push({
      Effect: "Allow",
      Principal: {AWS: ["*"]},
      Action: ["s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      Resource: [objectsArn],
    });
  }
  return policy;
}

// Reads current policy and classifies it as none/download/upload/public/custom
async function getPolicyLevel(bucket) {
  try {
    const raw = await minio.getBucketPolicy(bucket);
    const policy = typeof raw === "string" ? JSON.parse(raw) : raw;
    const actions = new Set();
    for (const statement of policy.Statement || []) {
      const acts = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      acts.forEach((a) => actions.add(a));
    }
    const canGet = actions.has("s3:GetObject");
    const canPut = actions.has("s3:PutObject");
    if (canGet && canPut) return "public";
    if (canGet) return "download";
    if (canPut) return "upload";
    return "custom";
  } catch (err) {
    if (err.code === "NoSuchBucketPolicy") return "none";
    throw err;
  }
}

// --- Express setup ---
const app = express();
app.use(express.json());
app.use(
  basicAuth({
    users: {[ADMIN_USER]: ADMIN_PASS},
    challenge: true,
    realm: "MinIO Admin",
  })
);
app.use(express.static("public"));

const upload = multer({storage: multer.memoryStorage()});

// --- Bucket routes ---
app.get("/api/buckets", async (_req, res, next) => {
  try {
    const buckets = await minio.listBuckets();
    const result = await Promise.all(
      buckets.map(async (b) => ({
        name: b.name,
        createdAt: b.creationDate,
        policy: await getPolicyLevel(b.name),
      }))
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/api/buckets", async (req, res, next) => {
  try {
    const {name} = req.body;
    if (!name) return res.status(400).json({error: "name is required"});
    await minio.makeBucket(name);
    res.status(201).json({name});
  } catch (err) {
    next(err);
  }
});

app.delete("/api/buckets/:name", async (req, res, next) => {
  try {
    const {name} = req.params;
    const force = req.query.force === "true";
    if (force) {
      // Remove all objects before dropping the bucket
      const keys = [];
      await new Promise((resolve, reject) => {
        const stream = minio.listObjects(name, "", true);
        stream.on("data", (o) => keys.push(o.name));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      if (keys.length) await minio.removeObjects(name, keys);
    }
    await minio.removeBucket(name);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

app.put("/api/buckets/:name/policy", async (req, res, next) => {
  try {
    const {name} = req.params;
    const {level} = req.body;
    const valid = ["none", "download", "upload", "public"];
    if (!valid.includes(level)) {
      return res.status(400).json({error: `level must be one of: ${valid.join(", ")}`});
    }
    const policy = level === "none"
      ? {Version: "2012-10-17", Statement: []}
      : buildPolicy(name, level);
    await minio.setBucketPolicy(name, JSON.stringify(policy));
    res.json({name, level});
  } catch (err) {
    next(err);
  }
});

// --- Object routes ---
app.get("/api/buckets/:name/objects", async (req, res, next) => {
  try {
    const {name} = req.params;
    const prefix = req.query.prefix || "";
    const objects = [];
    await new Promise((resolve, reject) => {
      const stream = minio.listObjects(name, prefix, true);
      stream.on("data", (o) => objects.push({
        name: o.name,
        size: o.size,
        lastModified: o.lastModified,
      }));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    res.json(objects);
  } catch (err) {
    next(err);
  }
});

app.post("/api/buckets/:name/objects", upload.single("file"), async (req, res, next) => {
  try {
    const {name} = req.params;
    if (!req.file) return res.status(400).json({error: "file is required"});
    const key = req.body.key || req.file.originalname;
    await minio.putObject(name, key, req.file.buffer, req.file.size, {
      "Content-Type": req.file.mimetype,
    });
    res.status(201).json({key});
  } catch (err) {
    next(err);
  }
});

app.delete("/api/buckets/:name/objects/*", async (req, res, next) => {
  try {
    const {name} = req.params;
    const objectKey = req.params[0]; // captures the wildcard path
    await minio.removeObject(name, objectKey);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// --- Error handler ---
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({error: err.message});
});

app.listen(PORT, () => {
  console.log(`MinIO admin listening on :${PORT}`);
});