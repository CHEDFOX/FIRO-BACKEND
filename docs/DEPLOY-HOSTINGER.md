# Deploying Firo to a Hostinger VPS

Step-by-step for a fresh Ubuntu VPS. Assumes you have the VPS IP and root SSH
access from the Hostinger panel.

> **Use `docker compose`, not a bare `docker run`.** The stack is now an API
> *plus* a PostgreSQL database, and compose wires them together with a
> persistent volume so data survives restarts and redeploys. See
> [§5a](#5a-running-with-postgres-recommended).

---

## 1. Connect and secure the box

```bash
ssh root@YOUR_VPS_IP
```

Create a non-root user (do not run the app as root):

```bash
adduser firo
usermod -aG sudo firo
rsync --archive --chown=firo:firo ~/.ssh /home/firo    # copy your SSH key over
```

Basic firewall — open only SSH, HTTP and HTTPS. The app's port 3000 stays
closed to the internet; nginx reaches it locally.

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

Reconnect as the new user: `ssh firo@YOUR_VPS_IP`

---

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker          # or log out and back in
docker --version
```

---

## 3. Get the code

The branch is `claude/travel-discovery-platform-design-zr3jmi`.

```bash
cd ~
git clone https://github.com/chedfox/firo-backend.git
cd firo-backend
git checkout claude/travel-discovery-platform-design-zr3jmi
```

*(Private repo? Create a GitHub personal access token and clone with
`https://USERNAME:TOKEN@github.com/chedfox/firo-backend.git`, or add a deploy key.)*

---

## 4. Create the environment file

Generate a real secret — never reuse the development placeholder:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" 2>/dev/null \
  || openssl rand -base64 48 | tr -d '\n='
```

```bash
cat > ~/firo-backend/.env <<'EOF'
NODE_ENV=production
PORT=3000
JWT_SECRET=PASTE_THE_GENERATED_SECRET_HERE
JWT_ISSUER=firo.auth
JWT_AUDIENCE=firo.api
API_BASE_URL=https://api.yourdomain.com
CORS_ORIGINS=*
LOG_LEVEL=info
EOF

chmod 600 ~/firo-backend/.env
```

`CORS_ORIGINS=*` is fine while you develop locally. **Tighten it** to your real
web origin before anyone else uses it.

`.env` is gitignored — it must never be committed.

---

## 5a. Running with Postgres (recommended)

Add the database settings to `.env`:

```bash
cat >> ~/firo-backend/.env <<'EOF'
POSTGRES_USER=firo
POSTGRES_PASSWORD=PASTE_A_LONG_RANDOM_PASSWORD
POSTGRES_DB=firo
EOF
```

Generate that password the same way as the JWT secret:

```bash
openssl rand -base64 32 | tr -d '\n='
```

Start both containers, then load the catalogue:

```bash
cd ~/firo-backend
docker compose up -d --build
docker compose exec api node dist/infrastructure/database/seed.js
```

Check it:

```bash
docker compose ps
docker compose logs api --tail 20      # expect "connected to PostgreSQL"
curl -s http://127.0.0.1:3000/health
curl -s "http://127.0.0.1:3000/v1/experiences?limit=2"
```

The API applies any pending migrations automatically at startup, so a redeploy
needs no manual schema step. **Seeding is only needed once** (and again after
you edit the catalogue — it upserts, so re-running is safe).

### Redeploying

```bash
cd ~/firo-backend && git pull
docker compose up -d --build
```

Data is kept in the `firo-db-data` volume and survives this.

> `docker compose down -v` **deletes that volume and every account, save and
> taste profile with it.** Plain `docker compose down` is safe.

### Getting into the admin console

The console needs an account with the `admin` role, and there is no way to grant
it over HTTP. Either set it before you register:

```bash
echo 'ADMIN_EMAILS=you@yourdomain.com' >> ~/firo-backend/.env
docker compose up -d      # picks up the new variable
# now register that email through the API or the web client
```

…or promote an account that already exists:

```bash
docker compose exec api node dist/infrastructure/database/grant-admin.js you@yourdomain.com
```

Then run the console **on your own machine**, pointed at this server — it is a
static folder in the frontend repo and should not be deployed publicly:

```bash
cd firo-frontend/admin && python3 -m http.server 4111
```

Full details in [ADMIN-CONSOLE.md](ADMIN-CONSOLE.md).

---

### Backups

Now that there is a database, set up the backup system —
see [BACKUPS.md](BACKUPS.md):

```bash
sudo ./scripts/backup-setup.sh
```

### Photographs

Images are stored on this VPS and served by nginx (see
[ADR-0011](adr/0011-images-on-the-vps.md)). Before uploading anything, set the
public prefix — **it is written into the database when a photo is attached to a
card, so changing it later breaks every existing image**:

```bash
cat >> ~/firo-backend/.env <<'EOF'
MEDIA_BASE_URL=https://api.yourdomain.com/media
EOF
docker compose up -d
```

No domain yet? Leave it empty; the API then serves images itself at
`http://YOUR_VPS_IP:3000/media/...`. Set it properly before you upload real
content.

Then upload through the console (Content → New experience → Photograph). The
API resizes to 400/800/1600px WebP, samples the dominant colour for the
loading placeholder, and refuses anything under 800×600 or below the free-disk
floor.

**Put Cloudflare in front.** The free plan caches these images at the edge
worldwide, which is the one real thing object storage would have bought. Add
the domain to Cloudflare, proxy the `api` record (orange cloud), and the
immutable cache headers do the rest.

```bash
# Check nginx is serving images itself rather than proxying to Node:
curl -sI https://api.yourdomain.com/media/  # 403 or 404 from nginx, not a JSON envelope
# Disk use:
docker system df -v | grep firo-media-data
```

> Images are **not** in the nightly database dump — they are synced separately
> to the same off-site remote. `backup-setup.sh` writes `MEDIA_DIR` into
> `/etc/firo-backup.env` for that. If you moved the volume, fix it there.

---

## 5. Build and run (API only, no database)

> Only for a quick smoke test. Without `DATABASE_URL` the API stores everything
> in memory and loses it on restart, and you must run exactly one instance.

```bash
cd ~/firo-backend
docker build -t firo-backend:latest .

docker run -d \
  --name firo-api \
  --env-file .env \
  -p 127.0.0.1:3000:3000 \
  --restart unless-stopped \
  firo-backend:latest
```

`127.0.0.1:3000:3000` binds to localhost only, so the API is not directly
exposed — nginx will front it.

Check it:

```bash
docker ps
docker logs firo-api --tail 30
curl -s http://127.0.0.1:3000/health
```

You should see `{"status":"ok","service":"firo-backend",...}`.

---

## 6. Put nginx in front (with HTTPS)

Point an A record for `api.yourdomain.com` at your VPS IP first, then:

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
```

```bash
sudo tee /etc/nginx/sites-available/firo <<'EOF'
server {
    listen 80;
    server_name api.yourdomain.com;

    # Admin image uploads. The API caps each file itself; nginx has to be told
    # separately or it rejects the body with a 413 before the app ever sees it.
    client_max_body_size 30m;

    # Photographs, served straight off disk. Node never touches an image byte:
    # nginx does this with a fraction of the memory and CPU.
    #
    # The paths are content-addressed, so the contents behind a URL can never
    # change — which is what makes a one-year immutable cache honest rather
    # than a bug waiting to happen.
    location /media/ {
        alias /var/lib/docker/volumes/firo-media-data/_data/;
        access_log off;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header Access-Control-Allow-Origin "*";
        # A missing file is a missing file — do not fall through to the API,
        # which would put Node back in the path of every 404.
        try_files $uri =404;
    }

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        # The live admin stream is Server-Sent Events: buffering it would hold
        # every event until the connection closed.
        proxy_buffering    off;
    }
}
EOF

