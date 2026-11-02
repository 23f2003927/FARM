# Polyhouse Operations Management System (SmartFarm)

An industrial-grade farm operations and agricultural treatment management system designed to eliminate human transcription errors, enforce chemical safety, maintain an immutable append-only inventory ledger, automate procurement calculations, and track crop-health treatment responses.

Built with **Next.js 16 (App Router)**, **TypeScript (Strict Mode)**, **Tailwind CSS v4**, and **Supabase (PostgreSQL, Auth & Storage)**.

---

## 🌾 Core Agricultural Operating Rules (Non-Negotiable)

1. **No Guessed Dosages:** The system strictly acts as a record-keeping and workflow enforcement platform. It **never** invents chemical dosages or recommends pesticide mixes based on AI guesses.
2. **Strict Physical Units:** 1 gram is **never** assumed to equal 1 millilitre. Automatic cross-dimensional conversions between Mass and Volume are blocked at both application and database levels.
3. **Canonical Product Master:** Products are never automatically substituted simply because their active ingredients look similar. Every input must be canonical and verified by an Agronomist before release into supervisor work orders.
4. **Immutable Inventory Ledger:** All inventory movements (`purchase_receipt`, `issue`, `return`, `disposal`, `adjustment`) are **strictly append-only**. There is no silent editing or deletion of historical movements. Corrections must occur through compensating ledger entries.
5. **Negative Stock Prevention:** Stock transactions that would result in negative balances are blocked atomically at the PostgreSQL level using `FOR UPDATE` row locking.
6. **Discrepancy Accountability:** When supervisors record application quantities that differ from approved planned quantities, the system automatically flags a **Discrepancy** requiring Verifier review.

---

## 👥 Five Operational Roles

A user may hold one or multiple roles per farm. Permissions are enforced at the database level using PostgreSQL Row-Level Security (RLS):

| Role | Responsibilities | Key Restrictions |
|---|---|---|
| **Owner / Admin** | Full farm dashboard, polyhouses, crop cycles, inventory, procurement approval, team roles, audit logs | Cannot silently overwrite agronomist-approved chemical dosages |
| **Agronomist** | Reviews handwritten visit notes, verifies product identities, approves treatment lines, requests clarifications, assesses crop health | Cannot manipulate inventory records or issue goods receipts |
| **Procurement** | Runs automated procurement calculator, manages suppliers, creates purchase orders, records goods receipts and batch lot details | Cannot approve technical agricultural treatment instructions |
| **Supervisor** | Executes assigned work orders, selects physical batch (FEFO), conducts safety checklists, records actual applied quantities and returns | Cannot alter approved dosage, substitute products, or edit stock ledger |
| **Verifier** | Inspects completed application records, reviews evidence and deviations, approves or rejects applications with written reasons | Cannot modify approved treatment prescriptions |

---

## 🚀 Setup & Installation Guide

### Step 1: Environment Variables

Create a `.env.local` file in the root directory:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

*(You can copy from `.env.example`)*

---

### Step 2: Database Schema & Migrations

Log in to your **Supabase Project Dashboard** → **SQL Editor** → **New Query**.

You can run the unified schema script:
- Copy and run the entire contents of `supabase/all_migrations.sql`

*(Alternatively, you can run the files in `supabase/migrations/` in numerical order from `00001` through `00009`).*

This sets up:
- Core tables with RLS and foreign keys
- `profiles` auto-creation trigger on user signup
- Append-only `stock_movements` ledger
- `v_stock_balances`, `v_usable_stock`, and `v_expiring_batches` (FEFO) views
- `v_procurement_demand` and `v_confirmed_incoming_stock` views
- Transactional functions: `fn_record_stock_movement`, `fn_release_treatment_line`, `fn_bootstrap_farm`, `fn_seed_demo_data`

---

### Step 3: Create the First Owner Account

1. In your **Supabase Project Dashboard** → **Authentication** → **Users** → Click **Add User** (Create User with Email & Password).
2. Copy the newly generated **User UID** (UUID).
3. In the **SQL Editor**, run the bootstrap function to create your Farm and assign your account the `owner` role:

```sql
SELECT public.fn_bootstrap_farm(
  'YOUR_USER_UID_HERE'::uuid, 
  'Green Valley Polyhouse Farm', 
  'Maharashtra, India'
);
```

4. *(Optional Demo Seed Data)*: To pre-populate 3 polyhouses (A, B, C), sample crop cycles (Capsicum, Cucumber), 4 verified canonical products (Confidor, Ridomil Gold, 19:19:19 NPK, Trichoderma), and product aliases, run:

```sql
-- Get your farm ID first:
SELECT id FROM public.farms LIMIT 1;

-- Pass your farm ID to the seed function:
SELECT public.fn_seed_demo_data('YOUR_FARM_ID_HERE'::uuid);
```

---

### Step 4: Run the Application Locally

```bash
# Install dependencies (already pinned)
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser and sign in with your email and password.

---

## 🧮 Automated Procurement Calculator

The procurement module computes net purchase requirements with mathematical rigor:

$$\text{Net Requirement} = \max\left(0, \text{Planned Demand} + \text{Desired Ending Stock} - \text{Usable Stock} - \text{Confirmed Incoming}\right)$$

$$\text{Packages to Order} = \left\lceil \frac{\text{Net Requirement}}{\text{Package Size}} \right\rceil$$

$$\text{Projected Leftover} = \text{Total Ordered} - \text{Net Requirement}$$

### Verified Specification Test Cases
Run the automated unit tests anytime with:
```bash
npx tsx -e "import { runProcurementTests } from './src/__tests__/procurement.test'; console.log(runProcurementTests())"
```

- **Case 1:** Demand 1 kg, stock 0 kg, pack 5 kg $\rightarrow$ 1 package (5 kg total, 4 kg excess).
- **Case 2:** Demand 1 kg, stock 500 g, pack 500 g $\rightarrow$ 1 package (demand 1000g, net shortfall 500g).
- **Case 3:** Demand 1 kg, usable stock 1 kg $\rightarrow$ 0 packages.
- **Case 4:** Demand 2 kg, usable stock 1 kg, confirmed incoming 1 kg $\rightarrow$ 0 packages.
- **Case 5:** Mass demand (kg) vs Volume stock (ml) $\rightarrow$ **Blocked** with dimension mismatch error. Automatic conversion is strictly prohibited.

---

## 📱 Supervisor Mobile Execution

Supervisors have access to a dedicated mobile portal at `/dashboard/work-orders/supervisor`:
- **Bilingual Prompts:** English and Hindi (`दवा का नाम`, `मात्रा`, `पॉलीहाउस`).
- **FEFO Batch Selection:** System displays available non-expired batches sorted by earliest expiry date first.
- **Pre-Application Safety Checklist:** Verification of PPE, clean sprayer tanks, and nozzle condition.
- **Stock Reconciliation:** Captures stock issued, actual applied quantity, and unused product returned.

---

## 📦 Data Exports (CSV)

Audit-ready CSV exports are available on `/dashboard/reports` and via `/api/export?type=...`:
- `inventory`: Batch balances, expiry dates, locations.
- `movements`: Append-only historical transactions.
- `applications`: Completed work orders and discrepancy records.
- `crop_health`: Field observations, incidence percentages, and treatment responses.

---

## 🛠️ Verification & Production Build

To verify code integrity:
```bash
# TypeScript strict type check
npx tsc --noEmit

# Production build verification
npm run build
```
*(All 25 application routes and layouts compile with zero errors).*
