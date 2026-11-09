# LSMIS Primary Keys, Foreign Keys, and Referential Integrity Guide
## Capstone Technical Reference

> **Database:** PostgreSQL 17.6 on Supabase (`zwuoebmkapoywkpyaahw`)  
> **Schema:** `public`

---

## 1. Primary Key Specification

Every table in the LSMIS database implements a primary key to ensure entity integrity:

| Entity Name | Primary Key Column | Storage Type | Key Nature | Generation Mechanism |
|-------------|--------------------|:------------:|:----------:|----------------------|
| `ante_mortem_inspections` | `id` | `TEXT` | Surrogate | Application NanoID / UUID string |
| `audit_logs` | `id` | `TEXT` | Surrogate | Client/Server generated audit ID |
| `carcass_branding_records` | `id` | `UUID` | Surrogate | PostgreSQL `gen_random_uuid()` |
| `carcass_records` | `id` | `UUID` | Surrogate | PostgreSQL `gen_random_uuid()` |
| `condemnation_records` | `id` | `TEXT` | Surrogate | Application generated record ID |
| `dispatch` | `id` | `TEXT` | Surrogate | Application generated gate pass ID |
| `evidence_records` | `id` | `UUID` | Surrogate | PostgreSQL `gen_random_uuid()` |
| `fees` | `id` | `TEXT` | Natural / Descriptive | Species tariff key (`fee-hog`, etc.) |
| `livestock` | `id` | `TEXT` | Surrogate | Application generated animal intake ID (`ls-...`) |
| `login_security` | `email` | `TEXT` | Natural | User email (1:1 with user identity) |
| `notifications` | `id` | `TEXT` | Surrogate | Application generated notification ID |
| `otp_rate_limits` | `email` | `TEXT` | Natural | User email (1:1 rate limiter) |
| `owners` | `id` | `TEXT` | Surrogate | Application owner ID (`OWN-...`) |
| `payments` | `id` | `UUID` | Surrogate | PostgreSQL `gen_random_uuid()` |
| `permit_config` | `id` | `TEXT` | Singleton | Fixed config row ID (`default`) |
| `permit_config_history` | `id` | `TEXT` | Surrogate | Application revision log ID |
| `permits` | `id` | `TEXT` | Surrogate | Application permit ID (`permit-...`) |
| `post_mortem_condemned_cuts` | `id` | `UUID` | Surrogate | PostgreSQL `gen_random_uuid()` |
| `post_mortem_inspections` | `id` | `TEXT` | Surrogate | Application inspection ID |
| `slaughter_processing` | `id` | `TEXT` | Surrogate | Slaughter operator queue item ID |
| `slaughter_records` | `id` | `TEXT` | Surrogate | Finalized slaughter log ID |
| `species` | `id` | `TEXT` | Natural | Taxonomy species code (`sp-hog`, etc.) |
| `system_settings` | `id` | `TEXT` | Singleton | Fixed settings row ID (`general`) |
| `user_preferences` | `id` | `UUID` | Surrogate | PostgreSQL `gen_random_uuid()` |
| `users` | `id` | `UUID` | Inherited Surrogate | References `auth.users(id)` |
| `view_post_mortem_partial_summary` | *None* | *N/A* | View | Grouped by `(tag_number, species, date)` |

---

## 2. PostgreSQL Engine-Enforced Foreign Keys (17 FKs)

These relationships are **physically declared in PostgreSQL** and trigger automatic constraints (reject invalid foreign keys, cascade deletes, or set null).

