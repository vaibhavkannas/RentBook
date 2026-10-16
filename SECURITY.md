# Security policy

RentBook is a self-hosted app. Each owner runs their own copy, with their own Vercel project, Google Cloud project and Google Sheet. This policy is about weaknesses in the RentBook code and its setup instructions. For how the app is meant to be protected, and what it cannot protect against, read [docs/product/THREAT-MODEL.md](docs/product/THREAT-MODEL.md).

## Report a vulnerability

Report it privately through a GitHub security advisory:

https://github.com/vaibhavkannas/RentBook/security/advisories/new

You need a GitHub account. Please do not open a public issue or pull request, or post the details anywhere, until a fix is available.

The same contact is published for security tools at `/.well-known/security.txt` (RFC 9116), served from `public/.well-known/security.txt`. If you run your own copy, that file points at this project's advisory page. Change it if you want reports about your own deployment to reach you.

### What to include

- What the problem is and what an attacker gains from it.
- The steps to reproduce it, and the version or commit you tried.
- How you ran it: your own deployment, or a local copy with a test Sheet.
- A suggested fix, if you have one.

Leave real secrets (service account keys, `AUTH_SECRET`, tokens, session cookies) and real tenant data out of the report. Example data is enough.

## What to expect

One person maintains RentBook, so these are targets and not promises:

- An acknowledgement within 7 days.
- A first assessment (confirmed, need more detail, or not a vulnerability) within 14 days.
- For a confirmed serious problem, a fix or a plan within 30 days. Smaller problems may take longer.
- Credit in the release notes, if you want it.

A fix reaches a deployment only when its owner updates and redeploys their copy.

## Supported versions

Only the latest tagged release gets security fixes. No release is tagged yet: v1.0.0 is planned but not tagged. Until it is, fixes go to the `main` branch only. After v1.0.0, older releases are not patched, so update to the latest one.

## Scope

In scope:

- The code in this repository.
- The setup instructions in `SETUP.md`, where following them leads to an insecure setup.

Out of scope:

- Weaknesses in Google Sheets, Google Cloud, Google sign-in, Vercel, GitHub, Auth.js, Next.js or another dependency. Report those to their own projects. If RentBook uses one of them in an unsafe way, report that here.
- A person who can already edit the Sheet changing its records. That is how a Sheet works, and the threat model lists it as a limit.
- An attacker who already controls an allowed Google account, the Vercel project, the service account key or `AUTH_SECRET`.
- A deployment that is misconfigured or out of date, for example one whose secrets were published.
- Denial of service by sending a lot of traffic, spam, social engineering, and physical access to someone's phone or computer.
- Automated scanner output with no demonstrated effect, and missing headers that have no effect on RentBook.
- Testing against someone else's deployment or reading their data. Test on your own.

## Safe harbour

If you act in good faith, I will not take or support legal action against you for your research, and I will work with you on a fix. Good faith means: you test only on your own deployment or a test copy of a Sheet, you do not access, change or keep data that is not yours, you stop and report as soon as you find a problem, you do not disrupt a service other people use, and you give a reasonable time to fix before you disclose.

This is a statement of intent by the maintainer. It is not legal advice and not a contract, and it cannot bind Google, Vercel, GitHub or the owner of someone else's deployment, whose terms still apply to you.

## For the maintainer

The `Expires` date in `public/.well-known/security.txt` has to be renewed once a year (it is 2027-10-16 now). A test checks that the date is well formed. No test fails when it passes, so keep a calendar reminder.
