# SCALA Content Manager Extractor

This app extracts SCALA players, filters them, and returns a filial overview (one row per filial, with screen counts).

## Environment setup

1. Copy `.env.example` to `.env.local`.
2. Set the required values:

```env
SCALA_CM_BASE_URL=http://cm4.ddjmusic.com:8080/cm

# Option A: direct token
SCALA_CM_API_TOKEN=

# Option B: login credentials
SCALA_CM_USERNAME=
SCALA_CM_PASSWORD=

# Optional (only when login requires network selection)
SCALA_CM_NETWORK_ID=

# Optional network tuning
SCALA_CM_REQUEST_TIMEOUT_MS=30000
SCALA_CM_FORCE_IPV4=false
```

Use either `SCALA_CM_API_TOKEN` or `SCALA_CM_USERNAME` + `SCALA_CM_PASSWORD`.

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.
