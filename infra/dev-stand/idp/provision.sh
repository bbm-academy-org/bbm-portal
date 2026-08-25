#!/usr/bin/env bash
# bbm-portal — Zitadel OIDC application provisioner (idempotent, scriptable)
#
# Brings the dev IdP to a usable state for the portal auth gate (#59, ADR-002):
# a project, a web/OIDC application (authorization_code + refresh_token, BASIC
# confidential client, dev-mode http redirect URIs), the project-role assertion so
# `urn:zitadel:iam:org:project:roles` is emitted in the token, a seed project role,
# the Login V2 instance feature + baseUri (browsable admin Console), the
# IAM_LOGIN_CLIENT grant the login client needs, a hardened login policy (public
# self-registration OFF), and — when IDP_TEST_USER_PASSWORD is set — the two human
# accounts the owner logs in with: an admin holding every seeded role and a
# member holding `platform-user` alone (`--print-seed-users`).
#
# Thin port of the `ds-platform` idp/provision.sh: the portal gate needs no email
# or SMS delivery, so the SMTP / SMS / notification-language / message-text steps
# are intentionally NOT ported (no Mailpit / sms-sink services in this stand).
#
# Every step is idempotent: re-running converges, it does not duplicate.
#
# Auth: a bootstrap PAT for a machine user with org-owner scope, created
# declaratively at instance init via ZITADEL_FIRSTINSTANCE_* (see bootstrap.md).
# Pass it via PAT (env) or --pat-file. The PAT is a secret — never commit it.
#
# Usage:
#   IDP_BASE_URL=http://truenas.local:9180 PAT="$(cat pat.txt)" ./provision.sh
#   ./provision.sh --base-url http://truenas.local:9180 --pat-file ./idp-pat.txt
#   ./provision.sh --print-redirect-uris      # print the redirect-URI set and exit
#   ./provision.sh --print-post-logout-uris   # print the post-logout-URI set and exit
#   ./provision.sh --print-seed-roles         # print the seeded project roles and exit
#   ./provision.sh --print-seed-users         # print the seeded users + their roles and exit
#                                             # (both: no IdP, no PAT, no mutation)
#
# Requires: bash, curl, jq. Run it on Linux/macOS (the TrueNAS box, CI, a
# container) — NOT from a Windows-native jq.
#
# Outputs (stdout, machine-parseable):
#   IDP_PROJECT_ID=<project id>
#   IDP_CLIENT_ID=<oidc client id>
#   IDP_CLIENT_SECRET=<oidc client secret>   # printed ONCE on creation only
set -euo pipefail

# ── args / env ───────────────────────────────────────────────────────────────
BASE_URL="${IDP_BASE_URL:-}"
PAT_VALUE="${PAT:-}"
PAT_FILE=""
PROJECT_NAME="${IDP_PROJECT_NAME:-bbm-portal-dev}"
APP_NAME="${IDP_APP_NAME:-bbm-portal-dev}"
# Redirect URIs: the app runs on the owner's dev machine (localhost), NOT on the
# Zitadel host — so the callback is localhost even on the truenas.local recipe.
#
# Both URI sets are GENERATED, never hand-listed. Parallel sessions take a
# dev-stand port out of the dev-stand range (`pnpm dev:ports`; the range, its
# ceiling and the reason for it live in tools/dev/dev-ports.mjs and
# .claude/rules/parallel-sessions.md), and a stand on a port that is not
# registered here boots fine and only then dies at login with
# `400 invalid_request`.
#
# WIDENING THE RANGE IS NOT A ONE-LINER. Bumping DEV_PORT_MAX below is one of
# several edits that have to land together, plus a supervised re-provision —
# the full checklist lives in ONE place, infra/dev-stand/idp/bootstrap.md §6
# ("Not one port — the whole dev-stand range"). Do not restate it here: a second
# copy is what let this file claim "one line" while the docs said four (#93, #170).
#
# Axes — the port × host pair is shared, the path axis is per set. Counts are
# deliberately NOT written here (they are derived from the range; bootstrap.md §6
# owns them):
#   ports  DEV_PORT_MIN…DEV_PORT_MAX  the dev-stand range (`pnpm dev:ports`)
#   hosts  localhost, 127.0.0.1       the browser may be pointed at either
#   paths  /api/auth/callback/zitadel   the Auth.js (next-auth v5) default that
#                                       P2b (#59) wires
#          /auth/callback               the historical ds-platform BFF convention,
#                                       kept registered for continuity
# → redirect URIs    ports × hosts × paths
# → post-logout URIs ports × hosts          (a bare origin: sign-out lands on the
#                                            app root, so this set has no path axis)
DEV_PORT_MIN="${IDP_DEV_PORT_MIN:-3000}"
DEV_PORT_MAX="${IDP_DEV_PORT_MAX:-3009}"
DEV_HOSTS="${IDP_DEV_HOSTS:-localhost,127.0.0.1}"
CALLBACK_PATHS="${IDP_CALLBACK_PATHS:-/api/auth/callback/zitadel,/auth/callback}"

