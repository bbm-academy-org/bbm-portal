# One-time finance history reconstruction

**STATUS: READY — one-time production procedure for issue #387. Do not turn
this into a recurring import path.**

This runbook reconstructs the historical BBM ledger directly from the existing
`BBM Финансы` Mattermost channel. It is the operator procedure for
[`docs/specs/339-ledger-intake.md`](../specs/339-ledger-intake.md) EARS-517 and
EARS-518. It creates no API, scheduled job, upload UI or persistent integration.

The topology is deliberately asymmetric:

- Mattermost Postgres and its file volume are private to `tools-prod-tw`;
- the platform Postgres database is private to `portal-prod-tw`;
- neither host publishes Postgres, and the hosts have no cross-host SSH trust;
- the operator workstation has the `tools-prod-tw` and `portal-prod-tw` SSH
  aliases and is therefore the only join point.

The procedure uses two workstation SSH tunnels and streams one protected
archive containing only active attachments from the selected channel. The
private mapping, plan and bundle stay outside the repository, inherit a
current-user-only ACL, and are removed and checked at the end.

## Preconditions

- PR #426 is merged, its release is deployed to `portal-prod-tw`, and migration
  `0015_finance_history_backfill` is applied.
- The private finance-document bucket task `sidorovanthon/bbm#172` is closed and
  `deploy/.env.prod` carries all five `FINANCE_DOCUMENTS_S3_*` values. At the
  time this runbook was authored, #172 was still open and those values were
  absent: production dry-run is possible, but **apply remains blocked** until
  this precondition is true.
- Run from a clean checkout of that deployed commit with dependencies installed
  and Node 22 available through pnpm's pinned runtime.
- Run in Windows PowerShell. The binary archive is captured through .NET streams,
  so the recipe is safe on the workstation's Windows PowerShell 5.1 and does not
  depend on PowerShell's native-pipeline byte handling.
- The fixed source channel is `tsixee7hhj87inw5frgjna694c` (`BBM Финансы`). A
  different channel requires a separately reviewed runbook change.
- Prepare the operation mapping by reviewing this channel and the platform
  references. Its exact TypeScript contract is `FinanceHistoryMapping` in
  `src/lib/finance/history/plan.ts`. Amounts are bigint minimal-unit strings.
  Never paste the mapping, plan or credentials into a shell command, issue,
  pull request or chat.
- Know the production `core.member.email` of the human operator whose identity
  must appear in the audit trail.

## 1. Create a private workstation directory

Run from the repository root. The directory is intentionally under
`LOCALAPPDATA`, never under the checkout.

```powershell
$ErrorActionPreference = 'Stop'
$ChannelId = 'tsixee7hhj87inw5frgjna694c'
$RepoRoot = (Resolve-Path -LiteralPath '.').Path
$HistoryRoot = Join-Path $env:LOCALAPPDATA ("bbm-finance-history-" + [guid]::NewGuid())
$FilesDir = Join-Path $HistoryRoot 'mattermost-files'
$MappingPath = Join-Path $HistoryRoot 'mapping.private.json'
$PlanPath = Join-Path $HistoryRoot 'plan.private.json'
$BundlePath = Join-Path $HistoryRoot 'bundle.private.tar.gz'
$MattermostTunnel = $null
$PlatformTunnel = $null
$FinanceStorageNames = @()

New-Item -ItemType Directory -Path $FilesDir -Force | Out-Null
$CurrentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
icacls.exe $HistoryRoot /inheritance:r /grant:r "*${CurrentSid}:(OI)(CI)F" | Out-Null

$ResolvedHistoryRoot = (Resolve-Path -LiteralPath $HistoryRoot).Path
if ($ResolvedHistoryRoot.StartsWith($RepoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Private finance artifacts must be outside the repository.'
}
$HistoryAcl = Get-Acl -LiteralPath $HistoryRoot
if (-not $HistoryAcl.AreAccessRulesProtected) {
  throw 'The private history directory still inherits ACL entries.'
}
```

Use a local editor to create `$MappingPath` with the reviewed
`FinanceHistoryMapping[]`. Do not use a command-line argument or here-string for
its contents: both are too easy to retain in history. Confirm only that the file
parses; do not print it:

```powershell
$null = Get-Content -LiteralPath $MappingPath -Raw | ConvertFrom-Json
```

## 2. Open both private database tunnels

