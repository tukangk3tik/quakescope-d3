# QuakeScope 3D

An interactive Earth observatory built with React, React Three Fiber, r3f-globe, Three.js, Zustand, TanStack Query, Tailwind, and Go/chi. Real provider data only; no runtime fixtures.

## Tech stack

Versions below describe the current manifests; `web/package-lock.json` pins the installed frontend dependencies. Use `npm ci` to reproduce them.

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React 19, TypeScript 7, Vite 7 | Client UI and production static build |
| 3D | Three.js 0.187, React Three Fiber 9, drei 10, r3f-globe 1.6 | Earth, markers, controls, and camera |
| UI / state | Tailwind CSS 4, Zustand 5, TanStack Query 5 | Styles, explorer state, and API fetching |
| Backend | Go 1.24+, chi 5, standard `net/http` | API and background provider polling |
| Data | USGS GeoJSON and BMKG open data | Real earthquake events; no API keys required |
| Storage | Concurrency-safe process memory | Latest successful provider snapshots; cleared on restart |
| Tests | Go testing/race detector, Vitest 5, jsdom | Unit and integration checks |
| Delivery | GitHub Actions, SSH/SCP, systemd, nginx | Tested artifacts and production rollout |

The production server runs the compiled Go executable and nginx. Node, npm, Go, Docker, a database, and Redis are not required on that server when deploying CI artifacts. A WebGL-capable browser renders the globe on the user's device.

## Run locally

Requires Go 1.24+ and Node 22.22.2+ on the Node 22 line (or another version supported by the locked dependencies). CI uses Node 22; the jsdom test dependency determines this minimum.

```sh
cd server
go run ./cmd/server
```

In another terminal:

