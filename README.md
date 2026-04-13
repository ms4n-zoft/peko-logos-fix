# Peko Logo URL Fix — S3 to GCP Migration

## Problem

Some products in the Peko MongoDB database have corrupted `logo_url` values pointing to S3 (`s3.amazonaws.com`). We have correct logo files locally (from a shared drive) and need to re-host them on a GCP Cloud Storage bucket, then update the database.

> **WARNING: Steps 1 and 5 interact with the PRODUCTION database. Always use `--dry-run` first for DB writes. Double-check CSV contents before every real execution. The only rollback is the original S3 URLs preserved in the CSV.**

## Overview

| Step | Script                 | Description                                                   |
| ---- | ---------------------- | ------------------------------------------------------------- |
| 1    | `1-export-products.ts` | Export affected products to CSV (read-only)                   |
| 2    | —                      | Place logo files in `logos/` folder                           |
| 3    | `2-upload-to-gcp.ts`   | Upload logos to GCP bucket, update CSV with public URLs       |
| 4    | `3-update-products.ts` | Update MongoDB `logo_url` from CSV (**supports `--dry-run`**) |

---

## Prerequisites

### 1. Install gcloud CLI

Download and run the installer from: https://cloud.google.com/sdk/docs/install#windows

Or via PowerShell:

```powershell
# Using winget
winget install Google.CloudSDK

# Verify
gcloud version
```

After install, restart your terminal so `gcloud` is on your PATH.

### 2. Authenticate with Application Default Credentials (ADC)

ADC lets local scripts authenticate as your Google account without embedding keys.

```bash
# Login to your Google account
gcloud auth login

# Set ADC (this is what the Node.js @google-cloud/storage SDK uses)
gcloud auth application-default login

# Set your project
gcloud config set project YOUR_GCP_PROJECT_ID
```

After running `gcloud auth application-default login`, a credentials file is saved at:

- Windows: `%APPDATA%\gcloud\application_default_credentials.json`

The `@google-cloud/storage` SDK picks this up automatically — no service account key file needed.

### 3. Install Node.js dependencies

```bash
# From the project root
npm install @google-cloud/storage csv-parse csv-stringify
```

---

## Step-by-Step Execution

### Step 1 — Export products with S3 logo URLs

This queries MongoDB for all products where `logo_url` contains `s3.amazonaws.com` and writes a CSV.

```bash
# Set your MongoDB connection string
export PARTNER_DB_URI="mongodb+srv://user:pass@cluster.mongodb.net/PekoPartnerDB"

# Run the export
npx tsx peko-logos-fix/1-export-products.ts
```

**Output:** `peko-logos-fix/products-logos.csv` with columns:

| \_id   | product_name | s3_logo_url            | local_filename | gcp_public_url |
| ------ | ------------ | ---------------------- | -------------- | -------------- |
| 64a... | Adobe        | https://s3...adobe.png |                |                |

Review the CSV and verify the product list makes sense.

### Step 2 — Place logo files

Copy your logo files from the shared drive into:

```
peko-logos-fix/
  logos/
    adobe.png
    salesforce.svg
    hubspot.png
    ...
```

**Naming convention:** The upload script matches logos to products by normalizing both the product name and filename to lowercase kebab-case. For example:

| Product Name  | Expected Filename          |
| ------------- | -------------------------- |
| Adobe         | `adobe.png` or `adobe.svg` |
| HubSpot CRM   | `hubspot-crm.png`          |
| Microsoft 365 | `microsoft-365.png`        |

If the auto-matching doesn't find a file for a product, you can manually fill in the `local_filename` column in the CSV before running the upload script.

### Step 3 — Upload logos to GCP

```bash
export GCP_BUCKET_NAME="peko-product-logos"
export PARTNER_DB_URI="mongodb+srv://..."  # only needed if not already set

npx tsx peko-logos-fix/2-upload-to-gcp.ts
```

The script:

1. Reads logo files from `peko-logos-fix/logos/`
2. Matches them to CSV rows by product name
3. Uploads each file to `gs://peko-product-logos/product-logos/<filename>`
4. Writes the public URL back into the CSV's `gcp_public_url` column

**Output:** Updated `products-logos.csv` now has `local_filename` and `gcp_public_url` filled in for matched products.

**Verify a URL works:**

```bash
curl -I "https://storage.googleapis.com/peko-product-logos/product-logos/adobe.png"
# Should return 200 OK
```

### Step 4 — Review the CSV

Before updating the database, open `products-logos.csv` and verify:

- Each row that has a `gcp_public_url` is correct
- The right logo is matched to the right product
- Remove or clear `gcp_public_url` for any rows you don't want to update yet

### Step 5 — Update MongoDB

> **CAUTION: This writes to the production database. Always dry-run first.**

```bash
# Dry run first — prints what would change without touching the DB
npx tsx peko-logos-fix/3-update-products.ts --dry-run

# Review the dry-run output carefully. If it looks good, run for real:
npx tsx peko-logos-fix/3-update-products.ts
```

The script updates `logo_url` for each product where the CSV has a `gcp_public_url`.

---

## Handling Unmatched Products

After running the upload script, some CSV rows may still have empty `local_filename` and `gcp_public_url` columns. For these:

1. **Manual match** — If you have the file but it's named differently, fill in `local_filename` in the CSV and re-run the upload script. The script checks this column first.
2. **Missing logos** — If a logo file doesn't exist yet, skip it for now and handle in a follow-up.

---

## Folder Structure

```
peko-logos-fix/
  PLAN.md                    # This document
  1-export-products.ts       # Step 1: Export CSV
  2-upload-to-gcp.ts         # Step 3: Upload + update CSV
  3-update-products.ts       # Step 5: Update MongoDB
  products-logos.csv          # Generated in Step 1, updated in Step 3
  logos/                      # Your logo files go here
    adobe.png
    salesforce.svg
    ...
```

---

## Rollback

If something goes wrong, the original S3 URLs are preserved in the `s3_logo_url` column of the CSV. You can restore them:

```bash
# The update script can be adapted, but the simplest approach:
# Swap gcp_public_url with s3_logo_url in the CSV, then re-run Step 5.
```

---

## Quick Reference

```bash
# Full flow (after setup)
export PARTNER_DB_URI="mongodb+srv://..."
export GCP_BUCKET_NAME="peko-product-logos"

npx tsx peko-logos-fix/1-export-products.ts        # Export CSV
# ... place logo files in peko-logos-fix/logos/ ...
npx tsx peko-logos-fix/2-upload-to-gcp.ts          # Upload to GCP
npx tsx peko-logos-fix/3-update-products.ts --dry-run  # Verify
npx tsx peko-logos-fix/3-update-products.ts            # Apply
```