The following reads each connection string directly into a PowerShell variable.
The assignments must be kept exactly as assignments: invoking either remote
command by itself would print a credential. The application-role platform URL
is intentional; this command uses the audited application transaction path and
does not migrate schema.

```powershell
$ReadMattermostDsn = @'
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' mattermost-deploy-mattermost-1 | sed -n 's/^MM_SQLSETTINGS_DATASOURCE=//p'
'@
$ReadPlatformValue = @'
name=$1
sed -n "s/^${name}=//p" /home/deploy/bbm-portal/deploy/.env.prod
'@
$ReadMattermostIp = @'
docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' mattermost-deploy-postgres-1
'@
$ReadPlatformIp = @'
docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' bbm-portal-postgres-1
'@

$MattermostRemoteDsn = (& ssh.exe tools-prod-tw $ReadMattermostDsn).Trim()
$PlatformRemoteDsn = ($ReadPlatformValue |
  & ssh.exe portal-prod-tw bash -s -- PLATFORM_DATABASE_URL).Trim()
$MattermostDbIp = (& ssh.exe tools-prod-tw $ReadMattermostIp).Trim()
$PlatformDbIp = (& ssh.exe portal-prod-tw $ReadPlatformIp).Trim()
if (@($MattermostRemoteDsn, $PlatformRemoteDsn, $MattermostDbIp, $PlatformDbIp) |
    Where-Object { [string]::IsNullOrWhiteSpace($_) }) {
  throw 'A private database address or connection string could not be read.'
}

function ConvertTo-TunnelDsn([string]$Dsn, [int]$Port) {
  $Builder = [UriBuilder]::new($Dsn)
  $Builder.Host = '127.0.0.1'
  $Builder.Port = $Port
  $Builder.Uri.AbsoluteUri
}

$MattermostTunnel = Start-Process -FilePath ssh.exe -ArgumentList @(
  '-N', '-o', 'ExitOnForwardFailure=yes',
  '-L', "127.0.0.1:15432:${MattermostDbIp}:5432", 'tools-prod-tw'
) -PassThru -WindowStyle Hidden
$PlatformTunnel = Start-Process -FilePath ssh.exe -ArgumentList @(
  '-N', '-o', 'ExitOnForwardFailure=yes',
  '-L', "127.0.0.1:15433:${PlatformDbIp}:5432", 'portal-prod-tw'
) -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 2
if (-not (Test-NetConnection 127.0.0.1 -Port 15432 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
  throw 'Mattermost SSH tunnel did not open.'
}
if (-not (Test-NetConnection 127.0.0.1 -Port 15433 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
  throw 'Platform SSH tunnel did not open.'
}

$env:MATTERMOST_DATABASE_URL = ConvertTo-TunnelDsn $MattermostRemoteDsn 15432
$env:PLATFORM_DATABASE_URL = ConvertTo-TunnelDsn $PlatformRemoteDsn 15433
```

Do not inspect, interpolate into another command, or print the four DSN
variables. The CLI reads the two local-tunnel values from its environment.

## 3. Stream only this channel's attachments

The Linux script queries `fileinfo` through the existing Postgres container,
joins it to active `posts`, restricts by the fixed `channelid`, rejects unsafe
paths, copies only those files out of the Mattermost container into a mode-0700
temporary directory, and streams a `tar` archive. Its trap removes the remote
path list and staging directory on success or failure. No source secret appears
in the command or output.

The .NET process wrapper is load-bearing on Windows PowerShell 5.1: ordinary
`ssh ... > file` redirection can transcode native output and corrupt a gzip
stream.