# nginx runs as www-data and needs to traverse into the Docker volume.
sudo chmod o+x /var/lib/docker /var/lib/docker/volumes

sudo ln -sf /etc/nginx/sites-available/firo /etc/nginx/sites-enabled/firo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Add TLS (certbot edits the config and sets up auto-renewal):

```bash
sudo certbot --nginx -d api.yourdomain.com
```

Verify from your own machine:

```bash
curl -s https://api.yourdomain.com/health
```

**No domain yet?** Skip nginx/certbot, publish the port directly with
`-p 3000:3000`, and use `http://YOUR_VPS_IP:3000`. Browsers will warn about the
insecure origin, so treat it as temporary.

---

## 7. Redeploying after changes

```bash
cd ~/firo-backend
git pull
docker build -t firo-backend:latest .
docker stop firo-api && docker rm firo-api
docker run -d --name firo-api --env-file .env \
  -p 127.0.0.1:3000:3000 --restart unless-stopped firo-backend:latest
```

Save it as `~/deploy.sh` and `chmod +x` it.

Remember: **every redeploy wipes all data** until Postgres exists.

---

## 8. Smoke-test the whole journey

```bash
BASE=https://api.yourdomain.com

curl -fsS $BASE/health
curl -fsS "$BASE/v1/experiences?limit=3"
curl -fsS $BASE/v1/onboarding

TOKEN=$(curl -fsS -X POST $BASE/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@firo.app","password":"sup3r-secret-pw","handle":"smoke"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.tokens.accessToken")

curl -fsS -X POST $BASE/v1/onboarding/answers \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"answers":[{"stepId":"pull","selectedOptionIds":["cold_quiet"]}]}'

curl -fsS "$BASE/v1/feed?limit=3" -H "authorization: Bearer $TOKEN"
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Build fails: `ERR_PNPM_IGNORED_BUILDS` | Fixed. `package.json` now pins `"packageManager": "pnpm@10.33.0"`, so corepack installs the tested version instead of the newest. pnpm 12 treats a skipped install script as a fatal error; pnpm 10 does not. If you ever hit it again on a newer pnpm, add `dangerouslyAllowAllBuilds: true` to `pnpm-workspace.yaml` — but understand it lets *every* dependency run install scripts, so prefer keeping the pin. |
| Container exits instantly | `docker logs firo-api` — almost always a bad/missing `JWT_SECRET` (min 16 chars). Config is validated at startup and fails loudly on purpose. |
| 502 from nginx | Container not running, or not bound to `127.0.0.1:3000`. Check `docker ps`. |
| CORS errors in the browser | `CORS_ORIGINS` must include your web origin exactly, scheme included. |
| Users randomly logged out | More than one container running. In-memory state is per-instance — run exactly one. |
| Everything reset | You are running without `DATABASE_URL` (§5, not §5a). Switch to `docker compose`. |
| `403 auth.insufficient_role` on the console | The account has no `admin` role, or its token predates the promotion — sign out and in again (tokens last 15 minutes). |
| `413` when uploading an image | nginx's `client_max_body_size`, not the API. Raise it in the server block and reload. |
| Images 404 through nginx but work on `:3000` | nginx cannot traverse into the Docker volume: `sudo chmod o+x /var/lib/docker /var/lib/docker/volumes`. Check the `alias` path matches `docker volume inspect firo-media-data`. |
| `media.disk_full` on upload | Genuinely low disk. Uploads stop before Postgres runs out of room — that is deliberate. Free space, or lower `MEDIA_MIN_FREE_BYTES` knowing what it protects. |
| Uploads work, images break after a domain change | `MEDIA_BASE_URL` is baked into stored URLs. Fix the old rows in `catalog.experiences.media`, or keep the old host answering. |
| Build fails on `SHARP IS BROKEN IN THIS IMAGE` | The image check did its job: sharp's binary does not match the platform. Rebuild without cache (`docker compose build --no-cache api`); the Alpine (musl) binaries must be in `pnpm-lock.yaml`. |
| `docker: permission denied` | You skipped `newgrp docker` / re-login after `usermod -aG docker`. |

## Handy commands

```bash
docker logs -f firo-api          # follow logs
docker restart firo-api          # restart (clears data)
docker stats firo-api            # CPU / memory
sudo systemctl reload nginx      # after nginx config changes
```
