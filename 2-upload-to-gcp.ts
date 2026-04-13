import dotenv from "dotenv";
import { Storage } from "@google-cloud/storage";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve, extname, basename } from "path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

dotenv.config();

const BUCKET_NAME = process.env.GCP_BUCKET_NAME || "";
const LOGOS_DIR = resolve(import.meta.dirname, "logos");
const CSV_PATH = resolve(import.meta.dirname, "products-logos.csv");
const BUCKET_FOLDER = "product-logos"; // folder inside the bucket

if (!BUCKET_NAME) {
  console.error("[Upload] Set GCP_BUCKET_NAME env var");
  process.exit(1);
}

interface CsvRow {
  _id: string;
  product_name: string;
  s3_logo_url: string;
  local_filename: string;
  gcp_public_url: string;
}

async function upload() {
  if (!existsSync(LOGOS_DIR)) {
    console.error(`[Upload] Logos directory not found: ${LOGOS_DIR}`);
    console.error("[Upload] Place your logo files in peko-logos-fix/logos/");
    process.exit(1);
  }

  // Uses Application Default Credentials (ADC)
  const storage = new Storage();
  const bucket = storage.bucket(BUCKET_NAME);

  // Read CSV
  const csvContent = readFileSync(CSV_PATH, "utf-8");
  const rows: CsvRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });

  // Index local logo files by lowercase name (without extension)
  const localFiles = readdirSync(LOGOS_DIR);
  const fileMap = new Map<string, string>();
  for (const file of localFiles) {
    const key = basename(file, extname(file))
      .toLowerCase()
      .replace(/\s+/g, "-");
    fileMap.set(key, file);
  }

  console.log(`[Upload] ${localFiles.length} logo files found in ${LOGOS_DIR}`);
  console.log(`[Upload] ${rows.length} products in CSV`);

  let matched = 0;
  let uploaded = 0;

  for (const row of rows) {
    // Check if local_filename was manually set in the CSV first
    let localFile = row.local_filename
      ? fileMap.get(
          basename(row.local_filename, extname(row.local_filename))
            .toLowerCase()
            .replace(/\s+/g, "-"),
        ) || row.local_filename
      : null;

    if (!localFile) {
      // Fall back to matching by product name -> filename
      const productKey = row.product_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      localFile = fileMap.get(productKey) || null;
    }

    if (!localFile) continue;

    matched++;
    row.local_filename = localFile;

    const localPath = resolve(LOGOS_DIR, localFile);
    const destination = `${BUCKET_FOLDER}/${localFile}`;

    try {
      await bucket.upload(localPath, {
        destination,
        metadata: {
          cacheControl: "public, max-age=31536000",
        },
      });

      const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${destination}`;
      row.gcp_public_url = publicUrl;
      uploaded++;
      console.log(`[Upload] ${localFile} -> ${publicUrl}`);
    } catch (err: any) {
      console.error(`[Upload] Failed to upload ${localFile}: ${err.message}`);
    }
  }

  // Write updated CSV
  const updatedCsv = stringify(rows, { header: true });
  writeFileSync(CSV_PATH, updatedCsv, "utf-8");

  console.log(`[Upload] Matched: ${matched}, Uploaded: ${uploaded}`);
  console.log(`[Upload] Updated CSV written to ${CSV_PATH}`);
}

upload().catch((err) => {
  console.error("[Upload] Error:", err);
  process.exit(1);
});
