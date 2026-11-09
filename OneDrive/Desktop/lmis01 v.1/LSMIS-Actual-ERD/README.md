# Livestock Slaughter and Meat Inspection Management System (LSMIS)
## Actual Database Entity-Relationship Diagram (ERD) & Technical Specification

> **Target Database:** PostgreSQL 17.6 on Supabase (`zwuoebmkapoywkpyaahw`, `lsmis-db`)  
> **Visual Reference Standard:** Traditional SQL Workbench / DBeaver / MySQL Workbench ERD  
> **Output Folder:** `LSMIS-Actual-ERD/`  
> **Purpose:** Chapter 3 Capstone Documentation & System Defense

---

## 1. Visual ERD Deliverables

This directory contains the ground-truth physical database ERD for LSMIS, generated with individual table boxes, blue table headers, complete column names, data types, primary key (`🔑 PK`) and foreign key (`🔗 FK`) indicators, module callout badges, and Crow's Foot relationship lines:

| Deliverable File | Format | Visual Characteristics & Usage |
|------------------|:------:|--------------------------------|
| [**`LSMIS_Database_ERD.png`**](./LSMIS_Database_ERD.png) | **PNG Image (3520 × 2860)** | Ultra-HD, high-resolution graphic ready for insertion into MS Word / LaTeX Capstone Chapter 3 documentation. |
| [**`LSMIS_Database_ERD.pdf`**](./LSMIS_Database_ERD.pdf) | **Vector PDF** | Infinite-zoom vector document for printing, large-format defense presentation posters, and panelist review. |
| [**`LSMIS_Database_ERD.svg`**](./LSMIS_Database_ERD.svg) | **Vector SVG** | Scalable vector graphics source displaying the full diagram layout with Crow's Foot markers and drop-shadows. |
| [**`LSMIS_Database_ERD.html`**](./LSMIS_Database_ERD.html) | **Interactive HTML** | Standalone web viewer to inspect the diagram in any browser with pan/zoom. |
| [**`LSMIS_Database_ERD.dbml`**](./LSMIS_Database_ERD.dbml) | **DBML Source** | Standard Database Markup Language file importable into [dbdiagram.io](https://dbdiagram.io) for live visual editing. |
| [**`LSMIS_Database_ERD.puml`**](./LSMIS_Database_ERD.puml) | **PlantUML Source** | Source code renderable with PlantUML / VS Code PlantUML extensions. |
| [**`LSMIS_Database_ERD.mmd`**](./LSMIS_Database_ERD.mmd) | **Mermaid Source** | Standard Mermaid Crow's foot diagram source for markdown and GitHub previews. |

---

## 2. Technical Documentation Deliverables

| Documentation File | Contents |
|--------------------|----------|
| [**`TABLE_DOCUMENTATION.md`**](./TABLE_DOCUMENTATION.md) | Exhaustive Data Dictionary for all 25 tables + 1 view (416 columns, data types, nullability, defaults, constraints, and indexes). |
| [**`KEYS_AND_RELATIONSHIPS.md`**](./KEYS_AND_RELATIONSHIPS.md) | Primary key registry, 17 verified PostgreSQL foreign keys, application-level joins, and standalone entities. |
| [**`RELATIONSHIP_CARDINALITY.md`**](./RELATIONSHIP_CARDINALITY.md) | Crow's foot notation guide, $1:1$, $1:N$, $N:M$ multiplicity analysis for capstone defense. |

---

## 3. Database Architecture Overview

The LSMIS database is composed of **25 PostgreSQL Base Tables** and **1 Analytical View** organized into 6 functional columns across the slaughterhouse lifecycle:

1. **Owner Profiles & Security:** `owners`, `species`, `notifications`, `login_security`, `otp_rate_limits`
2. **Livestock Lifecycle Master:** `livestock` (central orchestrator with 55 columns), `system_settings`, `user_preferences`
3. **Ante-Mortem & Slaughtering:** `ante_mortem_inspections`, `slaughter_processing`, `slaughter_records`, `carcass_records`, `carcass_branding_records`
4. **Post-Mortem & Condemnations:** `post_mortem_inspections`, `post_mortem_condemned_cuts`, `view_post_mortem_partial_summary` (view), `condemnation_records`, `evidence_records`
5. **Billing, Permits & Dispatch:** `fees`, `payments`, `permits`, `permit_config`, `permit_config_history`, `dispatch`
6. **User Roles & Audit Compliance:** `users` (linked to Supabase Auth), `audit_logs`