```powershell
$RemoteBundleScript = @'
set -euo pipefail
channel_id=$1
db_container=mattermost-deploy-postgres-1
files_container=mattermost-deploy-mattermost-1
stage=$(mktemp -d /home/deploy/.finance-history-files.XXXXXX)
list=$(mktemp /home/deploy/.finance-history-list.XXXXXX)
chmod 700 "$stage"
chmod 600 "$list"
cleanup() {
  rm -rf -- "$stage"
  rm -f -- "$list"
}
trap cleanup EXIT HUP INT TERM

sql="select distinct f.path
       from fileinfo f
       join posts p on p.id = f.postid
      where p.channelid = '$channel_id'
        and p.deleteat = 0
        and f.deleteat = 0
      order by f.path"
docker exec "$db_container" sh -c \
  'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"' \
  sh "$sql" > "$list"
test -s "$list"

while IFS= read -r rel; do
  case "$rel" in
    ''|/*|..|../*|*/../*|*/..) printf 'unsafe Mattermost path\n' >&2; exit 1 ;;
  esac
  if ! printf '%s' "$rel" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/-]*$'; then
    printf 'unsupported Mattermost path\n' >&2
    exit 1
  fi
  target="$stage/$rel"
  mkdir -p -- "$(dirname -- "$target")"
  docker cp "$files_container:/mattermost/data/$rel" "$target" >/dev/null
done < "$list"

tar -C "$stage" -czf - --files-from="$list"
'@

$StartInfo = New-Object System.Diagnostics.ProcessStartInfo
$StartInfo.FileName = (Get-Command ssh.exe).Source
$StartInfo.Arguments = "tools-prod-tw bash -s -- $ChannelId"
$StartInfo.UseShellExecute = $false
$StartInfo.RedirectStandardInput = $true
$StartInfo.RedirectStandardOutput = $true
$StartInfo.RedirectStandardError = $true
$ArchiveProcess = New-Object System.Diagnostics.Process
$ArchiveProcess.StartInfo = $StartInfo
$null = $ArchiveProcess.Start()
$ArchiveError = $ArchiveProcess.StandardError.ReadToEndAsync()
$ArchiveProcess.StandardInput.Write($RemoteBundleScript)
$ArchiveProcess.StandardInput.Close()

$BundleStream = [IO.File]::Open($BundlePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
  $ArchiveProcess.StandardOutput.BaseStream.CopyTo($BundleStream)
} finally {
  $BundleStream.Dispose()
}
$ArchiveProcess.WaitForExit()
$null = $ArchiveError.Result
if ($ArchiveProcess.ExitCode -ne 0) {
  throw "Selective Mattermost archive failed with exit $($ArchiveProcess.ExitCode)."
}

$BundleEntries = @(tar -tzf $BundlePath)
if ($LASTEXITCODE -ne 0 -or $BundleEntries.Count -eq 0) {
  throw 'The selected-channel bundle is empty or invalid.'
}
if ($BundleEntries | Where-Object { $_ -match '^(?:/|[A-Za-z]:)|(?:^|/)\.\.(?:/|$)' }) {
  throw 'The selected-channel bundle contains an unsafe path.'
}
tar -xzf $BundlePath -C $FilesDir
if ($LASTEXITCODE -ne 0) { throw 'The selected-channel bundle could not be extracted.' }
$env:MATTERMOST_FILES_DIR = $FilesDir
```

## 4. Produce the immutable dry-run plan

The command reads Mattermost through the source tunnel, checks every referenced
attachment under the extracted tree, checks existing `backfill` source refs in
the platform database, and creates `$PlanPath` with create-new semantics. It
does not write ledger rows or upload documents.

```powershell
if (Test-Path -LiteralPath $PlanPath) {
  throw 'Refusing to overwrite an earlier plan; create a new private workspace.'
}
pnpm --use-node-version=22.23.1 platform:finance:history dry-run `
  --mapping $MappingPath `
  --output $PlanPath `
  --channel $ChannelId
if ($LASTEXITCODE -ne 0) { throw 'Finance history dry-run failed.' }

$Plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$PlanDigest = [string]$Plan.planDigest
if ($Plan.summary.invalidCount -ne 0) { throw 'Plan has invalid rows.' }
if ($Plan.summary.operationsWithoutDocuments -ne 0) {
  throw 'Apply requires a supporting document for every new operation.'
}
if ($PlanDigest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'Plan digest is invalid.' }
```

Present only the digest and the non-sensitive summary counts/date range to the
owner. Keep the plan itself private; it contains finance facts and Mattermost
identifiers.

## 5. OWNER AUTHORIZATION GATE

**STOP.** The implementation `go` is not permission to write this data. Apply
only after the owner explicitly authorizes this exact `sha256:...` plan digest
in the issue. If the mapping, source corpus, existing ledger state or plan file
changes, rerun dry-run into a new private workspace and obtain authorization for
the new digest.

Record the authorized digest literally after approval and check it against the
still-private plan:

```powershell
$AuthorizedDigest = 'sha256:REPLACE_WITH_THE_DIGEST_AUTHORIZED_BY_THE_OWNER'
$Plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$PlanDigest = [string]$Plan.planDigest
if ($AuthorizedDigest -ne $PlanDigest) {
  throw 'The owner-authorized digest does not match this plan. Apply is forbidden.'
}
```

If the workstation or tunnels were stopped while awaiting authorization, repeat
section 2 before continuing. Do not reconstruct a plan from memory.

## 6. Apply through the audited ledger path

Use the real operator's `core.member.email`. The CLI independently recomputes
and verifies the digest, uploads the selected private documents, creates
operator-only backfill intake rows and posts them through the existing finance
transaction path with audit source `cli:finance-history-backfill`.

```powershell
# Production document writes must never fall back to the local dev archive or
# reuse the public CMS media bucket. Dry-run intentionally does not need these
# values; load and validate them only after the exact plan is authorized.
$FinanceStorageNames = @(
  'FINANCE_DOCUMENTS_S3_BUCKET',
  'FINANCE_DOCUMENTS_S3_ENDPOINT',
  'FINANCE_DOCUMENTS_S3_REGION',
  'FINANCE_DOCUMENTS_S3_ACCESS_KEY_ID',
  'FINANCE_DOCUMENTS_S3_SECRET_ACCESS_KEY',
  'S3_BUCKET'
)
foreach ($Name in $FinanceStorageNames) {
  $Value = ($ReadPlatformValue | & ssh.exe portal-prod-tw bash -s -- $Name).Trim()
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Production finance storage is not provisioned: $Name is empty (sidorovanthon/bbm#172)."
  }
  Set-Item -Path "Env:$Name" -Value $Value
  $Value = $null
}
if ($env:FINANCE_DOCUMENTS_S3_BUCKET -eq $env:S3_BUCKET) {
  throw 'The private finance bucket must not reuse the public CMS media bucket.'
}
$env:NODE_ENV = 'production'

$OperatorEmail = 'REPLACE_WITH_OPERATOR_CORE_MEMBER_EMAIL'
pnpm --use-node-version=22.23.1 platform:finance:history apply `
  --plan $PlanPath `
  --digest $PlanDigest `
  --operator-email $OperatorEmail
if ($LASTEXITCODE -ne 0) { throw 'Finance history apply failed; do not clean up before diagnosis.' }
```

Save only the returned counts and digest in the issue. Do not attach the plan,
mapping, bundle, document paths, credentials or raw Mattermost text. A retry
with the same authorized plan is safe: the `(source, source_ref)` database
constraint and apply path skip already-created operations.

## 7. Cleanup and verify

On success, close both tunnels, remove the process environment values and all
private artifacts. The remote bundle script has already removed its staging
directory through its trap. On an apply failure, first retain the protected
workspace for diagnosis; perform this cleanup only after the retry or explicit
abandon decision.

```powershell
foreach ($Tunnel in @($MattermostTunnel, $PlatformTunnel)) {
  if ($null -ne $Tunnel -and -not $Tunnel.HasExited) {
    Stop-Process -Id $Tunnel.Id -Force
  }
}
Remove-Item Env:MATTERMOST_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:MATTERMOST_FILES_DIR -ErrorAction SilentlyContinue
Remove-Item Env:PLATFORM_DATABASE_URL -ErrorAction SilentlyContinue
foreach ($Name in $FinanceStorageNames) {
  Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
}
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
$MattermostRemoteDsn = $null
$PlatformRemoteDsn = $null
$Plan = $null
$AuthorizedDigest = $null
$PlanDigest = $null

Remove-Item -LiteralPath $HistoryRoot -Recurse -Force
if (Test-Path -LiteralPath $HistoryRoot) {
  throw 'Private finance workspace cleanup did not complete.'
}
if (Test-NetConnection 127.0.0.1 -Port 15432 -InformationLevel Quiet -WarningAction SilentlyContinue) {
  throw 'Mattermost tunnel port is still open.'
}
if (Test-NetConnection 127.0.0.1 -Port 15433 -InformationLevel Quiet -WarningAction SilentlyContinue) {
  throw 'Platform tunnel port is still open.'
}
```

Deletion removes the working copies but cannot promise forensic erasure on an
SSD. The safety boundary is therefore: a current-user-only directory, no git or
cloud-synced location, no console output of secrets/private payloads, shortest
practical retention, and verified removal after the run.