```sh
cd web
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to `127.0.0.1:8081`. The backend defaults to that address; override with `LISTEN_ADDR` and update the Vite proxy if needed. Initial synchronization takes a few seconds. No environment file is required.

## Verify and build

```sh
cd server
go test -race ./...
go vet ./...
go build ./cmd/server
```

```sh
cd web
npm test
npm run typecheck
npm run build
```

Serve `web/dist` through a static web server and reverse proxy `/api` to Go for deployment. Vite development proxy is not a production server.

## Architecture and data

The single Go process runs one polling goroutine per provider every four minutes. Adapters normalize bounded HTTP responses; a mutex protects atomic provider snapshots. If any feed in a provider poll fails, that provider retains its previous successful snapshot and reports the error. Restarting clears memory. HTTP client timeouts, request cancellation, response size limits, and graceful shutdown are included.

Time Machine requests are separate from live polling. The backend queries the USGS FDSN catalog for at most 31 days and 1,500 returned events, checks the catalog count endpoint for truncation, and keeps successful query results in a concurrency-safe five-minute memory cache. The cache holds at most 256 results, drops entries that have expired, then evicts the entry closest to expiry, because every distinct range and filter combination is a new key supplied by the client. The frontend cancels obsolete range requests, sorts by UTC occurrence time and stable event ID, and uses a single frame-delta playback loop plus binary search to reveal accumulated events. At 1×, the selected historical range is visualized in two minutes; 5× and 10× are visualization multipliers rather than wall-clock simulation rates.

- `GET /api/v1/earthquakes?source=usgs&timeRange=24h&minMagnitude=2.5&limit=1000` returns events, matching totals, truncation, filters, and provider freshness.
- `GET /api/v1/earthquakes/history?start=2026-11-01T00:00:00Z&end=2026-11-08T00:00:00Z&minMagnitude=4&limit=1500` returns chronological USGS catalog events, attribution, totals, and an explicit truncation warning.
- `GET /api/v1/sources/status` returns provider sync timestamps, stale state, and errors.
- `GET /api/v1/health` reports process health (not upstream availability).

Filtering uses occurrence timestamps in UTC. Invalid filters return 400. Results are newest first, capped at 1000. Summaries describe displayed records. Source status becomes stale on failure or after ten minutes without success.

[USGS GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/) supply magnitude 2.5 day and week records for Live Mode. The [USGS FDSN Event Web Service](https://earthquake.usgs.gov/fdsnws/event/1/) supplies historical Time Machine queries. Coordinates are longitude, latitude, depth. USGS event IDs and source links are preserved. The tsunami flag retains its USGS meaning and is not presented as a warning.

[BMKG open data](https://data.bmkg.go.id/gempabumi/) supplies `autogempa.json`, `gempaterkini.json`, and `gempadirasakan.json`. Coordinates are latitude, longitude; ISO DateTime values normalize to UTC. BMKG provides latest, M5+, and felt categories with limited recent records, not exhaustive 24-hour or seven-day coverage. Polling uses three requests per four minutes, below its documented 60/minute limit. BMKG timestamps provide the within-provider event identity because these feeds lack a stable event ID; simultaneous distinct events cannot be distinguished. Original felt and potential-tsunami text is preserved. No cross-provider deduplication is attempted.

Frontend query state is separate from Zustand interaction state. The R3F scene remains mounted when filters change. Orbit controls support mouse/touch, idle rotation, reset, and spherical camera fly-to paths. Surface markers use magnitude for radius and depth for color: amber below 70 km, coral from 70 to below 300 km, violet at 300 km or deeper. The DOM event list provides keyboard selection. The detail panel can collapse through its summary, including on mobile.

Dynamic Day/Night is enabled by default and extends the existing persistent globe material with one shader program; it does not add another Earth mesh or replace the scene. A deterministic NOAA/Meeus-style solar calculation converts the active UTC timestamp into an Earth-fixed subsolar latitude/longitude and then into the application's existing `[x, y, z]` geographic convention. Camera orbit and visual auto-rotation therefore do not move the terminator geographically. Live Mode samples current UTC every 30 seconds. Time Machine uses its existing simulated timestamp, so seeking updates illumination, pausing freezes it, and returning to Live restores current illumination.

The fragment shader blends the existing Blue Marble map into a subdued night geography and a locally bundled Black Marble composite using surface-normal solar incidence and a soft terminator. City Lights can be disabled independently; its preference remains selected but is visibly inactive while Dynamic Day/Night is off. Earth Interior / X-Ray temporarily bypasses day/night blending while retaining both preferences, then restores it when X-Ray closes. Textures and the material are cached, only uniforms change during normal use, and no texture uploads or material recreation occur per frame. The night map is a static 2016 cloud-free satellite composite, not live electricity consumption data.

The optional tectonic layer renders PB2002 boundary LineString and MultiLineString features through the existing globe's spherical path renderer. Coordinates are validated before use, paths sit slightly above the surface to prevent z-fighting, and boundaries remain pickable for their available plate, type, and source metadata. PB2002 is a published geological model, not a real-time measurement of plate motion.

The optional Earth Interior / X-Ray layer uses the selected event's existing latitude/longitude axes and the 6,371 km mean Earth radius to place its hypocenter radially beneath the epicenter. True scale uses `globeRadius × (1 - depthKm / 6371)`. Enhanced mode applies an 8× visual-only depth exaggeration, clamps at Earth's center, and is explicitly labeled “not to scale”; the reported provider depth is never changed. Missing, negative, non-finite, or deeper-than-radius values remain visible in event details but do not produce invented geometry. Depth categories are informational, not risk predictions. X-Ray mode fades the existing globe material and restores it when disabled; it does not create another globe or alter Time Machine playback.

The optional Equator layer is generated locally at latitude 0° with a closed 180-segment path using the same coordinate conversion as earthquake markers. It sits slightly above the globe to avoid z-fighting, remains depth-occluded on the far side, and is off by default. Equator, tectonic boundaries, and Earth Interior visibility are independent and do not reset the camera.

## Attribution

Earth daytime imagery: NASA Visible Earth / Blue Marble, distributed as the equirectangular `2_no_clouds_4k.jpg` from [webgl-earth](https://github.com/turban/webgl-earth/tree/master/images). Nighttime city-light imagery: NASA Earth Observatory, [Black Marble 2016 global 0.1-degree color composite](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/), downloaded as `BlackMarble_2016_01deg.jpg` (3600×1800) and bundled as `earth-night.jpg`. Both are static composites. NASA imagery usage guidance: https://www.nasa.gov/nasa-brand-center/images-and-media/. No NASA affiliation is implied. Earthquake information: USGS and BMKG (Badan Meteorologi, Klimatologi, dan Geofisika).

Tectonic boundaries: the locally bundled `PB2002_boundaries.json` from [fraxen/tectonicplates](https://github.com/fraxen/tectonicplates), based on Peter Bird (2003), “An updated digital model of plate boundaries,” Geochemistry, Geophysics, Geosystems. The dataset publication is dated 2003 and the repository distributes the collection under the [Open Data Commons Attribution License 1.0](https://opendatacommons.org/licenses/by/1.0/). Dataset snapshot: upstream commit `339b0c56563c118307b1f4542703047f5f698fae`.

Data may be delayed or revised. This application is not an official earthquake early-warning system.

## Verification limits and follow-up

Automated checks cover coordinate axes, marker encodings, interaction store updates, parsers, UTC normalization, malformed records, filtering, deduplication, upstream errors, and stale-cache preservation. Live API synchronization was checked for both providers. Browser rendering, touch gestures, and actual GPU frame rate could not be checked because no browser was available in the implementation session. Test those on desktop and mobile before release.

The globe dependency creates a large JavaScript bundle; measured build output warns about chunk size. Next work: browser interaction tests, device profiling and marker batching if needed, plus a smaller globe dependency bundle. No lint configuration is included; TypeScript and `go vet` provide static checks.

## CI/CD

See [pipeline and production setup](deploy/README.md) for unit/integration stages, build artifacts, production-only deployment, tag-only releases, and required production secrets.

| Git event | Result |
| --- | --- |
| Pull request to `main` | Unit tests → integration tests/build gates; no deployment or release |
| Push / merge to `main` | Tests → build → SSH deployment to `prod` |
| Manually push `vMAJOR.MINOR.PATCH` | Tests → build → GitHub Release; no deployment |
| Manual workflow run | Tests and build only |

Unit and integration jobs run in parallel; build waits for both. Main pushes never create tags or releases. Tag creation remains manual.

## Production server configuration

This guide targets **Ubuntu 24.04 LTS, x86_64 / amd64**, using systemd and nginx. The CI artifact is Linux amd64; ARM servers require a different build target. Commands marked **server** run through your existing administrator SSH login. Commands marked **workstation** run from this repository on your computer. Replace `SERVER_IP`, `ADMIN`, and `quakescope.example.com` with your values.

### 1. Prepare packages, network, and users (server)

```sh
uname -m  # must print x86_64 for the current CI artifact
sudo apt-get update
sudo apt-get install -y nginx openssh-server curl ca-certificates tar coreutils util-linux sudo
sudo systemctl enable --now nginx

