import dotenv from "dotenv";
import mongoose from "mongoose";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { stringify } from "csv-stringify/sync";

dotenv.config();

const PARTNER_DB_URI =
  process.env.PARTNER_DB_URI ||
  "mongodb://localhost:27017/PekoPartnerDB?directConnection=true";

interface ProductDoc {
  _id: mongoose.Types.ObjectId;
  product_name: string;
  logo_url: string | null;
}

async function exportProducts() {
  const connection = await mongoose
    .createConnection(PARTNER_DB_URI)
    .asPromise();
  console.log("[Export] Connected to MongoDB");

  const collection = connection.collection("products");

  // Find products with S3 logo URLs (or null/empty)
  const products = await collection
    .find(
      { logo_url: { $regex: /s3\.amazonaws\.com/i } },
      { projection: { _id: 1, product_name: 1, logo_url: 1 } },
    )
    .toArray();

  console.log(`[Export] Found ${products.length} products with S3 logo URLs`);

  // Build CSV
  const csvRows = products.map((p) => ({
    _id: String(p._id),
    product_name: String(p.product_name),
    s3_logo_url: p.logo_url ?? "",
    local_filename: "",
    gcp_public_url: "",
  }));

  const csv = stringify(csvRows, { header: true });
  const outPath = resolve(import.meta.dirname, "products-logos.csv");
  writeFileSync(outPath, csv, "utf-8");

  console.log(`[Export] CSV written to ${outPath}`);
  await connection.close();
}

exportProducts().catch((err) => {
  console.error("[Export] Error:", err);
  process.exit(1);
});
