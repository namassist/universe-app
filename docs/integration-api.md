# Integration API — for services that read from Universe

Universe exposes a read-only API for other services on the site network.
Today it serves the employee register: name, NIK, company, department,
position, status, join date, SIMPER codes and photo.

## Getting a token

A Universe admin opens **User Management → Integrasi API**, adds the service
(optionally limited to its IP address), and copies the token shown — it is
displayed **once**. Every request carries it:

```
Authorization: Bearer uvk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

A token works between two dates set by the admin — a first and a last day,
both inclusive, in site time (WITA) — or with no last day at all. Before the
first day every call answers **401 `token_not_yet_valid`**; after the last,
**401 `token_expired`** — ask the admin to change the dates (same token) or
replace it (new token, the old one stops at once).

Base URL on site: `http://192.168.151.23:8081/v1/integrations`. The full
schema is `docs/openapi/integration-api.openapi.json` (OpenAPI 3.0.3, the integration
routes only) — import it into Postman, Insomnia or a client generator. Do not
hand out `/openapi`: it describes the whole internal API.

## Employees

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://192.168.151.23:8081/v1/integrations/employees?page=1&limit=200&status=aktif"
```

```json
{
  "data": [
    {
      "nik": "12345678",
      "name": "BUDI SANTOSO",
      "company": "PT UDU",
      "department": "MINING OPERATION",
      "position": "OPERATOR HD",
      "status": "aktif",
      "joinDate": "2019-04-01",
      "skills": ["EXC 2600", "OHT 777"],
      "photo": {
        "url": "/v1/integrations/employees/12345678/photo",
        "version": "3f9a1c0b2d4e5f61"
      }
    }
  ],
  "page": 1,
  "limit": 200,
  "total": 1342
}
```

| Query    | Meaning                                                  |
| -------- | -------------------------------------------------------- |
| `page`   | 1-based, default 1                                       |
| `limit`  | 1–500, default 100                                       |
| `status` | `aktif`, `standby` or `nonaktif`; omitted = every status |
| `q`      | part of a NIK or name                                    |

Rows are ordered by NIK. Read pages until `page * limit >= total`.

One person: `GET /v1/integrations/employees/:nik` (404 if unknown).

## Photos

`GET /v1/integrations/employees/:nik/photo` returns the image with an
`ETag` equal to the record's `photo.version`. Keep the version you stored and
send it back; an unchanged photo answers **304** with no body:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  -H 'If-None-Match: "3f9a1c0b2d4e5f61"' \
  "http://192.168.151.23:8081/v1/integrations/employees/12345678/photo"
```

A weak validator (`W/"…"`), a comma-separated list, or `*` are honoured the
same way. `photo: null` means no photo is on file.

## Errors

| Status | Meaning                                                            |
| ------ | ------------------------------------------------------------------ |
| 401    | no token, unknown token, or a revoked one (`unauthenticated`)      |
| 401    | the token's first day has not come yet (`token_not_yet_valid`)     |
| 401    | the token's last day has passed (`token_expired`)                  |
| 403    | the token lacks this read, or the request came from another IP     |
| 404    | no such employee / no photo                                        |
| 422    | a bad query value (e.g. `limit` over 500)                          |
| 429    | over the per-minute budget (120 by default) — wait `Retry-After` s |

Every error body is `{ "code": "...", "message": "..." }`.

## Notes for the service's operators

- **The token is the credential.** An IP restriction on the token is a second
  lock, not the first: keep the token out of source control and logs, and ask
  for a revoke the moment it may have leaked.
- **Every call is logged** on the Universe server by the client's name, path
  and address (never the token).
- `q` matches literally: `%` and `_` are ordinary characters.
- `page` goes up to 100 000; past the last page the list is simply empty.

## Syncing

There is no "changed since" filter yet. A nightly or hourly sync reads every
page and re-downloads a photo only when its `version` differs from the one
stored. Stay well under the rate limit: 1,500 employees at `limit=500` is
three requests.