sudo adduser --disabled-password --gecos '' deploy-quakescope
sudo useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin quakescope
sudo install -d -o deploy-quakescope -g deploy-quakescope -m 755 /opt/quakescope
sudo install -d -o deploy-quakescope -g deploy-quakescope -m 755 /opt/quakescope/releases
sudo install -d -o deploy-quakescope -g deploy-quakescope -m 700 /home/deploy-quakescope/.ssh
```

These user-creation commands are for first setup; skip them if the accounts already exist. Allow inbound TCP **22** (SSH), **80** (HTTP/certificate validation), and **443** (HTTPS) in your provider firewall and any existing host firewall. Do not expose port 8081. GitHub-hosted deployment runners must be able to reach SSH; an IP-restricted firewall needs an appropriate runner/network arrangement. Allow outbound DNS and HTTPS to `earthquake.usgs.gov` and `data.bmkg.go.id` for polling.

Point your domain's DNS A record at the server. Configure an AAAA record only if IPv6 access is actually working.

### 2. Create the deployment SSH key (workstation)

```sh
ssh-keygen -t ed25519 -f ~/.ssh/quakescope-prod -C 'quakescope-github-actions' -N ''
scp ~/.ssh/quakescope-prod.pub ADMIN@SERVER_IP:/tmp/quakescope-prod.pub
```

Use a new dedicated key path; do not overwrite an existing key. The unattended workflow uses this key without a passphrase. On the **server**, install only its public key:

```sh
sudo install -o deploy-quakescope -g deploy-quakescope -m 600 \
  /tmp/quakescope-prod.pub /home/deploy-quakescope/.ssh/authorized_keys