# generate_uris <paths-csv>  ->  the cartesian product port × host × path,
# comma-joined — the format the rest of the script (and IDP_REDIRECT_URIS /
# IDP_POST_LOGOUT_URIS) speaks. An EMPTY paths-csv means one empty path, i.e.
# bare origins — that is the post-logout shape, not an empty set.
generate_uris() {
  local paths_csv="$1"
  local port host path
  local out=() hosts=() paths=()
  IFS=',' read -r -a hosts <<< "$DEV_HOSTS"
  IFS=',' read -r -a paths <<< "$paths_csv"
  [[ ${#paths[@]} -eq 0 ]] && paths=('')
  for ((port = DEV_PORT_MIN; port <= DEV_PORT_MAX; port++)); do
    for host in "${hosts[@]}"; do
      for path in "${paths[@]}"; do
        out+=("http://${host}:${port}${path}")
      done
    done
  done
  local IFS=','
  printf '%s' "${out[*]}"
}

# Fail fast on a degenerate set (e.g. IDP_DEV_PORT_MIN > IDP_DEV_PORT_MAX, or an
# empty IDP_DEV_HOSTS): an empty array here would be PUT to the app and wipe every
# URI registered on it in that slot — precisely the outage #93 / #170 exist to
# prevent.
require_nonempty_uris() {
  local label="$1" value="$2" paths_csv="$3"
  [[ -n "$value" ]] && return 0
  echo "ERROR: refusing to continue with an EMPTY ${label} set." >&2
  echo "  ports ${DEV_PORT_MIN}..${DEV_PORT_MAX}, hosts '${DEV_HOSTS}', paths '${paths_csv}'" >&2
  echo "  (writing it would delete every ${label} registered on the app)" >&2
  exit 4
}

# IDP_REDIRECT_URIS / IDP_POST_LOGOUT_URIS (comma-separated) each replace their
# generated set wholesale.
REDIRECT_URIS="${IDP_REDIRECT_URIS:-$(generate_uris "$CALLBACK_PATHS")}"
require_nonempty_uris "redirect-URI" "$REDIRECT_URIS" "$CALLBACK_PATHS"
# Step 3 PUTs the WHOLE oidc_config, so this set is as destructive as the redirect
# one: a single-port default narrows the live post-logout set to that one port and
# sign-out stops redirecting on every other dev port (#170, the trap #93's audit
# found). Same generator, same axes, same bounds — minus the path axis.
POST_LOGOUT_URIS="${IDP_POST_LOGOUT_URIS:-$(generate_uris "")}"
require_nonempty_uris "post-logout-URI" "$POST_LOGOUT_URIS" ""
# Project roles to seed, comma-separated — the workspace's two starting roles
# (spec 311 §B EARS-414). They replace the `portal_admin` placeholder the P2b
# gate was told to "adopt or replace": the gate that adopted it is
# `src/lib/platform/authGate.ts`, and it checks these two spellings.
# `projectRoleCheck` stays OFF, so a member without a grant still LOGS IN and is
# then refused by the app with a bare 403 (EARS-418) rather than by the IdP with
# an OIDC error — the refusal the spec designs is the app's, not Zitadel's.
# Inspect without touching the IdP: `--print-seed-roles`.
SEED_ROLE="${IDP_SEED_ROLE:-platform-user,platform-admin}"
# Bootstrap machine user the PAT belongs to (FIRSTINSTANCE default).
BOOTSTRAP_USERNAME="${IDP_BOOTSTRAP_USERNAME:-bbm-bootstrap}"
# Human test user — the ADMIN account, granted every seeded role (created only
# when IDP_TEST_USER_PASSWORD is set; the password is permanent, see step 7+8).
TEST_USERNAME="${IDP_TEST_USERNAME:-bbm-test}"
TEST_EMAIL="${IDP_TEST_EMAIL:-bbm-test@bbm.local}"
TEST_PASSWORD="${IDP_TEST_USER_PASSWORD:-}"
# Second human account: a MEMBER, holding `platform-user` and nothing else.
# The test user above ends up with every seeded role, so a freshly provisioned
# stand used to contain no account that the workspace admits and the cabinet
# refuses — the EARS-418 / EARS-405 refusal could not be reproduced on it at
# all. The refusal is the half of the gate that fails silently (a missing grant
# and a correct refusal render the same bare 403), so the account that proves it
# is seeded, not clicked. Same password as the test user, same idempotency.
MEMBER_USERNAME="${IDP_MEMBER_USERNAME:-bbm-member}"
MEMBER_EMAIL="${IDP_MEMBER_EMAIL:-bbm-member@bbm.local}"
MEMBER_ROLE="${IDP_MEMBER_ROLE:-platform-user}"

# The seeded human accounts and the roles each one holds, as
# `<username><TAB><role,role>`. The member row is dropped when the seeded set
# does not carry its role (an `IDP_SEED_ROLE` override for some other project):
# granting a role the project does not have would fail, and a member-only
# account is meaningless where there is no admin role to withhold.
seed_user_records() {
  printf '%s\t%s\t%s\n' "$TEST_USERNAME" "$TEST_EMAIL" "$SEED_ROLE"
  if [[ ",${SEED_ROLE}," == *",${MEMBER_ROLE},"* && "$SEED_ROLE" != "$MEMBER_ROLE" ]]; then
    printf '%s\t%s\t%s\n' "$MEMBER_USERNAME" "$MEMBER_EMAIL" "$MEMBER_ROLE"
  fi
}

seed_user_rows() {
  seed_user_records | while IFS=$'\t' read -r _u _e _r; do printf '%s\t%s\n' "$_u" "$_r"; done
}

PRINT_SET=""
# The print flags are mutually exclusive and say so. Silently last-winning would
# hand back ONE set with exit 0 for a request for both — and that output is what
# gets diffed against the live app, where a missing set reads as an empty one.
_want_print() {
  local want="$1" flag="$2"
  if [[ -n "$PRINT_SET" && "$PRINT_SET" != "$want" ]]; then
    echo "ERROR: one print flag at a time (${flag} conflicts with the ${PRINT_SET} set)." >&2
    exit 2
  fi
  PRINT_SET="$want"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --pat) PAT_VALUE="$2"; shift 2 ;;
    --pat-file) PAT_FILE="$2"; shift 2 ;;
    --project-name) PROJECT_NAME="$2"; shift 2 ;;
    --app-name) APP_NAME="$2"; shift 2 ;;
    --print-redirect-uris) _want_print "redirect" "$1"; shift ;;
    --print-post-logout-uris) _want_print "post-logout" "$1"; shift ;;
    --print-seed-roles) _want_print "seed-roles" "$1"; shift ;;
    --print-seed-users) _want_print "seed-users" "$1"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Dry inspection of a generated set: no IdP, no PAT, no curl/jq, no mutation. The
