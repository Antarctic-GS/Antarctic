# Antarctic deployment

The GitHub Actions workflow deploys every push to `main` over SSH. Configure
these repository secrets:

- `DEPLOY_HOST`: the server hostname or IP address
- `DEPLOY_USER`: the SSH user
- `DEPLOY_SSH_KEY`: the matching private SSH key
- `DEPLOY_PORT`: optional SSH port, defaulting to `22`

The server should have this repository checked out at `/opt/Antarctic`, with
the deploy user's public key authorized for SSH access. The deploy job pulls
the latest `main` commit, installs the systemd unit, and restarts Antarctic.
