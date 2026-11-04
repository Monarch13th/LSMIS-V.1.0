# LSMIS - Livestock Slaughter & Meat Inspection System

A modern, responsive web application for managing slaughterhouse workflows, tracking livestock, logging inspection results, and processing payments. Built with **React**, **Vite**, and **Supabase**.

---

## 🚀 Key Features

* **Dashboard**: Role-specific statistics and widgets for Admin, Vet, and Staff.
* **Livestock Registration**: Quick entry of livestock with automatic tag number generation and owner association.
* **Inspection Management**: Ante-mortem and post-mortem inspections with decision controls (Approved, Rejected, Condemned).
* **Payment Processing**: Dynamic billing calculation based on animal weight or per-head rates, receipts, and cash ledger tracking.
* **Permitting & Dispatch**: Release/dispatch approvals for meat safety compliance.
* **Smart Notifications**: Live-synced workflow alerts and upcoming schedules.
* **User Profile**: Edit personal details, update password, and select custom banner covers.

---

## 🛠️ Tech Stack

* **Frontend**: React (Functional Components, Hooks, Context, Zustand)
* **Build System**: Vite (Fast HMR)
* **Backend Database & Auth**: Supabase (Real-time subscriptions)
* **Design System**: Vanilla CSS with HSL color tokens for modern dark/light styling.

---

## ⚙️ Project Setup

### 1. Installation
Clone the repository and install the dependencies:
```bash
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 3. Development Server
Start the local server:
```bash
npm run dev
```

### 4. Build Production Bundle
Build and inline assets into a single optimized HTML file:
```bash
npm run build
```

---

## 🔐 Default Credentials

* **System Admin**: `admin1@gmail.com` / `admin123`
* **Vet Inspector**: `vet@gmail.com` / `vet123`
* **Slaughterhouse Staff**: `staff@gmail.com` / `staff123`