# two flags stay disjoint — each prints exactly the set the app is PUT in that
# slot, so a diff against the live app is a straight comparison.
case "$PRINT_SET" in
  redirect)    printf '%s\n' "$REDIRECT_URIS"    | tr ',' '\n'; exit 0 ;;
  post-logout) printf '%s\n' "$POST_LOGOUT_URIS" | tr ',' '\n'; exit 0 ;;
  seed-roles)  printf '%s\n' "$SEED_ROLE"        | tr ',' '\n'; exit 0 ;;
  seed-users)  seed_user_rows; exit 0 ;;
esac

[[ -n "$PAT_FILE" ]] && PAT_VALUE="$(tr -d '\r\n' < "$PAT_FILE")"
: "${BASE_URL:?set IDP_BASE_URL or --base-url (e.g. http://truenas.local:9180)}"
: "${PAT_VALUE:?set PAT or --pat-file (the FIRSTINSTANCE bootstrap PAT)}"
BASE_URL="${BASE_URL%/}"

for bin in curl jq; do
  command -v "$bin" >/dev/null || { echo "missing dependency: $bin" >&2; exit 3; }
done

# ── http helper ──────────────────────────────────────────────────────────────
# api <METHOD> <PATH> [json-body]  ->  prints response body, fails on non-2xx
api() {
  local method="$1" path="$2" body="${3:-}" resp code
  resp="$(curl -sS -w $'\n%{http_code}' -X "$method" "${BASE_URL}${path}" \
    -H "Authorization: Bearer ${PAT_VALUE}" \
    -H "Content-Type: application/json" \
    ${body:+-d "$body"})"
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "API ${method} ${path} -> HTTP ${code}: ${body}" >&2
    return 1
  fi
  printf '%s' "$body"
}

