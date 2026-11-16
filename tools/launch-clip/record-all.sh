#!/usr/bin/env bash
# Seed local D1 with mock data, then record the real booking (A) and bill (B) flows.
# Needs: `npx wrangler dev --local --port 8799` running from the repo root (see README.md).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
cd "$root"
d1() { npx wrangler d1 execute DB --local "$@" > /dev/null; }
mkdir -p "$here/build"

# fresh booking doc (11 of 12 already in) + logged-in LINE member "เบียร์", no bill yet
d1 --command "DELETE FROM bills" || true  # table is created lazily by billing.js
d1 --file="$here/data/seed.sql"
d1 --file="$here/data/member.sql"
node "$here/record.cjs" A

# organizer opens the bill (real API, admin key from .dev.vars = test-key)
cookie=$(curl -s -i -X POST -H "Origin: http://localhost:8799" -H "Content-Type: application/json" \
  -d '{"key":"test-key"}' http://localhost:8799/api/login | grep -i set-cookie | sed -E 's/.*(__Host-sena=[^;]+).*/\1/' | tr -d '\r')
curl -s -X POST -H "Cookie: $cookie" -H "Origin: http://localhost:8799" -H "Content-Type: application/json" \
  --data @"$here/data/bill.json" http://localhost:8799/api/billing > "$here/build/bill-open.json"
node "$here/record.cjs" B

node -e '
const fs = require("fs"), b = process.argv[1] + "/build/";
const rec = (s) => JSON.parse(fs.readFileSync(b + "rec/" + s + "/meta.json"));
const out = { A: rec("A"), B: rec("B"), billOpen: JSON.parse(fs.readFileSync(b + "bill-open.json")).notice.text };
fs.writeFileSync(b + "recdata.js", "window.REC=" + JSON.stringify(out) + ";");
console.log("recdata ok", out.A.notices, out.B.notices, out.billOpen);
' "$here"
