# Antarctic deployment

Deployment is server-side and does not require GitHub Actions credentials. The
server polls the public repository every minute and runs a fast-forward-only
pull when `main` changes.

The server should have this repository checked out at `/opt/Antarctic` with a
public HTTPS origin:

```bash
cd /opt/Antarctic
git remote set-url origin https://github.com/Antarctic-GS/Antarctic.git
sudo bash scripts/deploy-server.sh
```

The setup command installs and enables both the Antarctic service and the
`antarctic-repo-sync.timer`. Check the poller with:

```bash
systemctl status antarctic-repo-sync.timer
journalctl -u antarctic-repo-sync.service -n 50 --no-pager
```

The puller uses `git pull --ff-only origin main`, so local server changes are
never overwritten automatically; a non-fast-forward state is reported in the
systemd journal instead. When a new commit is pulled, it restarts the Antarctic
service so server-side routes such as `/api/captcha/challenge` are loaded.