# Locale-independent "converged precondition" detector: Zitadel rejects a no-op
# update with gRPC status code 9 (FAILED_PRECONDITION). Reads /tmp/.idperr, the
# captured `API ... -> HTTP ...: {json}` line from api().
_is_converged_precondition() {
  grep -qE '"code"[[:space:]]*:[[:space:]]*9' /tmp/.idperr 2>/dev/null && return 0
  grep -qiE "no changes|already active|not changed" /tmp/.idperr 2>/dev/null && return 0
  return 1
}

# Like api(), but treats a "no changes" precondition as success — an idempotent
# update that finds nothing to change is the desired converged state.
api_idempotent() {
  local out
  if out="$(api "$@" 2>/tmp/.idperr)"; then
    printf '%s' "$out"
    return 0
  fi
  if _is_converged_precondition; then
    echo "(already converged — no changes)" >&2
    return 0
  fi
  cat /tmp/.idperr >&2
  return 1
}

echo "Provisioning Zitadel OIDC at ${BASE_URL}" >&2

# ── 0. instance-identity pre-flight ──────────────────────────────────────────
# A wrong/empty vhost on the origin can answer 200-with-empty-body, making every
# step below report success while doing nothing. Require a Zitadel-shaped identity
# from the Admin API before the first mutation.
INSTANCE_ID="$(api GET /admin/v1/instances/me | jq -r '.instance.id // empty' 2>/dev/null || true)"
if [[ -z "$INSTANCE_ID" ]]; then
  echo "ERROR: ${BASE_URL}/admin/v1/instances/me returned no Zitadel instance identity" >&2
  echo "  (empty or non-JSON body). Point BASE_URL at the real Zitadel origin." >&2
  exit 6
fi
echo "instance identity OK (instance ${INSTANCE_ID})" >&2

# ── 1. ensure project ────────────────────────────────────────────────────────
# projectRoleAssertion makes Zitadel emit `urn:zitadel:iam:org:project:roles` in
# the userinfo/token. Search by name; create if absent, converge if present.
PROJECT_ID="$(api POST /management/v1/projects/_search \
  "$(jq -nc --arg n "$PROJECT_NAME" '{queries:[{nameQuery:{name:$n,method:"TEXT_QUERY_METHOD_EQUALS"}}]}')" \
  | jq -r --arg n "$PROJECT_NAME" '.result[]? | select(.name==$n) | .id' | head -n1)"

