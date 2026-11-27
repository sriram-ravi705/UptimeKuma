<div align="center" width="100%">
    <img src="./public/icon.svg" width="128" alt="Uptime Kuma Logo" />
</div>

# Uptime Kuma

> [!IMPORTANT]
> **This is a customised copy of Uptime Kuma 2.5.12 with a bulk Import feature.**
> Read [About this version](#about-this-version-bulk-import) below before installing or updating.
> Do **not** run `npm run setup`: it switches back to the official version and removes the Import feature.

Uptime Kuma is an easy-to-use self-hosted monitoring tool.

## About this version (bulk import)

This repository is the official [Uptime Kuma](https://github.com/louislam/uptime-kuma) **2.5.12**
plus one change: an **Import** button next to **+ Add New Monitor** that adds many websites at once
from an Excel (`.xlsx`) or CSV file.

- **Download Excel template**: made from your Uptime Kuma, with your notification names as a dropdown and a "How to fill" sheet
- **Preview** before anything is added: each row is marked New, Already in Uptime Kuma, Duplicate in file, or Invalid (with the reason)
- Each row becomes an HTTP(s) monitor that alerts when the site goes **down**, and optionally before its **SSL certificate** or **domain** expires
- Sites that already exist are skipped, so the same file can be uploaded again after adding rows

Changed files (everything else is official 2.5.12): `src/pages/BulkImport.vue` (new), `src/util-bulk-import.js` (new),
`src/pages/Dashboard.vue`, `src/router.js`, `src/icon.js`. No new dependencies.

### Requirements

- Linux server (tested on Amazon Linux 2023) or macOS
- **Node.js 20 or 22** (not newer). Install with [nvm](https://github.com/nvm-sh/nvm): `nvm install 22`
- `git`
- At least 1 GB RAM. Building the web page needs about 1.5 GB, so on a 1 GB server either add swap or build on another machine (see step 3)

### Install (after cloning)

```bash
# 1. Get the code
git clone https://github.com/sriram-ravi705/UptimeKuma.git
cd UptimeKuma

# 2. Install the dependencies needed to run it
npm ci --omit dev
```

**3. Build the web page.** The built page (`dist/`) is not stored in git, and this version cannot use the
official pre-built page. Choose one:

- **A. Build on the server** (needs ~1.5 GB RAM, or swap):

  ```bash
  npm ci                 # also installs the build tools
  npm run build          # creates dist/  (a few minutes)
  npm ci --omit dev      # remove the build tools again
  ```

- **B. Build on your computer and copy it** (best for small servers). On your computer, in your clone of this repo:

  ```bash
  npm ci && npm run build
  scp -r dist <user>@<server>:<path-to>/UptimeKuma/
  ```

```bash
# 4. Check the database driver works (should print a version like 3.41.1)
node -e 'const s=require("@louislam/sqlite3"); new s.Database(":memory:").get("select sqlite_version() v",(e,r)=>console.log(e?e.message:r.v))'
#    If it says "Cannot find module ... node_sqlite3.node", run:  npm ci --omit dev   again

# 5. Start it with PM2 and make it start on boot
npm install -g pm2
pm2 start server/server.js --name uptime-kuma --max-memory-restart 400M
pm2 save
pm2 startup            # run the command it prints (if any)
```

**6. Open `http://<server-ip>:3001`** (allow port 3001 in your firewall / AWS security group), then:

1. Choose **SQLite** and create the admin account. Keep the password safe: there is no "forgot password".
2. **Settings → Notifications → Setup Notification**: add your alert channel (e.g. Microsoft Teams), tick **Default enabled**, click **Test**, **Save**.
3. On the same page set **TLS Certificate Expiry** days (e.g. 30 and 7) and **Save**.
4. **Settings → Monitor History**: keep history for e.g. **90** days.
5. Click **Import** → **Download Excel template**, fill in the **Domains** sheet, upload it, check the preview, **Import**.

### Where your data is

Everything (admin account, monitors, notifications, history) is in the **`data/`** folder inside this directory.
It is not in git. **Back it up before any update, move or re-install:**

```bash
pm2 stop uptime-kuma
cp -r data ~/kuma-backup-$(date +%F)
pm2 start uptime-kuma
```

> [!WARNING]
> Never delete this folder to "re-clone" it: that deletes `data/` and all your monitors with it.
> To get new code, use `git pull` (below).

### Update to a newer commit of this repository

```bash
cd UptimeKuma
cp -r data ~/kuma-backup-$(date +%F)      # backup first
git pull
npm ci --omit dev
# rebuild dist/ (step 3, option A or B)
pm2 restart uptime-kuma
```

### Roll back to official Uptime Kuma

Your data stays as it is (this version does not change the database).

```bash
git fetch https://github.com/louislam/uptime-kuma.git tag 2.5.12
git checkout 2.5.12
npm ci --omit dev && npm run download-dist
pm2 restart uptime-kuma
```

### Useful commands

| What | Command |
|---|---|
| Status | `pm2 status` |
| Logs | `pm2 logs uptime-kuma` |
| Restart | `pm2 restart uptime-kuma` |
| Stop | `pm2 stop uptime-kuma` |

### Import file columns

Only `url` is required; empty cells use the defaults shown on the Import page.

| Column | What to put |
|---|---|
| `url` | Website address. `https://` is added if missing |
| `name` | Name shown in alerts. Empty = the domain |
| `description` | Owner or notes |
| `notifications` | Notification name(s) from Uptime Kuma, comma separated. `none` = no alerts |
| `interval` | Seconds between checks, 20–86400 (recommended 60) |
| `retries` | Failed checks before a Down alert, 0–10 (recommended 2) |
| `ssl_alert` | `yes` / `no`: warn before the SSL certificate expires |
| `domain_alert` | `yes` / `no`: warn before the domain registration expires |

> [!NOTE]
> This change is for this repository only. Do not open a pull request with it to the official
> Uptime Kuma project. The rest of this README is the official Uptime Kuma README.

<a target="_blank" href="https://github.com/louislam/uptime-kuma"><img src="https://img.shields.io/github/stars/louislam/uptime-kuma?style=flat" /></a> <a target="_blank" href="https://hub.docker.com/r/louislam/uptime-kuma"><img src="https://img.shields.io/docker/pulls/louislam/uptime-kuma" /></a> <a target="_blank" href="https://hub.docker.com/r/louislam/uptime-kuma"><img src="https://img.shields.io/docker/v/louislam/uptime-kuma/2?label=docker%20image%20ver." /></a> <a target="_blank" href="https://github.com/louislam/uptime-kuma"><img src="https://img.shields.io/github/last-commit/louislam/uptime-kuma" /></a> <a target="_blank" href="https://opencollective.com/uptime-kuma"><img src="https://opencollective.com/uptime-kuma/total/badge.svg?label=Open%20Collective%20Backers&color=brightgreen" /></a>
[![GitHub Sponsors](https://img.shields.io/github/sponsors/louislam?label=GitHub%20Sponsors)](https://github.com/sponsors/louislam) <a href="https://weblate.kuma.pet/projects/uptime-kuma/uptime-kuma/">
<img src="https://weblate.kuma.pet/widgets/uptime-kuma/-/svg-badge.svg" alt="Translation status" />
</a>

<img src="https://user-images.githubusercontent.com/1336778/212262296-e6205815-ad62-488c-83ec-a5b0d0689f7c.jpg" width="700" alt="Uptime Kuma Dashboard Screenshot" />

## 🥔 Live Demo

Try it!

Demo Server (Location: Frankfurt - Germany): <https://demo.kuma.pet/start-demo>

It is a temporary live demo, all data will be deleted after 10 minutes. Sponsored by [Uptime Kuma Sponsors](https://github.com/louislam/uptime-kuma#%EF%B8%8F-sponsors).

## ⭐ Features

- Monitoring uptime for HTTP(s) / TCP / HTTP(s) Keyword / HTTP(s) Json Query / Websocket / Ping / DNS Record / Push / Steam Game Server / Docker Containers
- Fancy, Reactive, Fast UI/UX
- Notifications via Telegram, Discord, Gotify, Slack, Pushover, Email (SMTP), and [90+ notification services, click here for the full list](https://github.com/louislam/uptime-kuma/tree/master/src/components/notifications)
- 20-second intervals
- [Multi Languages](https://github.com/louislam/uptime-kuma/tree/master/src/lang)
- Multiple status pages
- Map status pages to specific domains
- Ping chart
- Certificate info
- Proxy support
- 2FA support

## 🔧 How to Install

### 🐳 Docker Compose

```bash
mkdir uptime-kuma
cd uptime-kuma
curl -o compose.yaml https://raw.githubusercontent.com/louislam/uptime-kuma/master/compose.yaml
docker compose up -d
```

Uptime Kuma is now running on all network interfaces (e.g. http://localhost:3001 or http://your-ip:3001).

> [!WARNING]
> File Systems like **NFS** (Network File System) are **NOT** supported. Please map to a local directory or volume.

### 🐳 Docker Command

```bash
docker run -d --restart=always -p 3001:3001 -v uptime-kuma:/app/data --name uptime-kuma louislam/uptime-kuma:2
```

Uptime Kuma is now running on all network interfaces (e.g. http://localhost:3001 or http://your-ip:3001).

If you want to limit exposure to localhost only:

```bash
docker run ... -p 127.0.0.1:3001:3001 ...
```

### 💪🏻 Non-Docker

Requirements:

- Platform
  - ✅ Major Linux distros such as Debian, Ubuntu, Fedora and ArchLinux etc.
  - ✅ Windows 10 (x64), Windows Server 2012 R2 (x64) or higher
  - ❌ FreeBSD / OpenBSD / NetBSD
  - ❌ Replit / Heroku
- [Node.js](https://nodejs.org/en/download/) >= 20.4
- [Git](https://git-scm.com/downloads)
- [pm2](https://pm2.keymetrics.io/) - For running Uptime Kuma in the background

```bash
git clone https://github.com/louislam/uptime-kuma.git
cd uptime-kuma
npm run setup

# Option 1. Try it
node server/server.js

# (Recommended) Option 2. Run in the background using PM2
# Install PM2 if you don't have it:
npm install pm2 -g && pm2 install pm2-logrotate

# Start Server
pm2 start server/server.js --name uptime-kuma
```

Uptime Kuma is now running on all network interfaces (e.g. http://localhost:3001 or http://your-ip:3001).

More useful PM2 Commands

```bash
# If you want to see the current console output
pm2 monit

# If you want to add it to startup
pm2 startup && pm2 save
```

### Advanced Installation

If you need more options or need to browse via a reverse proxy, please read:

<https://github.com/louislam/uptime-kuma/wiki/%F0%9F%94%A7-How-to-Install>

## 🆙 How to Update

Please read:

<https://github.com/louislam/uptime-kuma/wiki/%F0%9F%86%99-How-to-Update>

## 🆕 What's Next?

I will assign requests/issues to the next milestone.

<https://github.com/louislam/uptime-kuma/milestones>

## ❤️ Sponsors

Thank you so much! (GitHub Sponsors will be updated manually. OpenCollective sponsors will be updated automatically, the list will be cached by GitHub though. It may need some time to be updated)

<img src="https://uptime.kuma.pet/sponsors?v=6" alt="Uptime Kuma Sponsors" />

## 🖼 More Screenshots

Light Mode:

<img src="https://uptime.kuma.pet/img/light.jpg" width="512" alt="Uptime Kuma Light Mode Screenshot of how the Dashboard looks" />

Status Page:

<img src="https://user-images.githubusercontent.com/1336778/134628766-a3fe0981-0926-4285-ab46-891a21c3e4cb.png" width="512" alt="Uptime Kuma Status Page Screenshot" />

Settings Page:

<img src="https://louislam.net/uptimekuma/2.jpg" width="400" alt="Uptime Kuma Settings Page Screenshot" />

Telegram Notification Sample:

<img src="https://louislam.net/uptimekuma/3.jpg" width="400" alt="Uptime Kuma Telegram Notification Sample Screenshot" />

## Motivation

- I was looking for a self-hosted monitoring tool like "Uptime Robot", but it is hard to find a suitable one. One of the closest ones is statping. Unfortunately, it is not stable and no longer maintained.
- Wanted to build a fancy UI.
- Learn Vue 3 and vite.js.
- Show the power of Bootstrap 5.
- Try to use WebSocket with SPA instead of a REST API.
- Deploy my first Docker image to Docker Hub.

If you love this project, please consider giving it a ⭐.

## 🗣️ Discussion / Ask for Help

⚠️ For any general or technical questions, please don't send me an email, as I am unable to provide support in that manner. I will not respond if you ask questions there.

I recommend using Google, GitHub Issues, or Uptime Kuma's subreddit for finding answers to your question. If you cannot find the information you need, feel free to ask:

- [GitHub Issues](https://github.com/louislam/uptime-kuma/issues)
- [Subreddit (r/UptimeKuma)](https://www.reddit.com/r/UptimeKuma/)

My Reddit account: [u/louislamlam](https://reddit.com/u/louislamlam)
You can mention me if you ask a question on the subreddit.

## Contributions

### Create Pull Requests

Pull requests are awesome.
To keep reviews fast and effective, please make sure you’ve [read our pull request guidelines](https://github.com/louislam/uptime-kuma/blob/master/CONTRIBUTING.md#can-i-create-a-pull-request-for-uptime-kuma).

### Test Pull Requests

There are a lot of pull requests right now, but I don't have time to test them all.

If you want to help, you can check this:
<https://github.com/louislam/uptime-kuma/wiki/Test-Pull-Requests>

### Test Beta Version

Check out the latest beta release here: <https://github.com/louislam/uptime-kuma/releases>

### Bug Reports / Feature Requests

If you want to report a bug or request a new feature, feel free to open a [new issue](https://github.com/louislam/uptime-kuma/issues).

### Translations

If you want to translate Uptime Kuma into your language, please visit [Weblate Readme](https://github.com/louislam/uptime-kuma/blob/master/src/lang/README.md).

### Spelling & Grammar

Feel free to correct the grammar in the documentation or code.
My mother language is not English and my grammar is not that great.
