# Livestock Slaughter and Meat Inspection Management System (LSMIS)
## Professional Crow's Foot Entity-Relationship Diagram (ERD) Specification
### Capstone Chapter 3 Technical Architecture Reference

> **Project Title:** A Web-Based Livestock Slaughter and Meat Inspection Management System (LSMIS)  
> **Database Engine:** PostgreSQL 17.6 on Supabase Managed Cloud (`zwuoebmkapoywkpyaahw`)  
> **Schema Standard:** Physical Relational Schema with Pure Crow's Foot Notation  
> **Visual Specification:** Black and White Only (Academic Standard, Pure White Background, Black Borders, No Connector Text, No Colors, No Gradients, No Shadows)  
> **Target Audience:** Technical Capstone Panel, Lead Software Architects, Database Administrators  

---

## 1. Visual ERD Deliverables Directory

The complete redesigned black-and-white visual assets are located in [`LSMIS-Actual-ERD/`](file:///c:/Users/Justin/OneDrive/Desktop/lmis01%20-%20Copy%20(2)/LSMIS-Actual-ERD) and mirrored in [`flowcharts/`](file:///c:/Users/Justin/OneDrive/Desktop/lmis01%20-%20Copy%20(2)/flowcharts):

| Asset Deliverable | Format | Technical Characteristics & Usage | File Link |
|-------------------|:------:|-----------------------------------|:---------:|
| **Interactive ERD Web Viewer** | HTML5 / SVG | Clean black-and-white vector viewer with crisp typography and responsive layout. | [`LSMIS_Professional_Crow_Foot_ERD.html`](file:///c:/Users/Justin/OneDrive/Desktop/lmis01%20-%20Copy%20(2)/LSMIS-Actual-ERD/LSMIS_Professional_Crow_Foot_ERD.html) |
| **Scalable Vector ERD Source** | SVG | Pure SVG 1.1 vector diagram with dual-ended Crow's foot glyphs, orthogonal Manhattan channel routing, and zero text on connectors. | [`LSMIS_Professional_Crow_Foot_ERD.svg`](file:///c:/Users/Justin/OneDrive/Desktop/lmis01%20-%20Copy%20(2)/LSMIS-Actual-ERD/LSMIS_Professional_Crow_Foot_ERD.svg) |
| **High-Resolution Graphic** | PNG (1920 × 2250) | High-definition monochrome raster graphic suitable for insertion into Microsoft Word, LaTeX, or PowerPoint defense slides. | [`LSMIS_Professional_Crow_Foot_ERD.png`](file:///c:/Users/Justin/OneDrive/Desktop/lmis01%20-%20Copy%20(2)/LSMIS-Actual-ERD/LSMIS_Professional_Crow_Foot_ERD.png) |
| **Vector PDF Print Master** | PDF | Infinitely scalable monochrome vector document for thesis manuscript printing and technical binder documentation. | [`LSMIS_Professional_Crow_Foot_ERD.pdf`](file:///c:/Users/Justin/OneDrive/Desktop/lmis01%20-%20Copy%20(2)/LSMIS-Actual-ERD/LSMIS_Professional_Crow_Foot_ERD.pdf) |
| **Mermaid ERD Code** | MMD | Standard Mermaid Crow's foot specification with verified database foreign keys and application joins. | [`LSMIS_Professional_Crow_Foot_ERD.mmd`](file:///c:/Users/Justin/OneDrive/Desktop/lmis01%20-%20Copy%20(2)/LSMIS-Actual-ERD/LSMIS_Professional_Crow_Foot_ERD.mmd) |

---

## 2. Strict Visual Architecture Standards

1. **Pure Monochrome Presentation (Black and White Only)**:
   - Pure white background (`#ffffff`).
   - Solid black entity borders (`#000000`, 1.5px).
   - Solid black text (`#000000`).
   - Solid black relationship connectors (`#000000`).
   - Black Crow's Foot glyphs (`#000000`).
   - No colored tables, no colored connectors, no gradients, no shadows, and no decorative graphics.

2. **Clean Connector Architecture**:
   - **Connectors contain no text**: No relationship names, verbs, or words appear along connector lines.
   - Dual-ended Crow's Foot symbols enforce exact minimum and maximum cardinality.
   - Orthogonal Manhattan channel routing prevents connector lines from slicing through table boxes.

3. **Strict Scope Exclusions**:
   - `dispatch`: **Strictly Excluded** (removed from current LSMIS).
   - `fees`: **Strictly Excluded** (removed from current LSMIS).
   - `payments`: **Strictly Excluded** (removed from current LSMIS).
   - All associated foreign keys and relations to dispatch, fees, and payments are eliminated.
   - Nonexistent tables (`disposal_records`, `organ_inspections`, `backups_metadata`, `diseases`, `owner_otps`) are completely omitted.

---

## 3. Standard Crow's Foot Notation Key

| Crow's Foot Symbol | Multiplicity | Participation / Meaning | Database Enforcement |
|:------------------:|:------------|:------------------------|:---------------------|
| `||` | **Mandatory One (1..1)** | Exactly one instance is strictly required. | Enforced by `NOT NULL` constraint and Foreign Key validation. |
| `o|` | **Optional One (0..1)** | Zero or at most one instance may exist. | Nullable unique column or optional 1:1 relational join. |
| `|{` | **Mandatory Many (1..N)** | At least one related child record is mandatory, up to many. | Enforced via transactional application logic. |
| `o{` | **Zero-to-Many (0..N)** | Zero, one, or many child records may relate to the parent. | Standard 1:N relational foreign key with parent row created first. |

---

## 4. Database Entities Summary (22 Public Tables + `auth.users`)

### Column 1: User Identity, Security & System Administration
1. **`auth.users`**: Supabase Identity Master (`id` PK UUID, `email`, `created_at`).
2. **`users`**: Personnel and Operator Profiles (`id` PK/FK UUID $\rightarrow$ `auth.users.id`, `full_name`, `email`, `username`, `role`, `status`, `owner_id` FK $\rightarrow$ `owners.id`, `license`, `specialization`, `failed_login_attempts`, `locked_until`, `created_at`).
3. **`user_preferences`**: User Interface Preferences (`id` PK UUID, `user_id` FK UUID $\rightarrow$ `users.id`, `email`, `notification_preferences` JSONB).
4. **`login_security`**: Brute-force Prevention & Session State (`email` PK, `failed_attempts`, `locked_until`, `active_session_id`, `active_session_updated_at`).
5. **`otp_rate_limits`**: Passwordless OTP Security Throttle (`email` PK, `request_count`, `last_request`, `blocked_until`).
6. **`audit_logs`**: Regulatory Audit Trail (`id` PK, `user_id` FK $\rightarrow$ `users.id`, `user`, `role`, `action`, `module`, `tag_number`, `old_value`, `new_value`, `created_at`).
7. **`system_settings`**: Abattoir Operational Configuration Singleton (`id` PK, `system_name`, `organization`, `timezone`, `enable_notifications`, `enable_audit_log`).

### Column 2: Livestock Intake, Ownership & Taxonomy
8. **`owners`**: Accredited Farmer / Meat Trader Profiles (`id` PK TEXT, `name`, `contact`, `address`, `registered_date`, `total_animals`, `email`, `username`, `status`, `email_verified`).
9. **`notifications`**: Owner Push/Alert Messages (`id` PK, `owner_id` FK TEXT $\rightarrow$ `owners.id` ON DELETE CASCADE, `title`, `message`, `type`, `read`, `date`).
10. **`species`**: Taxonomy Catalog (`id` PK, `name`, `code`, `description`, `status`, `sort_order`).
11. **`livestock`**: Core Animal Intake Orchestrator (`id` PK TEXT, `tag_number`, `owner_id` FK $\rightarrow$ `owners.id` ON DELETE SET NULL, `species` FK $\rightarrow$ `species.name`, `sex`, `age_months`, `weight`, `status`, `marked`, `mark_type`, `received_date`, `created_at`).

### Column 3: Abattoir Floor Operations & Carcass Management
12. **`permit_config_history`**: Meat Permit Configuration Audit Revisions (`id` PK UUID, `permit_prefix`, `origin`, `city_vet`, `changed_by` FK $\rightarrow$ `users.id`, `updated_at`).
13. **`ante_mortem_inspections`**: Pre-slaughter Clinical Examination (`id` PK, `livestock_id` FK $\rightarrow$ `livestock.id` ON DELETE CASCADE, `tag_number`, `species`, `inspector_name`, `inspector_id` FK $\rightarrow$ `users.id`, `date`, `findings`, `decision`).
14. **`slaughter_processing`**: Real-time Slaughter Queue (`id` PK, `livestock_id` FK $\rightarrow$ `livestock.id`, `tag_number`, `operator`, `operator_id` FK $\rightarrow$ `users.id`, `status`, `created_at`).
15. **`slaughter_records`**: Formal Slaughter Historical Log (`id` PK, `livestock_id` FK $\rightarrow$ `livestock.id` ON DELETE SET NULL, `tag_number`, `operator`, `operator_id` FK $\rightarrow$ `users.id`, `date`, `status`).
16. **`carcass_records`**: Post-Slaughter Weight Log (`id` PK UUID, `livestock_id` FK $\rightarrow$ `livestock.id`, `tag_number`, `slaughter_id` FK $\rightarrow$ `slaughter_records.id`, `total_weight`, `hot_weight`, `cold_weight`, `organ_weight`, `grade`, `operator`).
17. **`carcass_branding_records`**: NMIS Veterinary Meat Branding Stamps (`id` PK UUID, `carcass_id` FK UUID $\rightarrow$ `carcass_records.id` ON DELETE CASCADE, `livestock_id` FK $\rightarrow$ `livestock.id` ON DELETE SET NULL, `tag_number`, `branding_code`, `branding_status`, `branded_by` FK $\rightarrow$ `users.id`, `branded_at`).

### Column 4: Veterinary Pathology & Meat Permitting
18. **`permit_config`**: Meat Permit Master Configuration Singleton (`id` PK, `permit_prefix`, `origin`, `inspector`, `city_vet`, `updated_at`).
19. **`permits`**: Meat Permit / Meat Inspection Certificate (MIC) (`id` PK UUID, `permit_no`, `livestock_id` FK $\rightarrow$ `livestock.id`, `carcass_id` FK UUID $\rightarrow$ `carcass_records.id`, `tag_number`, `owner_name`, `species`, `carcass_weight`, `destination`, `status`, `issued_at`).
20. **`post_mortem_inspections`**: Post-slaughter Visceral, Head & Carcass Examination (`id` PK, `livestock_id` FK $\rightarrow$ `livestock.id` ON DELETE CASCADE, `tag_number`, `inspector_name`, `inspector_id` FK $\rightarrow$ `users.id`, `date`, `findings`, `decision`, `inspected_at`).
21. **`post_mortem_condemned_cuts`**: Partial Condemnation Details (`id` PK UUID, `inspection_id` FK $\rightarrow$ `post_mortem_inspections.id` ON DELETE CASCADE, `livestock_id` FK $\rightarrow$ `livestock.id` ON DELETE SET NULL, `tag_number`, `part`, `weight_kg`, `reason`, `disposition`, `inspector`).
22. **`condemnation_records`**: General & Total Condemnation Registry (`id` PK, `livestock_id` FK $\rightarrow$ `livestock.id` ON DELETE CASCADE, `tag_number`, `reason`, `part`, `weight_kg`, `disposition`, `inspector_id` FK $\rightarrow$ `users.id`).
23. **`evidence_records`**: Photographic & Document Proof (`id` PK UUID, `tag_number` FK $\rightarrow$ `livestock.tag_number`, `uploaded_by` FK $\rightarrow$ `users.id` ON DELETE SET NULL, `type`, `file_name`, `file_url`, `mime_type`, `status`).

---

## 5. Verified Database Relationships (No Connector Text)

| # | Parent Entity | Child Entity | Relationship Type | Cardinality | Foreign Key Column | Enforcement |
|---|---------------|--------------|:-----------------:|:-----------:|--------------------|:-----------:|
| 1 | `auth.users` | `users` | Identifying Profile | $1..1 \rightarrow 0..1$ | `users.id` | PostgreSQL FK (`CASCADE`) |
| 2 | `owners` | `users` | Owner Portal Account | $0..1 \rightarrow 0..1$ | `users.owner_id` | PostgreSQL FK (`SET NULL`) |
| 3 | `owners` | `livestock` | Livestock Intake Ownership | $1..1 \rightarrow 0..N$ | `livestock.owner_id` | PostgreSQL FK (`SET NULL`) |
| 4 | `owners` | `notifications` | Owner Alert Notifications | $1..1 \rightarrow 0..N$ | `notifications.owner_id` | PostgreSQL FK (`CASCADE`) |
| 5 | `species` | `livestock` | Animal Taxonomy Classification | $1..1 \rightarrow 0..N$ | `livestock.species` | Application Logical Join |
| 6 | `livestock` | `ante_mortem_inspections` | Pre-slaughter Clinical Exam | $1..1 \rightarrow 0..N$ | `ante_mortem_inspections.livestock_id` | PostgreSQL FK (`CASCADE`) |
| 7 | `livestock` | `slaughter_processing` | Floor Slaughter Queue | $1..1 \rightarrow 0..1$ | `slaughter_processing.livestock_id` | Application Logical Join |
| 8 | `livestock` | `slaughter_records` | Slaughter Execution Log | $1..1 \rightarrow 0..1$ | `slaughter_records.livestock_id` | PostgreSQL FK (`SET NULL`) |
| 9 | `livestock` | `carcass_records` | Carcass Weight Record | $1..1 \rightarrow 0..1$ | `carcass_records.livestock_id` | Application Logical Join |
| 10 | `livestock` | `post_mortem_inspections` | Pathological Examination | $1..1 \rightarrow 0..1$ | `post_mortem_inspections.livestock_id` | PostgreSQL FK (`CASCADE`) |
| 11 | `post_mortem_inspections` | `post_mortem_condemned_cuts` | Partial Condemnations | $1..1 \rightarrow 0..N$ | `post_mortem_condemned_cuts.inspection_id` | PostgreSQL FK (`CASCADE`) |
| 12 | `livestock` | `condemnation_records` | Total Carcass Condemnation | $1..1 \rightarrow 0..N$ | `condemnation_records.livestock_id` | PostgreSQL FK (`CASCADE`) |
| 13 | `carcass_records` | `carcass_branding_records` | NMIS Inspection Stamp | $1..1 \rightarrow 0..N$ | `carcass_branding_records.carcass_id` | PostgreSQL FK (`CASCADE`) |
| 14 | `carcass_records` | `permits` | Carcass Permit Clearance | $0..1 \rightarrow 0..1$ | `permits.carcass_id` | Application Logical Join |
| 15 | `livestock` | `permits` | Official Meat Certificate | $1..1 \rightarrow 0..1$ | `permits.livestock_id` | Application Logical Join |
| 16 | `users` | `user_preferences` | User UI Customization | $1..1 \rightarrow 0..1$ | `user_preferences.user_id` | Application Logical Join |
| 17 | `users` | `audit_logs` | Actor Compliance Trail | $0..1 \rightarrow 0..N$ | `audit_logs.user_id` | Application Logical Join |
| 18 | `users` | `permit_config_history` | Permit Template Author | $1..1 \rightarrow 0..N$ | `permit_config_history.changed_by` | PostgreSQL FK (`SET NULL`) |
| 19 | `users` | `carcass_branding_records` | Veterinary Inspector Stamp | $1..1 \rightarrow 0..N$ | `carcass_branding_records.branded_by` | PostgreSQL FK (`SET NULL`) |
| 20 | `users` | `evidence_records` | Evidence Photographer | $1..1 \rightarrow 0..N$ | `evidence_records.uploaded_by` | PostgreSQL FK (`SET NULL`) |
