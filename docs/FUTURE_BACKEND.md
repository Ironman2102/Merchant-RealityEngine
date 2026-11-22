# What production would still need

| Concern | Prototype | Production |
|---|---|---|
| Storage | SQLite, one process (ephemeral on the serverless host) | Postgres, backups, tenant isolation |
| Sessions | Database sessions; 30-minute signed cookies on serverless | PA single sign-on, shared revocation |
| Keys | Environment variable | KMS or HSM, rotation |
| Audit | Hash chain and keyed row seals; a checkpoint printed on demand | Checkpoint anchored externally every day |
| Ingestion | Daily files, 6 MB uploads | Streaming or bulk load, data-quality monitoring |
| Category norms | Expert priors for about 40 MCCs | Peer norms from the PA's own portfolio |
| Network view | Peers supplied with the file | Portfolio-wide beneficiary and payer graph |
| Passport intake | Analyst form | Merchant portal with document checks |
| Follow-up | Manual after 7 days | Timers, reminders, escalation queue |
| Reporting | Draft STR facts | FIU-IND's own format, filed by the Principal Officer |
| Assurance | Automated probes | Independent penetration test, legal review |
