# Non-Conformity Report (부적합 관리 시스템)

## Project Overview
A full-stack web application for Korean enterprise field workers to submit and manage Non-Conformity Reports (부적합 보고). Built for mobile field use with an admin dashboard for supervisors and RPA integration bridge endpoints.

## Architecture

### Monorepo Structure (pnpm workspaces)
- `artifacts/ncr-app` — React+Vite frontend (preview path: `/`)
- `artifacts/api-server` — Express.js REST API (preview path: `/api`)
- `lib/db` — Drizzle ORM schema + PostgreSQL connection
- `lib/api-spec` — OpenAPI 3.0 spec (source of truth) + Orval codegen config
- `lib/api-client-react` — Auto-generated TanStack Query hooks (from Orval)
- `lib/api-zod` — Auto-generated Zod validation schemas (from Orval)
- `lib/object-storage-web` — Object storage Uppy client for frontend uploads

### Technology Stack
- **Frontend**: React 19, Vite, TailwindCSS v4, shadcn/ui components, TanStack Query v5, wouter routing
- **Backend**: Express.js, Pino logging, esbuild bundler
- **Database**: PostgreSQL via Drizzle ORM
- **Storage**: Replit Object Storage (GCS-compatible) for evidence photos
- **API Codegen**: Orval (OpenAPI → TanStack Query hooks + Zod schemas)

## Key Features

### Submit Report Page (`/submit`)
- Mobile-first form with large touch targets (min 48px) for gloved hands
- Fields: 품목코드 (item code), 공정명 (process name), 불량유형 (defect type), 상세 내용 (description)
- Camera/gallery photo capture with client-side compression (< 500KB)
- Two-step presigned URL upload to object storage
- Korean UI throughout

### Admin Dashboard (`/admin` or `/`)
- Stats cards: Total Reports, Pending Sync, Failed Sync, Completed
- Filterable data grid by defect type and sync status with pagination
- Responsive: table on desktop, cards on mobile
- Detail drawer/sheet on row click showing full report including evidence photo

### RPA Bridge Endpoints
- `GET /api/reports/pending` — fetch all PENDING reports for RPA processing
- `PATCH /api/reports/:id/sync-status` — update sync status (PENDING → PROCESSING → COMPLETED/FAILED)

## Database Schema

### `item_codes` table
- `id` (serial PK), `code` (varchar, unique), `name` (varchar), `category` (varchar), `createdAt`

### `non_conformity_reports` table
- `id` (serial PK)
- `reportDate` (timestamp)
- `itemCode` (varchar, FK → item_codes.code)
- `processName` (varchar)
- `defectType` (varchar) — 치수불량/외관불량/기능불량/재료불량/포장불량/기타
- `syncStatus` (enum: PENDING/PROCESSING/COMPLETED/FAILED, default PENDING)
- `description` (text)
- `imageUrl` (varchar, nullable) — path to uploaded evidence photo
- `createdAt`, `updatedAt`

## API Endpoints
- `GET /api/items` — list item codes
- `GET /api/reports` — list reports (filters: defectType, syncStatus, dateFrom, dateTo, page, pageSize)
- `POST /api/reports` — create report
- `GET /api/reports/stats` — aggregated stats
- `GET /api/reports/pending` — RPA: get pending reports
- `GET /api/reports/:id` — get single report
- `PATCH /api/reports/:id/sync-status` — RPA: update sync status
- `POST /api/storage/upload` — request presigned upload URL
- `GET /api/storage/*` — serve stored files

## Development

### Codegen (run after editing openapi.yaml)
```bash
pnpm --filter @workspace/api-spec run codegen
```

### Database schema changes
```bash
pnpm --filter @workspace/db run db:push
```

### Seed data
Item codes are sourced from ERP CSV data (~1,000 real product codes). ITM-001…ITM-010 dummy codes were removed from the DB and never appear in masterSeedData.ts.

## Environment Variables / Secrets
- `DATABASE_URL` — PostgreSQL connection string
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID` — Replit object storage bucket ID
- `PRIVATE_OBJECT_DIR` — private objects path prefix
- `PUBLIC_OBJECT_SEARCH_PATHS` — public object search paths