if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "null" ]]; then
  PROJECT_ID="$(api POST /management/v1/projects \
    "$(jq -nc --arg n "$PROJECT_NAME" \
       '{name:$n, projectRoleAssertion:true, projectRoleCheck:false, hasProjectCheck:false}')" \
    | jq -r '.id')"
  echo "created project ${PROJECT_ID}" >&2
else
  api_idempotent PUT "/management/v1/projects/${PROJECT_ID}" \
    "$(jq -nc --arg n "$PROJECT_NAME" \
       '{name:$n, projectRoleAssertion:true, projectRoleCheck:false, hasProjectCheck:false}')" \
    >/dev/null
  echo "reusing project ${PROJECT_ID}" >&2
fi

# ── 2. ensure seed project roles ─────────────────────────────────────────────
IFS=',' read -r -a _roles <<< "$SEED_ROLE"
for role in "${_roles[@]}"; do
  role="$(echo "$role" | tr -d ' ')"
  [[ -z "$role" ]] && continue
  if api POST "/management/v1/projects/${PROJECT_ID}/roles/_search" '{}' \
       | jq -e --arg k "$role" '.result[]? | select(.key==$k)' >/dev/null; then
    echo "role ${role} exists" >&2
  else
    api POST "/management/v1/projects/${PROJECT_ID}/roles" \
      "$(jq -nc --arg k "$role" '{roleKey:$k, displayName:$k, group:""}')" >/dev/null \
      && echo "created role ${role}" >&2
  fi
done

# ── 3. ensure OIDC web application ───────────────────────────────────────────
REDIRECT_JSON="$(jq -nc --arg s "$REDIRECT_URIS" '$s | split(",") | map(gsub("^\\s+|\\s+$";""))')"
LOGOUT_JSON="$(jq -nc --arg s "$POST_LOGOUT_URIS" '$s | split(",") | map(gsub("^\\s+|\\s+$";""))')"

EXISTING_APP="$(api POST "/management/v1/projects/${PROJECT_ID}/apps/_search" \
  "$(jq -nc --arg n "$APP_NAME" '{queries:[{nameQuery:{name:$n,method:"TEXT_QUERY_METHOD_EQUALS"}}]}')" \
  | jq -r --arg n "$APP_NAME" '.result[]? | select(.name==$n) | .id' | head -n1 || true)"

# Web app, authorization_code + refresh_token, BASIC auth (confidential client with
# a client_secret), dev mode on (http:// redirect URIs allowed on the dev stand).
APP_PAYLOAD="$(jq -nc \
  --arg n "$APP_NAME" \
  --argjson redirect "$REDIRECT_JSON" \
  --argjson logout "$LOGOUT_JSON" \
  '{
     name:$n,
     redirectUris:$redirect,
     postLogoutRedirectUris:$logout,
     responseTypes:["OIDC_RESPONSE_TYPE_CODE"],
     grantTypes:["OIDC_GRANT_TYPE_AUTHORIZATION_CODE","OIDC_GRANT_TYPE_REFRESH_TOKEN"],
     appType:"OIDC_APP_TYPE_WEB",
     authMethodType:"OIDC_AUTH_METHOD_TYPE_BASIC",
     version:"OIDC_VERSION_1_0",
     devMode:true,
     accessTokenType:"OIDC_TOKEN_TYPE_JWT",
     accessTokenRoleAssertion:true,
     idTokenRoleAssertion:true,
     idTokenUserinfoAssertion:true
   }')"