| # | Source Table | Source Column | Target Table | Target Column | Update Rule | Delete Rule | Constraint Name |
|---|--------------|---------------|--------------|---------------|:-----------:|:-----------:|-----------------|
| 1 | `users` | `id` | `auth.users` | `id` | `NO ACTION` | `CASCADE` | `users_id_fkey` |
| 2 | `users` | `owner_id` | `public.owners` | `id` | `CASCADE` | `SET NULL` | `users_owner_id_fkey` |
| 3 | `livestock` | `owner_id` | `public.owners` | `id` | `CASCADE` | `SET NULL` | `livestock_owner_id_fkey` |
| 4 | `ante_mortem_inspections` | `livestock_id` | `public.livestock` | `id` | `NO ACTION` | `CASCADE` | `ante_mortem_inspections_livestock_id_fkey` |
| 5 | `slaughter_records` | `livestock_id` | `public.livestock` | `id` | `NO ACTION` | `SET NULL` | `slaughter_records_livestock_id_fkey` |
| 6 | `post_mortem_inspections` | `livestock_id` | `public.livestock` | `id` | `NO ACTION` | `CASCADE` | `post_mortem_inspections_livestock_id_fkey` |
| 7 | `post_mortem_condemned_cuts` | `inspection_id` | `public.post_mortem_inspections` | `id` | `NO ACTION` | `CASCADE` | `post_mortem_condemned_cuts_inspection_fk` |
| 8 | `post_mortem_condemned_cuts` | `livestock_id` | `public.livestock` | `id` | `NO ACTION` | `SET NULL` | `post_mortem_condemned_cuts_livestock_fk` |
| 9 | `carcass_branding_records` | `carcass_id` | `public.carcass_records` | `id` | `NO ACTION` | `CASCADE` | `carcass_branding_records_carcass_id_fkey` |
| 10 | `carcass_branding_records` | `livestock_id` | `public.livestock` | `id` | `NO ACTION` | `SET NULL` | `carcass_branding_records_livestock_id_fkey` |
| 11 | `carcass_branding_records` | `branded_by` | `public.users` | `id` | `NO ACTION` | `SET NULL` | `carcass_branding_records_branded_by_fkey` |
| 12 | `condemnation_records` | `livestock_id` | `public.livestock` | `id` | `NO ACTION` | `CASCADE` | `condemnation_records_livestock_id_fkey` |
| 13 | `dispatch` | `owner_id` | `public.owners` | `id` | `NO ACTION` | `SET NULL` | `dispatch_owner_id_fkey` |
| 14 | `evidence_records` | `uploaded_by` | `public.users` | `id` | `NO ACTION` | `SET NULL` | `evidence_records_uploaded_by_fkey` |
| 15 | `notifications` | `owner_id` | `public.owners` | `id` | `NO ACTION` | `CASCADE` | `notifications_owner_id_fkey` |
| 16 | `payments` | `fee_id` | `public.fees` | `id` | `NO ACTION` | `SET NULL` | `payments_fee_id_fkey` |
| 17 | `payments` | `livestock_id` | `public.livestock` | `id` | `NO ACTION` | `SET NULL` | `payments_livestock_id_fkey` |

---

## 3. Application-Level Logical Joins (Non-Enforced)

These relationships represent critical business connections maintained in frontend/backend queries without PostgreSQL Foreign Key constraints:

| Source Column | Target Column | Business Function | Risk Evaluation |
|---------------|---------------|-------------------|-----------------|
| `permits.livestock_id` | `livestock.id` | Links Meat Inspection Certificate to animal intake | Deleting animal record may orphan permit |
| `permits.carcass_id` | `carcass_records.id` | Links permit to warm/cold carcass weight | Deleting carcass record may orphan permit |
| `carcass_records.livestock_id` | `livestock.id` | Connects carcass weighing to animal record | No FK validation on weighing entry |
| `slaughter_processing.livestock_id` | `livestock.id` | Operator queue item linked to animal | Queue item can persist if animal is deleted |
| `species.name` | `livestock.species` | Species taxonomy classification | String mismatch risk |
| `species.name` | `fees.species` | Fee tariff calculation by species | String mismatch risk |
| `permit_config.id` | `dispatch.permit_config_id` | Associates gate pass to slaughterhouse template | Safe (singleton lookup) |
| `users.id` | `user_preferences.user_id` | Connects UI preferences to user | Orphaned preferences on user removal |
| `users.id` | `audit_logs.user_id` | Actor identity in audit log | Intentional (logs must never cascade delete) |

---

## 4. Standalone / Non-Relational Entities

The following tables have **zero physical database foreign keys** (both incoming and outgoing):
1. **`species`**: System reference catalog.
2. **`system_settings`**: Singleton operational parameters.
3. **`permit_config`** & **`permit_config_history`**: Permit numbering configuration.
4. **`login_security`** & **`otp_rate_limits`**: Ephemeral security session control.
5. **`user_preferences`**: User UI configuration.
6. **`slaughter_processing`**: Operational operator queue.
7. **`permits`**: Official certificate logs.
8. **`carcass_records`**: Post-slaughter measurement logs.
