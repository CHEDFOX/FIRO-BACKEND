# Deploying Firo to a Hostinger VPS

Step-by-step for a fresh Ubuntu VPS. Assumes you have the VPS IP and root SSH
access from the Hostinger panel.

> **Before you start — read this.** All data is still in memory. Every restart
> or redeploy wipes every account, save and taste profile, and you must run
> **exactly one instance**. That is fine for testing the flow and developing the
> app against a real URL; it is not fine for real users. Postgres is the next
> backend task.

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

## 5. Build and run

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

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF

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
| Container exits instantly | `docker logs firo-api` — almost always a bad/missing `JWT_SECRET` (min 16 chars). Config is validated at startup and fails loudly on purpose. |
| 502 from nginx | Container not running, or not bound to `127.0.0.1:3000`. Check `docker ps`. |
| CORS errors in the browser | `CORS_ORIGINS` must include your web origin exactly, scheme included. |
| Users randomly logged out | More than one container running. In-memory state is per-instance — run exactly one. |
| Everything reset | Expected: a restart clears memory. This is the reason to add Postgres next. |
| `docker: permission denied` | You skipped `newgrp docker` / re-login after `usermod -aG docker`. |

## Handy commands

```bash
docker logs -f firo-api          # follow logs
docker restart firo-api          # restart (clears data)
docker stats firo-api            # CPU / memory
sudo systemctl reload nginx      # after nginx config changes
```
