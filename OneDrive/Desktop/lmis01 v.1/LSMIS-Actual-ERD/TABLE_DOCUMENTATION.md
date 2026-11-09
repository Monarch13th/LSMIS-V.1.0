# LSMIS Database Table and Column Technical Documentation
## Chapter 3 System Architecture Specification

> **Database System:** PostgreSQL 17.6 (Supabase Managed Cloud Instance)  
> **Target Schema:** `public`  
> **Total Entities:** 25 Base Tables + 1 Aggregate View  
> **Total Attributes:** 416 Columns  
> **Inspection Methodology:** Direct Read-Only System Catalog Query (`information_schema.columns`, `pg_constraint`, `pg_indexes`)

---

## Entity Inventory Matrix

| # | Entity Name | Type | Module Classification | Primary Key | Column Count |
|---|-------------|:----:|-----------------------|-------------|:------------:|
| 1 | `ante_mortem_inspections` | Table | Ante-Mortem Inspection | `id` | 12 |
| 2 | `audit_logs` | Table | Audit Logs & Security | `id` | 15 |
| 3 | `carcass_branding_records` | Table | Animal Marking & Carcass Branding | `id` | 13 |
| 4 | `carcass_records` | Table | Carcass Weighing | `id` | 20 |
| 5 | `condemnation_records` | Table | Condemnation Records | `id` | 18 |
| 6 | `dispatch` | Table | Dispatch & Gate Pass | `id` | 17 |
| 7 | `evidence_records` | Table | Ante/Post-Mortem Evidence & Compliance | `id` | 17 |
| 8 | `fees` | Table | Payments and Fees (Fee Schedule) | `id` | 8 |
| 9 | `livestock` | Table | Livestock Registration & Lifecycle Master | `id` | 55 |
| 10 | `login_security` | Table | User Security & Session Control | `email` | 8 |
| 11 | `notifications` | Table | Notifications | `id` | 8 |
| 12 | `otp_rate_limits` | Table | Authentication & Security | `email` | 4 |
| 13 | `owners` | Table | Registered Owners & Owner Management | `id` | 26 |
| 14 | `payments` | Table | Payments and Fees | `id` | 21 |
| 15 | `permit_config` | Table | Meat Permit & System Settings | `id` | 11 |
| 16 | `permit_config_history` | Table | Meat Permit Audit | `id` | 12 |
| 17 | `permits` | Table | Meat Permit & Certification | `id` | 22 |
| 18 | `post_mortem_condemned_cuts` | Table | Post-Mortem Inspection & Condemnations | `id` | 19 |
| 19 | `post_mortem_inspections` | Table | Post-Mortem Inspection | `id` | 14 |
| 20 | `slaughter_processing` | Table | Team Operator Assignment & Processing | `id` | 17 |
| 21 | `slaughter_records` | Table | Slaughter Processing | `id` | 17 |
| 22 | `species` | Table | Reference & Species Configuration | `id` | 12 |
| 23 | `system_settings` | Table | Settings and Profile | `id` | 11 |
| 24 | `user_preferences` | Table | User Management & Profile Settings | `id` | 6 |
| 25 | `users` | Table | User Management & Staff Roles | `id` | 25 |
| 26 | `view_post_mortem_partial_summary` | View | Reports & Analytics (SQL View) | `*None (View)*` | 8 |

---

## `ante_mortem_inspections`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Ante-Mortem Inspection
- **Description:** Pre-slaughter veterinary inspection results, physical condition findings, suspect tracking, and clearance decisions.
- **Primary Key:** `id`
- **Total Attributes:** 12