if [[ -n "$EXISTING_APP" && "$EXISTING_APP" != "null" ]]; then
  api_idempotent PUT "/management/v1/projects/${PROJECT_ID}/apps/${EXISTING_APP}/oidc_config" \
    "$(echo "$APP_PAYLOAD" | jq 'del(.name)')" >/dev/null
  APP_DETAIL="$(api GET "/management/v1/projects/${PROJECT_ID}/apps/${EXISTING_APP}")"
  CLIENT_ID="$(echo "$APP_DETAIL" | jq -r '.app.oidcConfig.clientId')"
  echo "reused app ${EXISTING_APP} (client secret not re-emitted on update)" >&2
  CLIENT_SECRET=""
else
  CREATED="$(api POST "/management/v1/projects/${PROJECT_ID}/apps/oidc" "$APP_PAYLOAD")"
  CLIENT_ID="$(echo "$CREATED" | jq -r '.clientId')"
  CLIENT_SECRET="$(echo "$CREATED" | jq -r '.clientSecret // ""')"
  echo "created OIDC app (appId $(echo "$CREATED" | jq -r '.appId'))" >&2
fi

# ── 4. ensure Login V2 instance feature + baseUri (browsable Console) ─────────
# The v2 authorize hop redirects the browser to baseUri to render the login UI,
# making /ui/console browsable via the idp-login container at the same origin.
# Read-before-write idempotency via api_idempotent (code-9 "no changes" absorbed).
LOGIN_BASE_URI="${IDP_LOGIN_BASE_URI:-${BASE_URL}/ui/v2/login}"
api_idempotent PUT /v2/features/instance \
  "$(jq -nc --arg u "$LOGIN_BASE_URI" '{loginV2:{required:true, baseUri:$u}}')" >/dev/null \
  && echo "loginV2 feature ensured (required, baseUri=${LOGIN_BASE_URI})" >&2

# ── 5. grant IAM_LOGIN_CLIENT to the bootstrap machine user ───────────────────
# The idp-login container authenticates to core with the bootstrap PAT and needs
# the dedicated IAM_LOGIN_CLIENT role (IAM_OWNER alone is NOT sufficient). Grant it
# on top of the machine user's existing roles. Idempotent.
BOOTSTRAP_UID="$(api POST /v2/users \
  "$(jq -nc --arg u "$BOOTSTRAP_USERNAME" '{queries:[{userNameQuery:{userName:$u,method:"TEXT_QUERY_METHOD_EQUALS"}}]}')" \
  | jq -r '.result[0].userId // empty')"
if [[ -n "$BOOTSTRAP_UID" ]]; then
  EXISTING_ROLES="$(api POST /admin/v1/members/_search '{}' \
    | jq -r --arg u "$BOOTSTRAP_UID" '.result[]? | select(.userId==$u) | .roles[]' 2>/dev/null | sort -u)"
  if grep -qx "IAM_LOGIN_CLIENT" <<< "$EXISTING_ROLES"; then
    echo "IAM_LOGIN_CLIENT already granted to ${BOOTSTRAP_USERNAME}" >&2
  else
    ROLES_JSON="$(printf '%s\nIAM_LOGIN_CLIENT\n' "$EXISTING_ROLES" \
      | grep -v '^$' | sort -u | jq -R . | jq -sc .)"
    api_idempotent PUT "/admin/v1/members/${BOOTSTRAP_UID}" \
      "$(jq -nc --argjson r "$ROLES_JSON" '{roles:$r}')" >/dev/null \
      && echo "granted IAM_LOGIN_CLIENT to ${BOOTSTRAP_USERNAME}" >&2
  fi
else
  echo "WARN: machine user ${BOOTSTRAP_USERNAME} not found; cannot grant IAM_LOGIN_CLIENT" >&2
fi

# ── 6. disable PUBLIC self-registration on the default login policy ──────────
# Product registration is not open on the dev IdP: close the hosted register door.
# Read-modify-write (proto3 full-message PUT — an omitted bool is `false`, so echo
# every updatable field back verbatim, flipping ONLY allowRegister).
LOGIN_POLICY="$(api GET /admin/v1/policies/login | jq '.policy')"
if [[ "$(jq -r '.allowRegister // false' <<< "$LOGIN_POLICY")" == "false" ]]; then
  echo "login policy: public self-registration already disabled" >&2