rm /tmp/quakescope-prod.pub
```

For an account with existing authorized keys, append the new public key instead of replacing the file. Test from the **workstation**:

```sh
ssh -i ~/.ssh/quakescope-prod deploy-quakescope@SERVER_IP 'id && test -w /opt/quakescope'
```

Ubuntu's [OpenSSH guide](https://ubuntu.com/server/docs/how-to/security/openssh-server/) explains key authentication and file permissions.

### 3. Install the API service and nginx configuration

From a **workstation checkout containing the `deploy/` files**, copy the templates using your administrator login. For first setup before the CI/CD PR is merged, use that PR's checkout:

```sh
scp deploy/quakescope.service deploy/nginx.conf ADMIN@SERVER_IP:/tmp/
```

On the **server**:

```sh
sudo install -m 644 /tmp/quakescope.service /etc/systemd/system/quakescope.service
sudo systemctl daemon-reload
sudo systemctl enable quakescope

command -v systemctl  # expected /usr/bin/systemctl on this Ubuntu setup
sudo visudo -f /etc/sudoers.d/quakescope-deploy
```

Add this single sudoers line, matching the absolute `systemctl` path printed above:

```sudoers
deploy-quakescope ALL=(root) NOPASSWD: /usr/bin/systemctl restart quakescope, /usr/bin/systemctl stop quakescope
```

Then continue on the **server**:

```sh
sudo chmod 440 /etc/sudoers.d/quakescope-deploy
sudo visudo -cf /etc/sudoers.d/quakescope-deploy
sudo install -m 644 /tmp/nginx.conf /etc/nginx/sites-available/quakescope
sudo sed -i 's/quakescope.example.com/YOUR_REAL_DOMAIN/g' /etc/nginx/sites-available/quakescope
sudo ln -s /etc/nginx/sites-available/quakescope /etc/nginx/sites-enabled/quakescope
sudo nginx -t
sudo systemctl reload nginx
```

Replace `YOUR_REAL_DOMAIN` before running the substitution. Skip the symlink command if the site is already enabled. Keep other nginx sites intact. The service is enabled but should **not be started yet**: the first deployment supplies `/opt/quakescope/current/quakescope` and starts it. The site will not serve the application until that deployment finishes.

The request path is:

```text
Browser → nginx :443 → /                 → /opt/quakescope/current/web
                    → /api/v1/*          → Go at 127.0.0.1:8081
```

The nginx [`proxy_pass` configuration](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass) preserves the `/api/` path. Keep its upstream port aligned with the service and deployment health check.

### 4. Configure GitHub production secrets (workstation / GitHub)

Open repository **Settings → Environments → prod**. The environment is already created with a `main` branch restriction. Add:

| Environment secret | Value |
| --- | --- |
| `PROD_HOST` | Server IPv4 address or DNS name; no `https://`, path, or port |
| `PROD_USER` | `deploy-quakescope` |
| `PROD_SSH_KEY` | Complete private key from `~/.ssh/quakescope-prod`, including BEGIN/END lines |
| `PROD_KNOWN_HOSTS` | Verified SSH host entry matching exactly the host used in `PROD_HOST` |

For the host key, obtain its fingerprint from the **server administrator console**:

```sh
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

On the **workstation**, collect the candidate and compare its fingerprint with the trusted console output before saving it:

```sh
ssh-keyscan -t ed25519 SERVER_IP > /tmp/quakescope-known-hosts
ssh-keygen -lf /tmp/quakescope-known-hosts
# After fingerprints match:
gh secret set PROD_HOST --env prod --body 'SERVER_IP'
gh secret set PROD_USER --env prod --body 'deploy-quakescope'
gh secret set PROD_SSH_KEY --env prod < ~/.ssh/quakescope-prod
gh secret set PROD_KNOWN_HOSTS --env prod < /tmp/quakescope-known-hosts
```

Run `gh` commands from this repository with your authenticated GitHub account. If using a DNS name in `PROD_HOST`, use that same DNS name for `ssh-keyscan`. Private keys and secrets must not be committed to Git.

### 5. Deploy, enable HTTPS, and verify

Once the server and secrets are ready, merge the CI/CD PR into `main` (or push a subsequent approved change to `main`). GitHub Actions tests, builds, copies the artifact, verifies checksums, changes the `current` symlink, restarts the API, and checks its health. Manual workflow dispatch does not deploy.

On the **server**, after the deployment succeeds:

```sh
sudo systemctl status quakescope --no-pager
curl --fail http://127.0.0.1:8081/api/v1/health
curl --fail http://quakescope.example.com/api/v1/health
```

Use your actual domain. Both health requests should return `{"status":"ok"}`. Install Certbot using its [official nginx instructions](https://certbot.eff.org/instructions?ws=nginx&os=pip), then request HTTPS and verify renewal:

```sh
sudo certbot --nginx -d quakescope.example.com --redirect
sudo certbot renew --dry-run
curl --fail https://quakescope.example.com/api/v1/health
curl --fail https://quakescope.example.com/api/v1/sources/status
```

Open the site and verify the globe and event list. Provider synchronization can take a few seconds after a restart; process health does not guarantee upstream availability. The rollout includes a brief backend restart and attempts rollback on failed health checks. Old releases are retained under `/opt/quakescope/releases`; monitor disk space and retain at least the current and previous release when cleaning up.

### Runtime settings and file locations

| Setting / path | Current value / role |
| --- | --- |
| `LISTEN_ADDR` | `127.0.0.1:8081`, set in `/etc/systemd/system/quakescope.service` |
| SSH endpoint | Port 22; the current deployment script does not support a custom port |
| Active release | `/opt/quakescope/current` symlink |
| Release files | `/opt/quakescope/releases/<commit-sha>/quakescope` and `web/` |
| nginx site | `/etc/nginx/sites-available/quakescope` |
| Service logs | `sudo journalctl -u quakescope -n 100 --no-pager` |
| nginx logs | `/var/log/nginx/error.log` and `/var/log/nginx/access.log` |
| Poll interval | Four minutes; currently fixed in Go code |
| Provider credentials | None |

There is no production `.env` loader, frontend API URL variable, or database configuration. The frontend calls same-origin `/api`; nginx forwards it. To change port 8081, update the service's `LISTEN_ADDR`, nginx upstream, and `deploy/activate.sh` health URL together, then reload systemd/nginx. To change the port for local development, also change the Vite proxy.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| SSH authentication fails | Secret contains the matching private key; public key is in the deploy account's authorized_keys; directory/file modes are 700/600; port 22 is reachable |
| Host key verification fails | `PROD_KNOWN_HOSTS` matches `PROD_HOST`; verify host identity before updating the secret |
| `sudo: a password is required` | Sudoers command path and deploy username match the installed host tools |
| nginx 502 | `systemctl status quakescope`, service logs, and localhost health on port 8081 |
| nginx 403 / missing assets | `current` points to a release; nginx can traverse `/opt/quakescope` and read `web/index.html` and assets |
| `Exec format error` | Host must be x86_64 for the current amd64 binary |
| Source stale / no initial events | Server DNS, outbound HTTPS, provider status endpoint, and service logs |
| Main deployment fails on missing secrets | Add all four secrets to environment `prod`, then rerun the failed main workflow |

### Create a release manually (workstation)

```sh
git switch main
git pull --ff-only
git tag -a v0.1.0 -m 'QuakeScope v0.1.0'
git push origin v0.1.0
```

Choose an unused version. A tag must point to a commit reachable from `main`; its workflow tests and builds that revision before publishing the archive and checksums. This does not deploy or create another tag.
