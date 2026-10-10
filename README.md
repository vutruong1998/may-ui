# May UI

A web console for [May](https://github.com/vutruong1998/may), the local AWS-compatible
cloud emulator. It talks to May directly from the browser using the AWS SDK for JavaScript.

Covers S3, SQS, DynamoDB, IAM, STS, EC2, RDS and CloudWatch Logs.

## Quick start

Start May on `http://localhost:4566`, then:

```bash
npm install
npm run dev        # http://localhost:5173
```

## Configuration

The endpoint, region and credentials can be changed on the Settings page and are saved in
the browser. Defaults: `http://localhost:4566`, `us-east-1`, `test` / `test`.

To change the default endpoint at build time, set `VITE_MAY_ENDPOINT`:

```bash
VITE_MAY_ENDPOINT=http://may.local:4566 npm run build   # output in dist/
```

## Scripts

| Command | |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the built app |
| `npm run lint` | Lint with Oxlint |
