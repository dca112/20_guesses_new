import { getDb } from "../lib/db";

getDb()
  .then(() => {
    console.log(`Schema applied to ${process.env.TURSO_DATABASE_URL || "file:local.db"}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
