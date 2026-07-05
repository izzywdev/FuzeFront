# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately via GitHub's **[Private vulnerability reporting](../../security/advisories/new)**
(Security tab → "Report a vulnerability"). If that is unavailable, open a minimal
issue asking for a private contact channel — without disclosing details.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept if possible)
- Affected version(s) / commit
- Any suggested remediation

## What to expect

- Acknowledgement of your report within **5 business days**.
- An assessment and, where accepted, a remediation timeline.
- Credit in the release notes once a fix ships, unless you prefer to remain anonymous.

## Supported versions

Unless stated otherwise, only the latest released version on the default branch
receives security fixes.

## Scope

Automated scanning (SAST, secret scanning, dependency and filesystem scanning) runs
on every pull request via the **Harden Gate** workflow; results are published to this
repository's **Security** tab. Please still report anything those scans miss.
