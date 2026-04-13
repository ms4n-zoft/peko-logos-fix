import dotenv from "dotenv";
import mongoose from "mongoose";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "csv-parse/sync";

dotenv.config();

const PARTNER_DB_URI =
  process.env.PARTNER_DB_URI ||
  "mongodb://localhost:27017/PekoPartnerDB?directConnection=true";

const DRY_RUN = process.argv.includes("--dry-run");
const CSV_PATH = resolve(import.meta.dirname, "products-logos.csv");

interface CsvRow {
  _id: string;
  product_name: string;
  s3_logo_url: string;
  local_filename: string;
  gcp_public_url: string;
}

async function updateProducts() {
  const csvContent = readFileSync(CSV_PATH, "utf-8");
  const rows: CsvRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });

  // Only update rows that have a GCP URL
  const toUpdate = rows.filter((r) => r.gcp_public_url);

  if (toUpdate.length === 0) {
    console.log(
      "[Update] No rows with GCP URLs found. Run upload script first.",
    );
    process.exit(0);
  }

  console.log(
    `[Update] ${toUpdate.length} products to update (dry-run: ${DRY_RUN})`,
  );

  const connection = await mongoose
    .createConnection(PARTNER_DB_URI)
    .asPromise();
  console.log("[Update] Connected to MongoDB");

  const collection = connection.collection("products");

  let updated = 0;
  let failed = 0;

  for (const row of toUpdate) {
    const filter = { _id: new mongoose.Types.ObjectId(row._id) };
    const update = { $set: { logo_url: row.gcp_public_url } };

    if (DRY_RUN) {
      console.log(
        `[Update] DRY-RUN: ${row.product_name} -> ${row.gcp_public_url}`,
      );
      updated++;
      continue;
    }

    try {
      const result = await collection.updateOne(filter, update);
      if (result.modifiedCount === 1) {
        updated++;
        console.log(`[Update] Updated: ${row.product_name}`);
      } else {
        failed++;
        console.warn(
          `[Update] Not modified: ${row.product_name} (_id: ${row._id})`,
        );
      }
    } catch (err: any) {
      failed++;
      console.error(
        `[Update] Error updating ${row.product_name}: ${err.message}`,
      );
    }
  }

  console.log(`[Update] Done. Updated: ${updated}, Failed: ${failed}`);
  await connection.close();
}

updateProducts().catch((err) => {
  console.error("[Update] Error:", err);
  process.exit(1);
});
