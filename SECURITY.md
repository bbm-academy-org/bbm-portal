# Security policy

## Reporting a vulnerability

**Report privately through GitHub Security Advisories — do not open a public
issue.**

→ [Report a vulnerability](https://github.com/bbm-academy-org/bbm-portal/security/advisories/new)

That form is the primary and preferred channel: private vulnerability reporting
is enabled on this repository, so the report is visible only to the maintainers
until a fix is published.

If you cannot use the form, open a public issue that says only that you have a
security report and asks for a private channel — **no details, no reproducer, no
affected endpoint**. A maintainer will open a private advisory and invite you to
it.

## What to expect

This is a small team, not a staffed security programme, so the promise is kept
deliberately modest: we aim to acknowledge a report within a few working days
and will tell you what we intend to do about it. There is no bug-bounty and no
paid reward.

Please give us a reasonable window to ship a fix before disclosing publicly.

## What is in scope

This repository is the source of a **single deployed platform** —
`portal.bbm.academy` and `cms.bbm.academy` — built from the current `main`. There
are no released or separately supported versions, so there is deliberately no
supported-versions table here: **only what is currently deployed from `main` is
supported**, and a fix ships forward rather than to a maintenance branch.

Out of scope: findings against a fork, a local development stand, or the
third-party services this platform depends on — report those to their own
maintainers.
