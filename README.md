# Truth Social API Gateway

Next.js implementation of the functionality provided by the [`truthbrush`](https://github.com/stanfordio/truthbrush) Python client.  
The app exposes REST endpoints under `/api/*` that proxy authenticated requests to the public Truth Social API.

## Prerequisites

- Node.js 18.17+ (Next.js runtime requirement)
- npm 9+
- Truth Social credentials (username/password or a pre-generated bearer token)

## Getting Started

```bash
npm install
cp .env.example .env.local
# edit .env.local with your Truth Social credentials
npm run dev
```

By default the development server runs on `http://localhost:3000`.

## Authentication

The API client looks for the following environment variables (use `.env.local`):

- `TRUTHSOCIAL_TOKEN` – optional bearer token. If present, username/password are not required.
- `TRUTHSOCIAL_USERNAME` and `TRUTHSOCIAL_PASSWORD` – used when a token is not supplied.
- `http_proxy` / `https_proxy` – optional proxy settings, forwarded by Node’s HTTP client.

Tokens are cached in-memory for the lifetime of the server process. A 401 response triggers one automatic re-login.

## Available Endpoints

All endpoints accept `GET` requests and return JSON. Query parameters mirror the Python method signatures.

| Endpoint | Description |
| --- | --- |
| `/api/lookup?acct={handle}` | Look up a user profile by handle. |
| `/api/search?type=statuses&query=term&limit=40&resolve=true` | Perform federated searches against statuses, accounts, or hashtags. |
| `/api/hashtag?tag=TruthSocial&limit=100` | Stream posts attached to a hashtag. |
| `/api/trending?limit=10` | Fetch trending truths. |
| `/api/group-posts?groupId={id}&limit=20` | Retrieve posts inside a group timeline. |
| `/api/tags` | Fetch trending tags. |
| `/api/suggested?maximum=50` | Suggested accounts to follow. |
| `/api/trending-groups?limit=10` | Trending group truths. |
| `/api/group-tags` | Trending group tags. |
| `/api/suggested-groups?maximum=50` | Suggested groups. |
| `/api/ads?device=desktop` | Rumble ad payloads surfaced through Truth Social. |
| `/api/user-likes?post={statusUrlOrId}&top=40&includeAll=false` | List accounts that liked the given status. |
| `/api/comments?post={statusUrlOrId}&top=40&onlyFirst=false&includeAll=false` | Retrieve comments for a status. |
| `/api/user-followers?userHandle={handle}&maximum=1000&resume={maxId}` | Paginated followers listing. |
| `/api/user-following?userHandle={handle}&maximum=1000&resume={maxId}` | Paginated following listing. |
| `/api/statuses?username={handle}&replies=false&pinned=false&sinceId={id}&createdAfter={iso}` | Pull a user timeline with filtering. |
| `/api/ratelimit` | Inspect cached rate-limit headers from the most recent request. |

## API Documentation

- The generated OpenAPI document is served at [`/api-docs`](http://localhost:3000/api-docs) (JSON).
- A bundled Swagger UI is available at [`/docs`](http://localhost:3000/docs) which renders the same definition.
- The static definition also lives at [`openapi.json`](openapi.json) in the repo for importing into other tools.

All responses wrap data in `{ "data": ... }` where appropriate. Errors use `{ "error": "message" }` with HTTP status 4xx/5xx.

## Production Build

```bash
npm run build
npm run start
```

Deploy the generated Next.js app to any Node-compatible environment (Vercel, Render, etc.) and provide the same environment variables.

## Notes & Limitations

- Truth Social rate limits aggressively. The server retries once per request when the cached token expires, but long-running scrapes should honour the warning surfaces in the `ratelimit` endpoint.
- Some endpoints (e.g. `/api/statuses`) rely on sequential pagination using the `max_id` cursor exposed by Truth Social. Behaviour changes upstream may require adjustments.
- This project focuses on read-only parity with the original Python library; mutating endpoints (posting, following, etc.) were not part of the source module and are therefore omitted.
- The gateway uses [`node-tls-client`](https://www.npmjs.com/package/node-tls-client) to mimic a modern Chrome TLS fingerprint (matching the Python `curl_cffi` behaviour). The first server start downloads a ~10 MB native helper; make sure the filesystem is writable and outbound network access is permitted for that one-time bootstrap.