### Engine-Enforced Constraints
- **[FOREIGN KEY] `ante_mortem_inspections_livestock_id_fkey`**: `FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE CASCADE`
- **[PRIMARY KEY] `ante_mortem_inspections_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `ante_mortem_inspections_pkey`: `CREATE UNIQUE INDEX ante_mortem_inspections_pkey ON public.ante_mortem_inspections USING btree (id)`
- `idx_ante_mortem_inspections_livestock_id`: `CREATE INDEX idx_ante_mortem_inspections_livestock_id ON public.ante_mortem_inspections USING btree (livestock_id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `livestock_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE CASCADE |
| 3 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 4 | `species` | `TEXT` | NULL | *none* | Attribute | Animal biological taxonomy (e.g., Hog, Cattle, Carabao, Goat). |
| 5 | `inspector_name` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 6 | `date` | `DATE` | **NOT NULL** | `CURRENT_DATE` | Attribute | System attribute. |
| 7 | `findings` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 8 | `decision` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 9 | `remarks` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 10 | `inspected_at` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 11 | `inspector_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 12 | `created_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |

---

## `audit_logs`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Audit Logs & Security
- **Description:** Immutable security and activity audit log capturing user actions, IP addresses, entity changes, old/new values, and severity levels.
- **Primary Key:** `id`
- **Total Attributes:** 15

### Engine-Enforced Constraints
- **[PRIMARY KEY] `audit_logs_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `audit_logs_pkey`: `CREATE UNIQUE INDEX audit_logs_pkey ON public.audit_logs USING btree (id)`
- `idx_audit_logs_action`: `CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action)`
- `idx_audit_logs_module`: `CREATE INDEX idx_audit_logs_module ON public.audit_logs USING btree (module)`
- `idx_audit_logs_role`: `CREATE INDEX idx_audit_logs_role ON public.audit_logs USING btree (role)`
- `idx_audit_logs_role_timestamp`: `CREATE INDEX idx_audit_logs_role_timestamp ON public.audit_logs USING btree (role, "timestamp" DESC)`
- `idx_audit_logs_tag_number`: `CREATE INDEX idx_audit_logs_tag_number ON public.audit_logs USING btree (tag_number)`
- `idx_audit_logs_timestamp`: `CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs USING btree ("timestamp" DESC)`
- `idx_audit_logs_user_id`: `CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id)`
- `idx_audit_logs_user_id_timestamp`: `CREATE INDEX idx_audit_logs_user_id_timestamp ON public.audit_logs USING btree (user_id, "timestamp" DESC)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `user` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 3 | `role` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 4 | `action` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 5 | `module` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 6 | `timestamp` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 7 | `ip` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 8 | `tag_number` | `TEXT` | NULL | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 9 | `old_value` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 10 | `new_value` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 11 | `field_changed` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 12 | `security_event` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 13 | `severity` | `TEXT` | NULL | `'info'::text` | Attribute | System attribute. |
| 14 | `user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 15 | `created_at` | `TIMESTAMPTZ` | NULL | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |

---

## `carcass_branding_records`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Animal Marking & Carcass Branding
- **Description:** Official veterinary branding records with unique alphanumeric branding codes (INSPECTED_AND_PASSED, CONDEMNED).
- **Primary Key:** `id`
- **Total Attributes:** 13

### Engine-Enforced Constraints
- **[CHECK] `carcass_branding_records_branding_status_check`**: `CHECK ((branding_status = ANY (ARRAY['PENDING'::text, 'BRANDED'::text, 'CANCELLED'::text])))`
- **[CHECK] `carcass_branding_records_branding_type_check`**: `CHECK ((branding_type = ANY (ARRAY['CARCASS_IDENTIFICATION'::text, 'INSPECTED_AND_PASSED'::text, 'INSPECTED_AND_CONDEMNED'::text])))`
- **[FOREIGN KEY] `carcass_branding_records_branded_by_fkey`**: `FOREIGN KEY (branded_by) REFERENCES users(id) ON DELETE SET NULL`
- **[FOREIGN KEY] `carcass_branding_records_carcass_id_fkey`**: `FOREIGN KEY (carcass_id) REFERENCES carcass_records(id) ON DELETE CASCADE`
- **[FOREIGN KEY] `carcass_branding_records_livestock_id_fkey`**: `FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE SET NULL`
- **[PRIMARY KEY] `carcass_branding_records_pkey`**: `PRIMARY KEY (id)`
- **[UNIQUE] `carcass_branding_code_unique`**: `UNIQUE (branding_code)`
- **[UNIQUE] `carcass_single_active_brand_unique`**: `UNIQUE (carcass_id, branding_type)`

### Physical Indexes
- `carcass_branding_code_unique`: `CREATE UNIQUE INDEX carcass_branding_code_unique ON public.carcass_branding_records USING btree (branding_code)`
- `carcass_branding_records_pkey`: `CREATE UNIQUE INDEX carcass_branding_records_pkey ON public.carcass_branding_records USING btree (id)`
- `carcass_single_active_brand_unique`: `CREATE UNIQUE INDEX carcass_single_active_brand_unique ON public.carcass_branding_records USING btree (carcass_id, branding_type)`
- `idx_carcass_branding_carcass_id`: `CREATE INDEX idx_carcass_branding_carcass_id ON public.carcass_branding_records USING btree (carcass_id)`
- `idx_carcass_branding_code`: `CREATE INDEX idx_carcass_branding_code ON public.carcass_branding_records USING btree (branding_code)`
- `idx_carcass_branding_status`: `CREATE INDEX idx_carcass_branding_status ON public.carcass_branding_records USING btree (branding_status)`
- `idx_carcass_branding_tag_number`: `CREATE INDEX idx_carcass_branding_tag_number ON public.carcass_branding_records USING btree (tag_number)`
- `idx_carcass_branding_type`: `CREATE INDEX idx_carcass_branding_type ON public.carcass_branding_records USING btree (branding_type)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `UUID` | **NOT NULL** | `gen_random_uuid()` | **PK** | Surrogate or natural primary key identifier. |
| 2 | `carcass_id` | `UUID` | **NOT NULL** | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (carcass_id) REFERENCES carcass_records(id) ON DELETE CASCADE |
| 3 | `livestock_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE SET NULL |
| 4 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 5 | `branding_code` | `TEXT` | **NOT NULL** | *none* | UNIQUE | System attribute. |
| 6 | `branding_type` | `TEXT` | **NOT NULL** | *none* | UNIQUE | System attribute. |
| 7 | `branding_status` | `TEXT` | **NOT NULL** | `'PENDING'::text` | Attribute | System attribute. |
| 8 | `branded_at` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 9 | `branded_by` | `UUID` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (branded_by) REFERENCES users(id) ON DELETE SET NULL |
| 10 | `cancellation_reason` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 11 | `notes` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 12 | `created_at` | `TIMESTAMPTZ` | **NOT NULL** | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 13 | `updated_at` | `TIMESTAMPTZ` | **NOT NULL** | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |

---

## `carcass_records`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Carcass Weighing
- **Description:** Post-slaughter carcass measurement logging warm carcass weight, cold weight, quality grade, and condemnation tags.
- **Primary Key:** `id`
- **Total Attributes:** 20

### Engine-Enforced Constraints
- **[PRIMARY KEY] `carcass_records_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `carcass_records_pkey`: `CREATE UNIQUE INDEX carcass_records_pkey ON public.carcass_records USING btree (id)`
- `idx_carcass_tag_number`: `CREATE INDEX idx_carcass_tag_number ON public.carcass_records USING btree (tag_number)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `UUID` | **NOT NULL** | `gen_random_uuid()` | **PK** | Surrogate or natural primary key identifier. |
| 2 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 3 | `slaughter_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 4 | `quantity` | `INTEGER` | **NOT NULL** | `1` | Attribute | System attribute. |
| 5 | `total_weight` | `NUMERIC` | **NOT NULL** | *none* | Attribute | System attribute. |
| 6 | `hot_weight` | `NUMERIC` | NULL | *none* | Attribute | System attribute. |
| 7 | `cold_weight` | `NUMERIC` | NULL | *none* | Attribute | System attribute. |
| 8 | `organ_weight` | `NUMERIC` | NULL | *none* | Attribute | System attribute. |
| 9 | `grade` | `TEXT` | NULL | `'A'::text` | Attribute | System attribute. |
| 10 | `operator` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 11 | `date` | `DATE` | **NOT NULL** | `CURRENT_DATE` | Attribute | System attribute. |
| 12 | `status` | `TEXT` | NULL | `'Weighed'::text` | Attribute | System attribute. |
| 13 | `weighed_at` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 14 | `created_at` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 15 | `weighed_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 16 | `weighed_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 17 | `brand_code` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 18 | `branding_status` | `TEXT` | NULL | `'Branded'::text` | Attribute | System attribute. |
| 19 | `brand_method` | `TEXT` | NULL | `'Official Meat Inspection Stamp (Food-Grade Ink)'::text` | Attribute | System attribute. |
| 20 | `weighed_by_role` | `TEXT` | NULL | `'vet'::text` | Attribute | System attribute. |

---

## `condemnation_records`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Condemnation Records
- **Description:** Formal condemnation certificates and disposal logs for entire carcasses or major parts condemned during inspection.
- **Primary Key:** `id`
- **Total Attributes:** 18

### Engine-Enforced Constraints
- **[FOREIGN KEY] `condemnation_records_livestock_id_fkey`**: `FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE CASCADE`
- **[PRIMARY KEY] `condemnation_records_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `condemnation_records_pkey`: `CREATE UNIQUE INDEX condemnation_records_pkey ON public.condemnation_records USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `livestock_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE CASCADE |
| 3 | `date` | `DATE` | **NOT NULL** | `CURRENT_DATE` | Attribute | System attribute. |
| 4 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 5 | `species` | `TEXT` | **NOT NULL** | *none* | Attribute | Animal biological taxonomy (e.g., Hog, Cattle, Carabao, Goat). |
| 6 | `reason` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 7 | `part` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 8 | `quantity` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 9 | `inspector` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 10 | `notes` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 11 | `weight_kg` | `NUMERIC` | NULL | `0.00` | Attribute | System attribute. |
| 12 | `location` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 13 | `disposition` | `TEXT` | NULL | `'Condemned / Rendered'::text` | Attribute | System attribute. |
| 14 | `findings` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 15 | `photo_url` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 16 | `file_url` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 17 | `inspector_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 18 | `created_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |

---

## `dispatch`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Dispatch & Gate Pass
- **Description:** Meat dispatch records, gate pass tracking, release timestamps, carrier transport details, and destination verification.
- **Primary Key:** `id`
- **Total Attributes:** 17

### Engine-Enforced Constraints
- **[FOREIGN KEY] `dispatch_owner_id_fkey`**: `FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL`
- **[PRIMARY KEY] `dispatch_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `dispatch_pkey`: `CREATE UNIQUE INDEX dispatch_pkey ON public.dispatch USING btree (id)`
- `idx_dispatch_owner_id`: `CREATE INDEX idx_dispatch_owner_id ON public.dispatch USING btree (owner_id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `owner_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL |
| 3 | `owner_name` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 4 | `carcass_weight` | `NUMERIC` | NULL | *none* | Attribute | System attribute. |
| 5 | `organ_weight` | `NUMERIC` | NULL | *none* | Attribute | System attribute. |
| 6 | `driver` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 7 | `vehicle` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 8 | `released_date` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 9 | `status` | `TEXT` | NULL | `'Released'::text` | Attribute | System attribute. |
| 10 | `destination` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 11 | `permit_config_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 12 | `tags` | `JSONB` | NULL | `'[]'::jsonb` | Attribute | Structured JSON array/object storing audit log snapshots or parameter maps. |
| 13 | `released_at` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 14 | `dispatched_at` | `TIMESTAMPTZ` | NULL | `clock_timestamp()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 15 | `created_at` | `TIMESTAMPTZ` | NULL | `clock_timestamp()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 16 | `dispatched_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 17 | `dispatched_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |

---

## `evidence_records`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Ante/Post-Mortem Evidence & Compliance
- **Description:** Photographic and document evidence attachments supporting condemnation decisions or abnormal veterinary findings.
- **Primary Key:** `id`
- **Total Attributes:** 17

### Engine-Enforced Constraints
- **[FOREIGN KEY] `evidence_records_uploaded_by_fkey`**: `FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL`
- **[PRIMARY KEY] `evidence_records_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `evidence_records_pkey`: `CREATE UNIQUE INDEX evidence_records_pkey ON public.evidence_records USING btree (id)`
- `idx_evidence_records_tag_number`: `CREATE INDEX idx_evidence_records_tag_number ON public.evidence_records USING btree (tag_number)`
- `idx_evidence_records_uploaded_by`: `CREATE INDEX idx_evidence_records_uploaded_by ON public.evidence_records USING btree (uploaded_by)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `created_at` | `TIMESTAMPTZ` | **NOT NULL** | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 3 | `date` | `DATE` | **NOT NULL** | `CURRENT_DATE` | Attribute | System attribute. |
| 4 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 5 | `type` | `TEXT` | **NOT NULL** | `'Photo'::text` | Attribute | System attribute. |
| 6 | `file_name` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 7 | `file_path` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 8 | `file_url` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 9 | `file_size` | `BIGINT` | NULL | *none* | Attribute | System attribute. |
| 10 | `mime_type` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 11 | `uploaded_by` | `UUID` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL |
| 12 | `inspection_type` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 13 | `status` | `TEXT` | **NOT NULL** | `'Active'::text` | Attribute | System attribute. |
| 14 | `notes` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 15 | `file_preview` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 16 | `photos` | `JSONB` | NULL | `'[]'::jsonb` | Attribute | Structured JSON array/object storing audit log snapshots or parameter maps. |
| 17 | `file_urls` | `JSONB` | NULL | `'[]'::jsonb` | Attribute | Structured JSON array/object storing audit log snapshots or parameter maps. |

---

## `fees`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Payments and Fees (Fee Schedule)
- **Description:** Official fee rate schedule storing slaughterhouse tariffs, ante-mortem fees, post-mortem fees, and corral fees by species.
- **Primary Key:** `id`
- **Total Attributes:** 8

### Engine-Enforced Constraints
- **[PRIMARY KEY] `fees_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `fees_pkey`: `CREATE UNIQUE INDEX fees_pkey ON public.fees USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `fee_name` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 3 | `animal_type` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 4 | `method` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 5 | `rate` | `NUMERIC` | **NOT NULL** | `0.00` | Attribute | System attribute. |
| 6 | `effective_date` | `DATE` | **NOT NULL** | *none* | Attribute | System attribute. |
| 7 | `status` | `TEXT` | **NOT NULL** | `'Active'::text` | Attribute | System attribute. |
| 8 | `updated_at` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |

---

## `livestock`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Livestock Registration & Lifecycle Master
- **Description:** Central orchestrator of livestock intake, physical attributes, marking tracking, 24h fallback, and multi-stage lifecycle timestamps.
- **Primary Key:** `id`
- **Total Attributes:** 55

### Engine-Enforced Constraints
- **[FOREIGN KEY] `livestock_owner_id_fkey`**: `FOREIGN KEY (owner_id) REFERENCES owners(id) ON UPDATE CASCADE ON DELETE SET NULL`
- **[PRIMARY KEY] `livestock_pkey`**: `PRIMARY KEY (id)`
- **[UNIQUE] `livestock_tag_number_key`**: `UNIQUE (tag_number)`

### Physical Indexes
- `idx_livestock_created_at`: `CREATE INDEX idx_livestock_created_at ON public.livestock USING btree (created_at)`
- `idx_livestock_owner_id`: `CREATE INDEX idx_livestock_owner_id ON public.livestock USING btree (owner_id)`
- `idx_livestock_status`: `CREATE INDEX idx_livestock_status ON public.livestock USING btree (status)`
- `livestock_pkey`: `CREATE UNIQUE INDEX livestock_pkey ON public.livestock USING btree (id)`
- `livestock_tag_number_key`: `CREATE UNIQUE INDEX livestock_tag_number_key ON public.livestock USING btree (tag_number)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 3 | `species` | `TEXT` | **NOT NULL** | *none* | Attribute | Animal biological taxonomy (e.g., Hog, Cattle, Carabao, Goat). |
| 5 | `sex` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 6 | `age_months` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 7 | `weight` | `NUMERIC` | NULL | *none* | Attribute | System attribute. |
| 8 | `owner_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (owner_id) REFERENCES owners(id) ON UPDATE CASCADE ON DELETE SET NULL |
| 9 | `owner_name` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 10 | `received_date` | `DATE` | **NOT NULL** | `CURRENT_DATE` | Attribute | System attribute. |
| 11 | `status` | `TEXT` | NULL | `'Pending'::text` | Attribute | System attribute. |
| 12 | `quantity` | `INTEGER` | NULL | `1` | Attribute | System attribute. |
| 13 | `marked` | `BOOLEAN` | **NOT NULL** | `false` | Attribute | System attribute. |
| 14 | `mark_type` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 15 | `mark_date` | `DATE` | NULL | *none* | Attribute | System attribute. |
| 16 | `permit_issued_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 17 | `registered_at` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 18 | `dispatched_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 19 | `released_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 20 | `marked_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 21 | `fallback_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 22 | `fallback_reason` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 23 | `marking_history` | `JSONB` | NULL | `'[]'::jsonb` | Attribute | Structured JSON array/object storing audit log snapshots or parameter maps. |
| 24 | `created_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 25 | `created_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 26 | `registered_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 27 | `registered_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 28 | `received_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 29 | `received_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 30 | `received_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 31 | `marked_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 32 | `marked_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 33 | `ante_inspected_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 34 | `ante_inspected_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 35 | `ante_inspected_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 36 | `slaughtered_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 37 | `slaughtered_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 38 | `slaughtered_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 39 | `weighed_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 40 | `weighed_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 41 | `weighed_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 42 | `post_inspected_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 43 | `post_inspected_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 44 | `post_inspected_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 45 | `paid_by_staff` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 46 | `paid_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 47 | `paid_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 48 | `permit_issued_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 49 | `permit_issued_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 50 | `dispatched_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 51 | `dispatched_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 52 | `process_history` | `JSONB` | NULL | `'[]'::jsonb` | Attribute | Structured JSON array/object storing audit log snapshots or parameter maps. |
| 53 | `created_at` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 54 | `reassigned_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 55 | `previous_operator` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 56 | `species_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |

---

## `login_security`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** User Security & Session Control
- **Description:** Active concurrent session tracking, single-session enforcement, and heartbeat timestamps.
- **Primary Key:** `email`
- **Total Attributes:** 8

### Engine-Enforced Constraints
- **[PRIMARY KEY] `login_security_pkey`**: `PRIMARY KEY (email)`

### Physical Indexes
- `login_security_pkey`: `CREATE UNIQUE INDEX login_security_pkey ON public.login_security USING btree (email)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `email` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `failed_attempts` | `INTEGER` | **NOT NULL** | `0` | Attribute | System attribute. |
| 3 | `locked_until` | `TIMESTAMPTZ` | NULL | *none* | Attribute | System attribute. |
| 4 | `last_failed_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 5 | `active_session_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 6 | `active_session_updated_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 7 | `created_at` | `TIMESTAMPTZ` | **NOT NULL** | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 8 | `updated_at` | `TIMESTAMPTZ` | **NOT NULL** | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |

---

## `notifications`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Notifications
- **Description:** In-app notification messages sent to owners and staff regarding inspection results, payment requests, and permit readiness.
- **Primary Key:** `id`
- **Total Attributes:** 8

### Engine-Enforced Constraints
- **[FOREIGN KEY] `notifications_owner_id_fkey`**: `FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE`
- **[PRIMARY KEY] `notifications_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `idx_notifications_owner_id`: `CREATE INDEX idx_notifications_owner_id ON public.notifications USING btree (owner_id)`
- `idx_notifications_read`: `CREATE INDEX idx_notifications_read ON public.notifications USING btree (read)`
- `notifications_pkey`: `CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `title` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 3 | `message` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 4 | `date` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 5 | `read` | `BOOLEAN` | NULL | `false` | Attribute | System attribute. |
| 6 | `type` | `TEXT` | NULL | `'info'::text` | Attribute | System attribute. |
| 7 | `owner_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE |
| 8 | `role` | `TEXT` | NULL | *none* | Attribute | System attribute. |

---

## `otp_rate_limits`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Authentication & Security
- **Description:** Rate limiting store for one-time passwords and verification code dispatch prevention.
- **Primary Key:** `email`
- **Total Attributes:** 4

### Engine-Enforced Constraints
- **[PRIMARY KEY] `otp_rate_limits_pkey`**: `PRIMARY KEY (email)`

### Physical Indexes
- `otp_rate_limits_pkey`: `CREATE UNIQUE INDEX otp_rate_limits_pkey ON public.otp_rate_limits USING btree (email)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `email` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `request_count` | `INTEGER` | NULL | `1` | Attribute | System attribute. |
| 3 | `last_request` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | System attribute. |
| 4 | `blocked_until` | `TIMESTAMPTZ` | NULL | *none* | Attribute | System attribute. |

---

## `owners`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Registered Owners & Owner Management
- **Description:** Registered livestock owners, traders, and farmer credentials with account verification, terms acceptance, and approval workflows.
- **Primary Key:** `id`
- **Total Attributes:** 26

### Engine-Enforced Constraints
- **[PRIMARY KEY] `owners_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `idx_owners_auth_user_id`: `CREATE INDEX idx_owners_auth_user_id ON public.owners USING btree (auth_user_id)`
- `idx_owners_email_lower`: `CREATE INDEX idx_owners_email_lower ON public.owners USING btree (lower(email))`
- `idx_owners_email_unique`: `CREATE UNIQUE INDEX idx_owners_email_unique ON public.owners USING btree (lower(email)) WHERE ((email IS NOT NULL) AND (email <> ''::text))`
- `idx_owners_google_id`: `CREATE INDEX idx_owners_google_id ON public.owners USING btree (google_id)`
- `idx_owners_status`: `CREATE INDEX idx_owners_status ON public.owners USING btree (status)`
- `idx_owners_username_unique`: `CREATE UNIQUE INDEX idx_owners_username_unique ON public.owners USING btree (lower(username)) WHERE ((username IS NOT NULL) AND (username <> ''::text))`
- `owners_pkey`: `CREATE UNIQUE INDEX owners_pkey ON public.owners USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `name` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 3 | `contact` | `TEXT` | NULL | `''::text` | Attribute | System attribute. |
| 4 | `address` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 5 | `registered_date` | `DATE` | **NOT NULL** | `CURRENT_DATE` | Attribute | System attribute. |
| 6 | `total_animals` | `INTEGER` | **NOT NULL** | `0` | Attribute | System attribute. |
| 7 | `email` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 8 | `username` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 9 | `status` | `TEXT` | **NOT NULL** | `'Approved'::text` | Attribute | System attribute. |
| 10 | `email_verified` | `BOOLEAN` | **NOT NULL** | `false` | Attribute | System attribute. |
| 11 | `email_verified_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 12 | `agreement_status` | `BOOLEAN` | **NOT NULL** | `false` | Attribute | System attribute. |
| 13 | `agreement_version` | `TEXT` | NULL | `'v1.0-2026'::text` | Attribute | System attribute. |
| 14 | `agreement_accepted_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 15 | `approved_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 16 | `approved_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 17 | `rejection_reason` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 18 | `suspension_reason` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 19 | `history` | `JSONB` | NULL | `'[]'::jsonb` | Attribute | Structured JSON array/object storing audit log snapshots or parameter maps. |
| 20 | `created_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 21 | `created_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 22 | `created_at` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 23 | `google_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 24 | `auth_user_id` | `UUID` | NULL | *none* | App-FK / Business Key | System attribute. |
| 25 | `avatar_url` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 26 | `auth_provider` | `TEXT` | NULL | `'email'::text` | Attribute | System attribute. |

---

## `payments`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Payments and Fees
- **Description:** Slaughterhouse billing and payment records, official receipt (O.R.) tracking, payment status, breakdown items, and staff reference.
- **Primary Key:** `id`
- **Total Attributes:** 21

### Engine-Enforced Constraints
- **[FOREIGN KEY] `payments_fee_id_fkey`**: `FOREIGN KEY (fee_id) REFERENCES fees(id) ON DELETE SET NULL`
- **[FOREIGN KEY] `payments_livestock_id_fkey`**: `FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE SET NULL`
- **[PRIMARY KEY] `payments_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `idx_payments_created_at`: `CREATE INDEX idx_payments_created_at ON public.payments USING btree (created_at)`
- `idx_payments_fee_id`: `CREATE INDEX idx_payments_fee_id ON public.payments USING btree (fee_id)`
- `idx_payments_livestock_id`: `CREATE INDEX idx_payments_livestock_id ON public.payments USING btree (livestock_id)`
- `idx_payments_status`: `CREATE INDEX idx_payments_status ON public.payments USING btree (status)`
- `payments_pkey`: `CREATE UNIQUE INDEX payments_pkey ON public.payments USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `UUID` | **NOT NULL** | `gen_random_uuid()` | **PK** | Surrogate or natural primary key identifier. |
| 2 | `date` | `DATE` | **NOT NULL** | `CURRENT_DATE` | Attribute | System attribute. |
| 3 | `receipt_no` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 4 | `owner_name` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 5 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 6 | `animal_type` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 7 | `quantity` | `INTEGER` | **NOT NULL** | `1` | Attribute | System attribute. |
| 8 | `weight` | `NUMERIC` | **NOT NULL** | `0.00` | Attribute | System attribute. |
| 9 | `method` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 10 | `rate` | `NUMERIC` | **NOT NULL** | `0.00` | Attribute | System attribute. |
| 11 | `amount` | `NUMERIC` | **NOT NULL** | `0.00` | Attribute | System attribute. |
| 12 | `status` | `TEXT` | **NOT NULL** | `'Paid'::text` | Attribute | System attribute. |
| 13 | `staff_name` | `TEXT` | **NOT NULL** | `'Staff'::text` | Attribute | System attribute. |
| 14 | `livestock_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE SET NULL |
| 15 | `fee_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (fee_id) REFERENCES fees(id) ON DELETE SET NULL |
| 16 | `species` | `TEXT` | NULL | *none* | Attribute | Animal biological taxonomy (e.g., Hog, Cattle, Carabao, Goat). |
| 17 | `fee_name` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 18 | `paid_at` | `TIMESTAMPTZ` | NULL | `clock_timestamp()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 19 | `created_at` | `TIMESTAMPTZ` | NULL | `clock_timestamp()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 20 | `staff_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 21 | `processed_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |

---

## `permit_config`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Meat Permit & System Settings
- **Description:** Active configuration for permit generation including numbering prefix, slaughterhouse name, veterinary officer in-charge, and seal info.
- **Primary Key:** `id`
- **Total Attributes:** 11

### Engine-Enforced Constraints
- **[PRIMARY KEY] `permit_config_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `permit_config_pkey`: `CREATE UNIQUE INDEX permit_config_pkey ON public.permit_config USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | `'default'::text` | **PK** | Surrogate or natural primary key identifier. |
| 2 | `permit_prefix` | `TEXT` | **NOT NULL** | `'permit-'::text` | Attribute | System attribute. |
| 3 | `origin` | `TEXT` | **NOT NULL** | `'TAPON TINAAN'::text` | Attribute | System attribute. |
| 4 | `destination` | `TEXT` | **NOT NULL** | `'NEW PEOPLES MARKET'::text` | Attribute | System attribute. |
| 5 | `address` | `TEXT` | **NOT NULL** | `'EAST POBLACION'::text` | Attribute | System attribute. |
| 6 | `time_issued` | `TEXT` | NULL | `''::text` | Attribute | System attribute. |
| 7 | `conveyance` | `TEXT` | **NOT NULL** | `'MEAT VAN'::text` | Attribute | System attribute. |
| 8 | `plate_no` | `TEXT` | NULL | `''::text` | Attribute | System attribute. |
| 9 | `inspector` | `TEXT` | **NOT NULL** | `'NERISSA U. VELOSO'::text` | Attribute | System attribute. |
| 10 | `city_vet` | `TEXT` | **NOT NULL** | `'DR. RAYMUNDO VALENTINE P. PAMIREZ'::text` | Attribute | System attribute. |
| 11 | `updated_at` | `TIMESTAMPTZ` | **NOT NULL** | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |

---

## `permit_config_history`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Meat Permit Audit
- **Description:** Historical audit log of changes made to permit configuration and signing authority.
- **Primary Key:** `id`
- **Total Attributes:** 12

### Engine-Enforced Constraints
- **[PRIMARY KEY] `permit_config_history_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `permit_config_history_pkey`: `CREATE UNIQUE INDEX permit_config_history_pkey ON public.permit_config_history USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `UUID` | **NOT NULL** | `gen_random_uuid()` | **PK** | Surrogate or natural primary key identifier. |
| 2 | `permit_prefix` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 3 | `origin` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 4 | `destination` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 5 | `address` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 6 | `time_issued` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 7 | `conveyance` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 8 | `plate_no` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 9 | `inspector` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 10 | `city_vet` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 11 | `updated_at` | `TIMESTAMPTZ` | **NOT NULL** | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 12 | `changed_by` | `UUID` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |

---

## `permits`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Meat Permit & Certification
- **Description:** Meat Inspection Certificate (MIC) and slaughter permit issuance logs, meat destination, conveyance vehicle, and validity status.
- **Primary Key:** `id`
- **Total Attributes:** 22

### Engine-Enforced Constraints
- **[CHECK] `permits_carcass_weight_check`**: `CHECK ((carcass_weight > (0)::numeric))`
- **[CHECK] `permits_status_check`**: `CHECK ((status = ANY (ARRAY['Active'::text, 'Revoked'::text, 'Used'::text])))`
- **[PRIMARY KEY] `permits_pkey`**: `PRIMARY KEY (id)`
- **[UNIQUE] `permits_permit_no_key`**: `UNIQUE (permit_no)`

### Physical Indexes
- `idx_permits_carcass_id`: `CREATE INDEX idx_permits_carcass_id ON public.permits USING btree (carcass_id)`
- `idx_permits_livestock_id`: `CREATE INDEX idx_permits_livestock_id ON public.permits USING btree (livestock_id)`
- `permits_permit_no_key`: `CREATE UNIQUE INDEX permits_permit_no_key ON public.permits USING btree (permit_no)`
- `permits_pkey`: `CREATE UNIQUE INDEX permits_pkey ON public.permits USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `UUID` | **NOT NULL** | `gen_random_uuid()` | **PK** | Surrogate or natural primary key identifier. |
| 2 | `permit_no` | `TEXT` | **NOT NULL** | *none* | UNIQUE | System attribute. |
| 3 | `livestock_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 4 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 5 | `carcass_id` | `UUID` | NULL | *none* | App-FK / Business Key | System attribute. |
| 6 | `owner_name` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 7 | `species` | `TEXT` | **NOT NULL** | *none* | Attribute | Animal biological taxonomy (e.g., Hog, Cattle, Carabao, Goat). |
| 8 | `carcass_weight` | `NUMERIC` | **NOT NULL** | *none* | Attribute | System attribute. |
| 9 | `origin` | `TEXT` | **NOT NULL** | `'TAPON TINAAN'::text` | Attribute | System attribute. |
| 10 | `destination` | `TEXT` | **NOT NULL** | `'NEW PEOPLES MARKET'::text` | Attribute | System attribute. |
| 11 | `address` | `TEXT` | NULL | `'EAST POBLACION'::text` | Attribute | System attribute. |
| 12 | `time_issued` | `TEXT` | NULL | `'3:30 AM'::text` | Attribute | System attribute. |
| 13 | `conveyance` | `TEXT` | **NOT NULL** | `'MEAT VAN'::text` | Attribute | System attribute. |
| 14 | `plate_no` | `TEXT` | **NOT NULL** | `'TBA-1234'::text` | Attribute | System attribute. |
| 15 | `inspector` | `TEXT` | **NOT NULL** | `'NERISSA U. VELOSO'::text` | Attribute | System attribute. |
| 16 | `city_vet` | `TEXT` | **NOT NULL** | `'DR. RAYMUNDO VALENTINE P. PAMIREZ'::text` | Attribute | System attribute. |
| 17 | `status` | `TEXT` | **NOT NULL** | `'Active'::text` | Attribute | System attribute. |
| 18 | `issued_at` | `TIMESTAMPTZ` | **NOT NULL** | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 19 | `created_at` | `TIMESTAMPTZ` | NULL | `clock_timestamp()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 20 | `issued_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 21 | `issued_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 22 | `config_snapshot` | `JSONB` | NULL | *none* | Attribute | Structured JSON array/object storing audit log snapshots or parameter maps. |

---

## `post_mortem_condemned_cuts`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Post-Mortem Inspection & Condemnations
- **Description:** Granular log of individual condemned organs/parts (head, liver, lungs, cuts) with weights, pathology reasons, and dispositions.
- **Primary Key:** `id`
- **Total Attributes:** 19

### Engine-Enforced Constraints
- **[CHECK] `post_mortem_condemned_cuts_weight_kg_check`**: `CHECK ((weight_kg > (0)::numeric))`
- **[FOREIGN KEY] `post_mortem_condemned_cuts_inspection_fk`**: `FOREIGN KEY (inspection_id) REFERENCES post_mortem_inspections(id) ON DELETE CASCADE`
- **[FOREIGN KEY] `post_mortem_condemned_cuts_livestock_fk`**: `FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE SET NULL`
- **[PRIMARY KEY] `post_mortem_condemned_cuts_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `idx_post_mortem_cuts_date`: `CREATE INDEX idx_post_mortem_cuts_date ON public.post_mortem_condemned_cuts USING btree (date)`
- `idx_post_mortem_cuts_inspection`: `CREATE INDEX idx_post_mortem_cuts_inspection ON public.post_mortem_condemned_cuts USING btree (inspection_id)`
- `idx_post_mortem_cuts_part`: `CREATE INDEX idx_post_mortem_cuts_part ON public.post_mortem_condemned_cuts USING btree (part)`
- `idx_post_mortem_cuts_tag`: `CREATE INDEX idx_post_mortem_cuts_tag ON public.post_mortem_condemned_cuts USING btree (tag_number)`
- `post_mortem_condemned_cuts_pkey`: `CREATE UNIQUE INDEX post_mortem_condemned_cuts_pkey ON public.post_mortem_condemned_cuts USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `UUID` | **NOT NULL** | `gen_random_uuid()` | **PK** | Surrogate or natural primary key identifier. |
| 2 | `created_at` | `TIMESTAMPTZ` | **NOT NULL** | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 3 | `date` | `DATE` | **NOT NULL** | `CURRENT_DATE` | Attribute | System attribute. |
| 4 | `inspection_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (inspection_id) REFERENCES post_mortem_inspections(id) ON DELETE CASCADE |
| 5 | `livestock_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE SET NULL |
| 6 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 7 | `species` | `TEXT` | **NOT NULL** | `'Hog'::text` | Attribute | Animal biological taxonomy (e.g., Hog, Cattle, Carabao, Goat). |
| 8 | `part` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 9 | `custom_part` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 10 | `location` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 11 | `weight_kg` | `NUMERIC` | **NOT NULL** | *none* | Attribute | System attribute. |
| 12 | `reason` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 13 | `custom_reason` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 14 | `findings` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 15 | `disposition` | `TEXT` | **NOT NULL** | `'Condemned / Rendered'::text` | Attribute | System attribute. |
| 16 | `photo_url` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 17 | `photo_name` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 18 | `inspector` | `TEXT` | **NOT NULL** | `'Dr. Dave'::text` | Attribute | System attribute. |
| 19 | `notes` | `TEXT` | NULL | *none* | Attribute | System attribute. |

---

## `post_mortem_inspections`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Post-Mortem Inspection
- **Description:** Post-mortem veterinary examination records detailing organ inspection, systemic pathology, and overall disposition.
- **Primary Key:** `id`
- **Total Attributes:** 14

### Engine-Enforced Constraints
- **[FOREIGN KEY] `post_mortem_inspections_livestock_id_fkey`**: `FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE CASCADE`
- **[PRIMARY KEY] `post_mortem_inspections_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `idx_post_mortem_inspections_livestock_id`: `CREATE INDEX idx_post_mortem_inspections_livestock_id ON public.post_mortem_inspections USING btree (livestock_id)`
- `post_mortem_inspections_pkey`: `CREATE UNIQUE INDEX post_mortem_inspections_pkey ON public.post_mortem_inspections USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `livestock_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE CASCADE |
| 3 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 4 | `species` | `TEXT` | NULL | *none* | Attribute | Animal biological taxonomy (e.g., Hog, Cattle, Carabao, Goat). |
| 5 | `inspector_name` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 6 | `date` | `DATE` | **NOT NULL** | `CURRENT_DATE` | Attribute | System attribute. |
| 7 | `findings` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 8 | `decision` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 9 | `remarks` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 10 | `raw_decision` | `TEXT` | NULL | `'Approved'::text` | Attribute | System attribute. |
| 11 | `condemned_parts` | `JSONB` | NULL | `'[]'::jsonb` | Attribute | Structured JSON array/object storing audit log snapshots or parameter maps. |
| 12 | `inspected_at` | `TIMESTAMPTZ` | NULL | `now()` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 13 | `inspector_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 14 | `created_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |

---

## `slaughter_processing`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Team Operator Assignment & Processing
- **Description:** Operational slaughter queue record for team operator assignment, real-time stage tracking, and notes.
- **Primary Key:** `id`
- **Total Attributes:** 17

### Engine-Enforced Constraints
- **[PRIMARY KEY] `slaughter_processing_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `slaughter_processing_pkey`: `CREATE UNIQUE INDEX slaughter_processing_pkey ON public.slaughter_processing USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 3 | `species` | `TEXT` | NULL | *none* | Attribute | Animal biological taxonomy (e.g., Hog, Cattle, Carabao, Goat). |
| 4 | `owner_name` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 5 | `operator` | `TEXT` | NULL | `'Unassigned'::text` | Attribute | System attribute. |
| 6 | `date` | `DATE` | **NOT NULL** | `CURRENT_DATE` | Attribute | System attribute. |
| 7 | `steps` | `JSONB` | **NOT NULL** | *none* | Attribute | Structured JSON array/object storing audit log snapshots or parameter maps. |
| 8 | `status` | `TEXT` | **NOT NULL** | `'In Progress'::text` | Attribute | System attribute. |
| 9 | `notes` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 10 | `operator_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 11 | `processed_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 12 | `processed_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 13 | `processed_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 14 | `fallback_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 15 | `fallback_reason` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 16 | `reassigned_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 17 | `previous_operator` | `TEXT` | NULL | *none* | Attribute | System attribute. |

---

## `slaughter_records`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Slaughter Processing
- **Description:** Official slaughter execution records linking operator, slaughter date/time, and initial processing.
- **Primary Key:** `id`
- **Total Attributes:** 17

### Engine-Enforced Constraints
- **[FOREIGN KEY] `slaughter_records_livestock_id_fkey`**: `FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE SET NULL`
- **[PRIMARY KEY] `slaughter_records_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `idx_slaughter_records_livestock_id`: `CREATE INDEX idx_slaughter_records_livestock_id ON public.slaughter_records USING btree (livestock_id)`
- `slaughter_records_pkey`: `CREATE UNIQUE INDEX slaughter_records_pkey ON public.slaughter_records USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `tag_number` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 3 | `species` | `TEXT` | NULL | *none* | Attribute | Animal biological taxonomy (e.g., Hog, Cattle, Carabao, Goat). |
| 4 | `owner_name` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 5 | `scheduled_date` | `DATE` | **NOT NULL** | *none* | Attribute | System attribute. |
| 6 | `slaughter_date` | `DATE` | NULL | *none* | Attribute | System attribute. |
| 7 | `status` | `TEXT` | **NOT NULL** | `'Scheduled'::text` | Attribute | System attribute. |
| 8 | `operator` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 9 | `livestock_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (livestock_id) REFERENCES livestock(id) ON DELETE SET NULL |
| 10 | `operator_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 11 | `processed_by` | `TEXT` | NULL | *none* | Attribute | Display name snapshot of executing staff member. |
| 12 | `processed_by_user_id` | `TEXT` | NULL | *none* | App-FK / Business Key | Foreign identifier of the staff member responsible for execution. |
| 13 | `processed_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 14 | `fallback_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 15 | `fallback_reason` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 16 | `reassigned_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 17 | `previous_operator` | `TEXT` | NULL | *none* | Attribute | System attribute. |

---

## `species`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Reference & Species Configuration
- **Description:** Lookup catalog defining animal species categories, holding capacities, handling rules, and fee parameters.
- **Primary Key:** `id`
- **Total Attributes:** 12

### Engine-Enforced Constraints
- **[PRIMARY KEY] `species_pkey`**: `PRIMARY KEY (id)`
- **[UNIQUE] `species_name_unique`**: `UNIQUE (name)`

### Physical Indexes
- `species_name_lower_idx`: `CREATE UNIQUE INDEX species_name_lower_idx ON public.species USING btree (lower(TRIM(BOTH FROM name)))`
- `species_name_unique`: `CREATE UNIQUE INDEX species_name_unique ON public.species USING btree (name)`
- `species_pkey`: `CREATE UNIQUE INDEX species_pkey ON public.species USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `name` | `TEXT` | **NOT NULL** | *none* | UNIQUE | System attribute. |
| 3 | `code` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 4 | `description` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 5 | `color` | `TEXT` | NULL | `'#0284c7'::text` | Attribute | System attribute. |
| 6 | `icon` | `TEXT` | NULL | `'Cow'::text` | Attribute | System attribute. |
| 7 | `status` | `TEXT` | **NOT NULL** | `'Active'::text` | Attribute | System attribute. |
| 8 | `sort_order` | `INTEGER` | NULL | `0` | Attribute | System attribute. |
| 9 | `created_at` | `TIMESTAMPTZ` | **NOT NULL** | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 10 | `updated_at` | `TIMESTAMPTZ` | **NOT NULL** | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 11 | `image_url` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 12 | `image_path` | `TEXT` | NULL | *none* | Attribute | System attribute. |

---

## `system_settings`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** Settings and Profile
- **Description:** Global slaughterhouse facility parameters, operational hours, email alert thresholds, and system flags.
- **Primary Key:** `id`
- **Total Attributes:** 11

### Engine-Enforced Constraints
- **[PRIMARY KEY] `system_settings_pkey`**: `PRIMARY KEY (id)`

### Physical Indexes
- `system_settings_pkey`: `CREATE UNIQUE INDEX system_settings_pkey ON public.system_settings USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `TEXT` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `system_name` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 3 | `organization` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 4 | `email` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 5 | `timezone` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 6 | `language` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 7 | `date_format` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 8 | `session_timeout` | `INTEGER` | NULL | *none* | Attribute | System attribute. |
| 9 | `enable_notifications` | `BOOLEAN` | NULL | `true` | Attribute | System attribute. |
| 10 | `enable_email_alerts` | `BOOLEAN` | NULL | `true` | Attribute | System attribute. |
| 11 | `enable_audit_log` | `BOOLEAN` | NULL | `true` | Attribute | System attribute. |

---

## `user_preferences`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** User Management & Profile Settings
- **Description:** Per-user interface and notification preferences, email delivery toggles, and UI theme options.
- **Primary Key:** `id`
- **Total Attributes:** 6

### Engine-Enforced Constraints
- **[PRIMARY KEY] `user_preferences_pkey`**: `PRIMARY KEY (id)`
- **[UNIQUE] `user_preferences_user_id_key`**: `UNIQUE (user_id)`
- **[UNIQUE] `user_preferences_email_key`**: `UNIQUE (email)`

### Physical Indexes
- `user_preferences_email_key`: `CREATE UNIQUE INDEX user_preferences_email_key ON public.user_preferences USING btree (email)`
- `user_preferences_pkey`: `CREATE UNIQUE INDEX user_preferences_pkey ON public.user_preferences USING btree (id)`
- `user_preferences_user_id_key`: `CREATE UNIQUE INDEX user_preferences_user_id_key ON public.user_preferences USING btree (user_id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `UUID` | **NOT NULL** | `gen_random_uuid()` | **PK** | Surrogate or natural primary key identifier. |
| 2 | `user_id` | `UUID` | NULL | *none* | App-FK / Business Key | System attribute. |
| 3 | `email` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 4 | `notification_preferences` | `JSONB` | NULL | `'{"approval_updates": true, "inspection_updates": true, "registration_updates": true, "system_announcements": true, "account_notifications": true, "livestock_process_updates": true}'::jsonb` | Attribute | Structured JSON array/object storing audit log snapshots or parameter maps. |
| 5 | `created_at` | `TIMESTAMPTZ` | NULL | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 6 | `updated_at` | `TIMESTAMPTZ` | NULL | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |

---

## `users`

- **Entity Classification:** PostgreSQL Relational Base Table
- **LSMIS Module:** User Management & Staff Roles
- **Description:** Application user profile and role repository linked to Supabase auth.users, storing staff specialization, contact, and session lockouts.
- **Primary Key:** `id`
- **Total Attributes:** 25

### Engine-Enforced Constraints
- **[FOREIGN KEY] `users_owner_id_fkey`**: `FOREIGN KEY (owner_id) REFERENCES owners(id) ON UPDATE CASCADE ON DELETE SET NULL`
- **[FOREIGN KEY] `users_id_fkey`**: `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`
- **[PRIMARY KEY] `users_pkey`**: `PRIMARY KEY (id)`
- **[UNIQUE] `users_email_key`**: `UNIQUE (email)`

### Physical Indexes
- `idx_users_owner_id`: `CREATE INDEX idx_users_owner_id ON public.users USING btree (owner_id)`
- `idx_users_role`: `CREATE INDEX idx_users_role ON public.users USING btree (role)`
- `idx_users_status`: `CREATE INDEX idx_users_status ON public.users USING btree (status)`
- `users_email_key`: `CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)`
- `users_pkey`: `CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)`

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `id` | `UUID` | **NOT NULL** | *none* | **PK** | Surrogate or natural primary key identifier. |
| 2 | `created_at` | `TIMESTAMPTZ` | **NOT NULL** | `timezone('utc'::text, now())` | Attribute | ISO timestamp with timezone recording operational milestone. |
| 3 | `full_name` | `TEXT` | **NOT NULL** | *none* | Attribute | System attribute. |
| 4 | `email` | `TEXT` | **NOT NULL** | *none* | App-FK / Business Key | System attribute. |
| 5 | `username` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 6 | `role` | `TEXT` | NULL | `'staff'::text` | Attribute | System attribute. |
| 7 | `status` | `TEXT` | NULL | `'Active'::text` | Attribute | System attribute. |
| 8 | `last_login` | `TEXT` | NULL | `'Never'::text` | Attribute | System attribute. |
| 9 | `owner_id` | `TEXT` | NULL | *none* | **FK (DB)** | Engine-enforced foreign key: FOREIGN KEY (owner_id) REFERENCES owners(id) ON UPDATE CASCADE ON DELETE SET NULL |
| 10 | `terminated_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 11 | `terminated_until` | `TIMESTAMPTZ` | NULL | *none* | Attribute | System attribute. |
| 12 | `termination_reason` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 13 | `active_session_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 14 | `active_session_updated_at` | `TIMESTAMPTZ` | NULL | *none* | Attribute | ISO timestamp with timezone recording operational milestone. |
| 15 | `google_id` | `TEXT` | NULL | *none* | App-FK / Business Key | System attribute. |
| 16 | `avatar_url` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 17 | `auth_provider` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 18 | `failed_login_attempts` | `INTEGER` | **NOT NULL** | `0` | Attribute | System attribute. |
| 19 | `locked_until` | `TIMESTAMPTZ` | NULL | *none* | Attribute | System attribute. |
| 20 | `last_failed_login` | `TIMESTAMPTZ` | NULL | *none* | Attribute | System attribute. |
| 21 | `phone` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 22 | `contact` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 23 | `address` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 24 | `license` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 25 | `specialization` | `TEXT` | NULL | *none* | Attribute | System attribute. |

---

## `view_post_mortem_partial_summary`

- **Entity Classification:** SQL Analytical View
- **LSMIS Module:** Reports & Analytics (SQL View)
- **Description:** Pre-computed aggregate analytical view summarizing partial condemnations per animal tag, total cut counts, and summed condemned weights.
- **Primary Key:** *None*
- **Total Attributes:** 8

### Data Dictionary

| # | Column Name | Data Type | Nullable | Default Value | Role / Constraint | Technical Description |
|---|-------------|-----------|:--------:|---------------|:-----------------:|-----------------------|
| 1 | `tag_number` | `TEXT` | NULL | *none* | App-FK / Business Key | Ear tag or animal barcode identifier linking to livestock lifecycle. |
| 2 | `species` | `TEXT` | NULL | *none* | Attribute | Animal biological taxonomy (e.g., Hog, Cattle, Carabao, Goat). |
| 3 | `date` | `DATE` | NULL | *none* | Attribute | System attribute. |
| 4 | `total_condemned_cuts` | `BIGINT` | NULL | *none* | Attribute | System attribute. |
| 5 | `total_condemned_weight_kg` | `NUMERIC` | NULL | *none* | Attribute | System attribute. |
| 6 | `condemned_parts_list` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 7 | `condemnation_reasons` | `TEXT` | NULL | *none* | Attribute | System attribute. |
| 8 | `inspector_name` | `TEXT` | NULL | *none* | Attribute | System attribute. |

---

