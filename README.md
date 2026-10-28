# MedVault

Electronic health record web app built with a security-first approach: role-based access, two-factor authentication, hashed passwords, audit logging and TLS. Individual project for the Cybersecurity Fundamentals course at Universidad de los Andes (Chile), 2026. It started from a minimal course template (Express server, Docker setup) and was extended across four iterations.

## Features

- **Roles:** admin, doctor, nurse, staff and patient, each with its own permissions.
- **Patients and clinical files:** patient records, medical visits (diagnosis and observations) and attached documents.
- **Documents:** upload and download per patient, with a SHA-256 hash stored for each file.
- **User management:** admins create users and assign roles.

## Security

| Area | Implementation |
|------|----------------|
| Passwords | bcrypt (cost 12). A startup script migrates legacy plain-text passwords to hashes |
| 2FA | TOTP (`otplib`) with QR enrollment, plus a separate login step for users with 2FA enabled |
| Brute force | Rate limiting on login (5 attempts per 10 minutes) |
| Authorization | `requireAuth` / `requireRole` middleware on every protected route |
| Input validation | `express-validator` on login, user, patient and record inputs |
| SQL injection | Parameterized queries only (`pg`) |
| Path traversal | Resolved paths are checked to stay inside the files directory |
| Sessions | `httpOnly`, `sameSite=strict`, `secure` in production, idle timeout, invalidated on server restart |
| Audit | Structured JSON log (winston) with user, role, action, resource, status and IP |
| Transport | HTTP/2 over TLS in production, TLS to PostgreSQL with certificate verification |

## Tech stack

Node.js · Express · EJS · PostgreSQL · Docker / Docker Compose · bcrypt · otplib · winston

## Running locally

Requirements: Docker and Docker Compose.

```bash
docker compose up --build
```

Open http://localhost:3000. On startup the database is created from `init.sql` and loaded with **fictitious** demo data from `seed/`.

| Role | Email | Password |
|------|-------|----------|
| admin | admin@medvault.test | Admin123! |
| doctor | doctor@medvault.test | Doctor123! |
| nurse | nurse@medvault.test | Nurse123! |
| staff | staff@medvault.test | Staff123! |
| patient | patient@medvault.test | Patient123! |

These accounts exist only for local demos.

### Production mode

With `NODE_ENV=production` the app requires `SESSIONS_SECRET` and serves HTTP/2 over TLS using `SSL_CERT_PATH` / `SSL_KEY_PATH`. The entrypoint can also decode the TLS key from `CERTIFICATE_PRIVATE_KEY_BASE64` and mount remote file storage over SSHFS. Certificates and keys are never committed.

## Project structure

```
.
├── server.js            # app setup, sessions, auth middleware, HTTP/2 server
├── routes/              # auth, 2FA, patients, documents, files
├── views/               # EJS templates
├── logger.js            # winston audit logger
├── scripts/             # bcrypt password migration
├── init.sql             # database schema and seed loading
├── seed/                # fictitious demo data
├── Dockerfile
├── docker-compose.yml
└── entrypoint.sh        # DB wait/init, secrets, password migration
```
