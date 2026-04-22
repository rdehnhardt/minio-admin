# MinIO Admin

A minimal web panel to manage buckets and objects on **MinIO Community Edition**, which removed bucket policy and object management from the official console.

Built as a lightweight companion UI for self-hosted MinIO instances running on [Coolify](https://coolify.io), Docker, or any container platform.

![Stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express-black)
![MinIO](https://img.shields.io/badge/minio-SDK%20v8-red)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Why this exists

MinIO Community Edition stripped several management features from its web console, including:

- Changing bucket anonymous access policy (private / download / upload / public)
- Creating and deleting buckets through the UI
- Managing objects inside buckets

The only way to perform these actions on CE is via the `mc` CLI inside the container. This panel wraps those operations behind a clean, authenticated web UI.

---

## Features

-  **List all buckets** with their current anonymous access policy
-  **Create** new buckets
- ️ **Delete** buckets (with optional force-delete for non-empty ones)
-  **Change policy** inline: `none` / `download` / `upload` / `public`
-  **List objects** inside any bucket
- ️ **Upload** files directly from the browser
-  **Delete** individual objects
-  **Basic Auth** protection on all routes (including the UI)

---

## Stack

| Layer     | Technology                                      |
| --------- | ----------------------------------------------- |
| Runtime   | Node.js 22 (Alpine)                             |
| Server    | Express 4                                       |
| MinIO SDK | [`minio`](https://www.npmjs.com/package/minio) 8.x |
| Auth      | `express-basic-auth`                            |
| Uploads   | `multer` 2.x                                    |
| Frontend  | Vanilla JS + Tailwind (CDN) — single HTML file  |

No build step. No frontend framework. No database.

---

## Requirements

- A running MinIO instance (Community or Enterprise Edition)
- MinIO root credentials (access key + secret key)
- Docker + Docker Compose (for deployment)
- The target MinIO container must be reachable on the same Docker network

---

## Environment variables

| Variable            | Required | Default | Description                                            |
| ------------------- | -------- | ------- | ------------------------------------------------------ |
| `PORT`              | no       | `3000`  | Port the panel listens on                              |
| `ADMIN_USER`        | **yes**  | —       | Basic Auth username                                    |
| `ADMIN_PASS`        | **yes**  | —       | Basic Auth password                                    |
| `MINIO_ENDPOINT`    | **yes**  | —       | MinIO host (e.g. `minio` on internal Docker network)   |
| `MINIO_PORT`        | no       | `9000`  | MinIO API port                                         |
| `MINIO_USE_SSL`     | no       | `false` | Use `true` if MinIO is behind HTTPS                    |
| `MINIO_ACCESS_KEY`  | **yes**  | —       | MinIO access key (root or a user with admin rights)    |
| `MINIO_SECRET_KEY`  | **yes**  | —       | MinIO secret key                                       |

---

## Local development

```bash
# Clone
git clone https://github.com/rdehnhardt/minio-admin.git
cd minio-admin

# Install
npm install

# Export env vars (or use a .env loader)
export ADMIN_USER=admin
export ADMIN_PASS=secret
export MINIO_ENDPOINT=localhost
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin

# Run
npm start
```

Open [http://localhost:3000](http://localhost:3000) and authenticate.

---

## Deploy with Docker Compose

The included `docker-compose.yaml` expects your MinIO to already be running on an existing Docker network.

### 1. Find your MinIO network name

```bash
docker inspect <minio-container-name> \
  --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
```

### 2. Update `docker-compose.yaml`

Replace the `networks` section with your actual network names:

```yaml
networks:
  minio-network:
    name: <your-minio-network>   # <-- network where MinIO is running
    external: true
  coolify:
    external: true               # <-- only if deploying through Coolify
```

### 3. Deploy

```bash
docker compose up -d
```

The panel will be accessible on port `3000` by default. Put a reverse proxy (Traefik, Caddy, Nginx) in front to expose it publicly with TLS.

---

## Deploy on Coolify

1. Go to your project → **+ New** → **Public Repository**
2. Paste the repo URL and choose **Docker Compose** as the build pack
3. Fill in the environment variables when prompted
4. Add a domain (Coolify handles TLS via Let's Encrypt automatically)
5. Deploy

The panel will join both the MinIO network (to reach the MinIO API) and the Coolify proxy network (to be reachable by Traefik).

---

## API reference

All endpoints require HTTP Basic Auth.

| Method   | Path                                          | Description                              |
| -------- | --------------------------------------------- | ---------------------------------------- |
| `GET`    | `/api/buckets`                                | List all buckets with their policy level |
| `POST`   | `/api/buckets`                                | Create a bucket — body: `{ "name": "" }` |
| `DELETE` | `/api/buckets/:name?force=true`               | Delete a bucket (force removes objects)  |
| `PUT`    | `/api/buckets/:name/policy`                   | Set policy — body: `{ "level": "..." }`  |
| `GET`    | `/api/buckets/:name/objects`                  | List objects (optional `?prefix=`)       |
| `POST`   | `/api/buckets/:name/objects`                  | Upload a file (multipart, field `file`)  |
| `DELETE` | `/api/buckets/:name/objects/*`                | Delete an object by key                  |

### Policy levels

| Level      | Anonymous GET | Anonymous PUT/DELETE |
| ---------- | ------------- | -------------------- |
| `none`     | ❌            | ❌                   |
| `download` | ✅            | ❌                   |
| `upload`   | ❌            | ✅                   |
| `public`   | ✅            | ✅                   |

> **Note:** Authenticated requests (with access key + secret key) always have full access, regardless of the anonymous policy. The policies above only affect unauthenticated access.

---

## Security notes

- **Always deploy behind HTTPS.** Basic Auth sends credentials in plain text over HTTP.
- **Use a strong password** for `ADMIN_PASS` — at minimum 20 characters, randomly generated.
- **Never use `public` policy** for buckets containing sensitive data. `public` allows anyone on the internet to upload and delete objects.
- Consider putting the panel behind additional protection layers such as [Cloudflare Access](https://www.cloudflare.com/zero-trust/products/access/) or an IP allowlist.
- The MinIO access key used by the panel has full administrative privileges — treat it as a root credential.

---

## License

MIT