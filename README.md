# wanly-console

React admin dashboard for the Wanly video generation platform.

## Tech Stack

- React 19, TypeScript, Vite
- MUI v7
- React Router v7
- Zustand (state management)
- Axios (HTTP client)

## Development

```bash
cp .env.example .env
npm install
npm run dev
```

Runs on http://localhost:3000. Set `VITE_API_URL` in `.env` to point at the API (defaults to empty, which uses the nginx proxy in production).

## Deployment

Docker multi-stage build (node → nginx). Deployed via GitHub Actions → ECR → SSM to EC2.

```
console.wanly22.com:3000
```

### GitHub Actions Secrets

| Secret | Value |
|--------|-------|
| `AWS_ROLE_ARN` | `arn:aws:iam::791342033319:role/github-actions-wanly-console` |
| `EC2_INSTANCE_ID` | `i-0f3019a32eab2395e` |
