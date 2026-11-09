# LSMIS Relationship and Cardinality Specification
## Crow's Foot Notation Reference for Capstone Defense

> **Database:** PostgreSQL 17.6 on Supabase (`zwuoebmkapoywkpyaahw`)  
> **Notation Standard:** Standard Crow's Foot Notation

---

## 1. Crow's Foot Notation Key

| Crow's Foot Symbol | Syntax | Relationship Multiplicity | Database Representation |
|:------------------:|:------:|:--------------------------|:------------------------|
| $||--||$ | `||--||` | Exactly 1 to Exactly 1 | Mandatory One-to-One (Parent & Child both required) |
| $||--o|$ | `||--o|` | Exactly 1 to 0 or 1 | Optional One-to-One (Child row may or may not exist) |
| $||--|{$ | `||--|{` | Exactly 1 to 1 or More | Mandatory One-to-Many (Parent must have at least 1 child) |
| $||--o{$ | `||--o{` | Exactly 1 to 0 or More | Optional One-to-Many (Parent can have 0, 1, or many children) |
| $}o--o{$ | `}o--o{` | 0 or More to 0 or More | Many-to-Many (modeled via junction table or arrays) |

---

## 2. Comprehensive Cardinality Analysis by Module

### A. Ownership and Intake Pipeline
1. **`owners` to `livestock` ($1:N$, Optional):**
   - **Cardinality:** `owners ||--o{ livestock`
   - **Parent:** `owners(id)` $\rightarrow$ **Child:** `livestock(owner_id)`
   - **Rationale:** A registered farmer/owner can bring multiple animals over time ($0..N$). An animal intake record must point to one registered owner ($1$). On delete, `SET NULL` ensures records remain for public health auditing.

2. **`owners` to `users` ($1:1$, Optional):**
   - **Cardinality:** `owners ||--o| users`
   - **Parent:** `owners(id)` $\rightarrow$ **Child:** `users(owner_id)`
   - **Rationale:** An owner profile may optionally be linked to a single portal user account. Staff accounts have `owner_id = NULL`.

3. **`owners` to `notifications` ($1:N$, Optional):**
   - **Cardinality:** `owners ||--o{ notifications`
   - **Parent:** `owners(id)` $\rightarrow$ **Child:** `notifications(owner_id)`
   - **Rationale:** An owner receives multiple alerts and SMS/app notifications regarding animal clearance, payments, and permit status.

---

### B. Veterinary Inspection & Slaughter Pipeline
4. **`livestock` to `ante_mortem_inspections` ($1:1$ or $1:N$, Optional):**
   - **Cardinality:** `livestock ||--o| ante_mortem_inspections`
   - **Parent:** `livestock(id)` $\rightarrow$ **Child:** `ante_mortem_inspections(livestock_id)`
   - **Rationale:** Each intake animal undergoes ante-mortem inspection. A passed animal moves to slaughter; suspect animals undergo re-inspection.

5. **`livestock` to `slaughter_records` ($1:1$, Optional):**
   - **Cardinality:** `livestock ||--o| slaughter_records`
   - **Parent:** `livestock(id)` $\rightarrow$ **Child:** `slaughter_records(livestock_id)`
   - **Rationale:** An animal is slaughtered exactly once. If deleted, operator record is preserved via `SET NULL`.

6. **`livestock` to `post_mortem_inspections` ($1:1$, Optional):**
   - **Cardinality:** `livestock ||--o| post_mortem_inspections`
   - **Parent:** `livestock(id)` $\rightarrow$ **Child:** `post_mortem_inspections(livestock_id)`
   - **Rationale:** Slaughtered carcasses undergo post-mortem veterinary examination. `ON DELETE CASCADE` ensures inspection follows animal life cycle.

7. **`post_mortem_inspections` to `post_mortem_condemned_cuts` ($1:N$, Optional):**
   - **Cardinality:** `post_mortem_inspections ||--o{ post_mortem_condemned_cuts`
   - **Parent:** `post_mortem_inspections(id)` $\rightarrow$ **Child:** `post_mortem_condemned_cuts(inspection_id)`
   - **Rationale:** When an inspection identifies pathology, multiple individual organs (head, liver, lungs) are condemned and logged as distinct child rows.

8. **`carcass_records` to `carcass_branding_records` ($1:N$, Optional):**
   - **Cardinality:** `carcass_records ||--o{ carcass_branding_records`
   - **Parent:** `carcass_records(id)` $\rightarrow$ **Child:** `carcass_branding_records(carcass_id)`
   - **Rationale:** Carcasses receive official veterinary branding marks (`INSPECTED_AND_PASSED` or `CONDEMNED`). Uniqueness is enforced on `(carcass_id, branding_type)`.

---

### C. Financial Billing & Permitting Pipeline
9. **`fees` to `payments` ($1:N$, Optional):**
   - **Cardinality:** `fees ||--o{ payments`
   - **Parent:** `fees(id)` $\rightarrow$ **Child:** `payments(fee_id)`
   - **Rationale:** Official tariff schedules in `fees` apply to multiple billing transactions across livestock intakes.

10. **`livestock` to `payments` ($1:N$, Optional):**
    - **Cardinality:** `livestock ||--o{ payments`
    - **Parent:** `livestock(id)` $\rightarrow$ **Child:** `payments(livestock_id)`
    - **Rationale:** Payments are billed per animal intake or batch.

11. **`owners` to `dispatch` ($1:N$, Optional):**
    - **Cardinality:** `owners ||--o{ dispatch`
    - **Parent:** `owners(id)` $\rightarrow$ **Child:** `dispatch(owner_id)`
    - **Rationale:** Registered owners receive dispatched meat shipments under gate pass authorization.