else
  LOGIN_POLICY_UPDATE="$(jq -c '
    {
      allowUsernamePassword: (.allowUsernamePassword // false),
      allowRegister: false,
      allowExternalIdp: (.allowExternalIdp // false),
      forceMfa: (.forceMfa // false),
      forceMfaLocalOnly: (.forceMfaLocalOnly // false),
      passwordlessType: (.passwordlessType // "PASSWORDLESS_TYPE_NOT_ALLOWED"),
      hidePasswordReset: (.hidePasswordReset // false),
      ignoreUnknownUsernames: (.ignoreUnknownUsernames // false),
      defaultRedirectUri: (.defaultRedirectUri // ""),
      allowDomainDiscovery: (.allowDomainDiscovery // false),
      disableLoginWithEmail: (.disableLoginWithEmail // false),
      disableLoginWithPhone: (.disableLoginWithPhone // false)
    }
    + ({
        passwordCheckLifetime,
        externalLoginCheckLifetime,
        mfaInitSkipLifetime,
        secondFactorCheckLifetime,
        multiFactorCheckLifetime
      } | with_entries(select(.value != null)))
  ' <<< "$LOGIN_POLICY")"
  api_idempotent PUT /admin/v1/policies/login "$LOGIN_POLICY_UPDATE" >/dev/null \
    && echo "login policy: disabled public self-registration (allowRegister -> false)" >&2
fi

# ── 7+8. ensure the seeded human users and their project grants ──────────────
# Two objects per account, and they are NOT the same thing: the user exists in
# the org, and a USER GRANT on the project carries the roles. A project role
# lives on the PROJECT and reaches a token only through that grant — without it
# the roles are provisioned, `urn:zitadel:iam:org:project:roles` is asserted, and
# the claim arrives EMPTY, which the app reads as "no grant" and answers with the
# bare 403 of EARS-418. That failure looks exactly like a correct refusal, which
# is why the grant is provisioned here rather than left as a click in the console.
#
# Who is seeded: `seed_user_records` — the admin test account carrying every
# seeded role, and the member account carrying `platform-user` alone so the
# refusal path of the gate can actually be exercised on a fresh stand
# (`--print-seed-users` prints the pair without touching the IdP). Only these
# dev accounts are granted: real people are granted deliberately (Zitadel
# console, or Access Sync — epic #113), never as a side effect of a re-provision.
#
# Password set PERMANENT (changeRequired:false): the Zitadel login-v2
# /ui/v2/login/password/change screen is broken on this stand ("Could not get the
# context of the user"), so a forced first-login change makes login IMPOSSIBLE —
# the owner can never complete the gate. The email is pre-verified so no mail
# delivery is needed (this stand has no SMTP). Idempotent: search by username; if
# present, leave the account untouched (no password reset) and converge only the
# grant.

# ensure_human_user <username> <email>  ->  the user id on stdout (empty on failure)
ensure_human_user() {
  local username="$1" email="$2" uid
  uid="$(api POST /v2/users     "$(jq -nc --arg u "$username" '{queries:[{userNameQuery:{userName:$u,method:"TEXT_QUERY_METHOD_EQUALS"}}]}')"     | jq -r '.result[0].userId // empty')"
  if [[ -n "$uid" ]]; then
    echo "user ${username} already exists (${uid}) — leaving untouched" >&2
    printf '%s' "$uid"
    return 0
  fi
  uid="$(api POST /v2/users/human     "$(jq -nc --arg u "$username" --arg e "$email" --arg p "$TEST_PASSWORD"        '{username:$u,
         profile:{givenName:"BBM", familyName:"Test"},
         email:{email:$e, isVerified:true},
         password:{password:$p, changeRequired:false}}')"     | jq -r '.userId // empty')"
  if [[ -n "$uid" ]]; then
    echo "created human user ${username} (${uid}); password permanent (change not required)" >&2
  else
    echo "WARN: could not create user ${username}" >&2
  fi
  printf '%s' "$uid"
}

# ensure_project_grant <uid> <username> <roles-csv>
#
# The PUT replaces the grant's WHOLE role set — deliberately: this script is the
# statement of what a seeded dev account holds, and a role added to one by hand
# would otherwise survive as a silent difference between two stands. A role that
# should stick belongs in IDP_SEED_ROLE / IDP_MEMBER_ROLE, not in the console.
ensure_project_grant() {
  local uid="$1" username="$2" roles_csv="$3" role_keys grant_id
  role_keys="$(printf '%s' "$roles_csv"     | jq -Rc 'split(",") | map(gsub("^\s+|\s+$";"")) | map(select(length > 0))')"
  grant_id="$(api POST /management/v1/users/grants/_search     "$(jq -nc --arg u "$uid" --arg p "$PROJECT_ID"        '{queries:[{userIdQuery:{userId:$u}},{projectIdQuery:{projectId:$p}}]}')"     | jq -r '.result[0].id // empty')"
  if [[ -n "$grant_id" ]]; then
    api_idempotent PUT "/management/v1/users/${uid}/grants/${grant_id}"       "$(jq -nc --argjson r "$role_keys" '{roleKeys:$r}')" >/dev/null       && echo "${username}: grant ${grant_id} -> roles $(jq -r 'join(", ")' <<< "$role_keys")" >&2
  else
    api POST "/management/v1/users/${uid}/grants"       "$(jq -nc --arg p "$PROJECT_ID" --argjson r "$role_keys"          '{projectId:$p, roleKeys:$r}')" >/dev/null       && echo "granted $(jq -r 'join(", ")' <<< "$role_keys") to ${username}" >&2
  fi
}

if [[ -n "$TEST_PASSWORD" ]]; then
  while IFS=$'	' read -r SEED_USERNAME SEED_EMAIL SEED_USER_ROLES; do
    [[ -z "$SEED_USERNAME" ]] && continue
    SEED_UID="$(ensure_human_user "$SEED_USERNAME" "$SEED_EMAIL")"
    if [[ -n "$SEED_UID" ]]; then
      ensure_project_grant "$SEED_UID" "$SEED_USERNAME" "$SEED_USER_ROLES"
    else
      echo "no user id for ${SEED_USERNAME} — skipping the project grant (roles exist, nobody holds them)" >&2
    fi
  done < <(seed_user_records)
else
  echo "IDP_TEST_USER_PASSWORD unset — skipping human user creation and the project grants" >&2
fi

# ── output (machine-parseable; secret only when freshly created) ─────────────
echo "IDP_PROJECT_ID=${PROJECT_ID}"
echo "IDP_CLIENT_ID=${CLIENT_ID}"
if [[ -n "$CLIENT_SECRET" ]]; then
  echo "IDP_CLIENT_SECRET=${CLIENT_SECRET}"
else
  echo "# IDP_CLIENT_SECRET not re-emitted (app already existed); rotate via:" >&2
  echo "#   POST /management/v1/projects/${PROJECT_ID}/apps/${EXISTING_APP:-<appId>}/oidc_config/_generate_client_secret" >&2
fi
echo "# registered redirect URIs (P2b sets IDP_REDIRECT_URI to the app callback):" >&2
echo "$REDIRECT_JSON" | jq -r '.[]' | while IFS= read -r _uri; do
  echo "#   ${_uri}" >&2
done
echo "# registered post-logout URIs ($(echo "$LOGOUT_JSON" | jq -r 'length') bare origins):" >&2
echo "$LOGOUT_JSON" | jq -r '.[]' | while IFS= read -r _uri; do
  echo "#   ${_uri}" >&2
done
# The copy-paste hint goes LAST, after both lists — not sandwiched between them.
echo "# IDP_REDIRECT_URI=$(echo "$REDIRECT_JSON" | jq -r '.[0]')" >&2
