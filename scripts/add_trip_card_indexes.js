try {
  require("dotenv").config();
} catch (_) {
  // dotenv is optional; Railway/env can inject vars directly
}

let mongoose;
try {
  mongoose = require("mongoose");
} catch (error) {
  console.error("Missing dependency: mongoose");
  console.error("Run: npm install");
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_URI_CLOUD;

if (!MONGODB_URI) {
  console.error("Missing MongoDB URI. Set MONGODB_URI or MONGODB_URI_CLOUD.");
  process.exit(1);
}

const INDEX_PLAN = {
  rides: [
    {
      key: { driver_id: 1, status: 1, datetime_start: -1 },
      options: { name: "driver_status_datetime_desc" },
    },
    {
      key: { driver_id: 1, status: 1, updatedAt: -1 },
      options: { name: "driver_status_updated_desc" },
    },
  ],
  riderequests: [
    {
      key: { passenger: 1, created_at: -1 },
      options: { name: "passenger_created_desc" },
    },
    {
      key: { passenger: 1, status: 1, preferred_datetime: 1 },
      options: { name: "passenger_status_preferred_datetime" },
    },
    {
      key: { passenger: 1, status: 1, created_at: -1 },
      options: { name: "passenger_status_created_desc" },
    },
    {
      key: { "offers.driver": 1, status: 1, preferred_datetime: 1 },
      options: { name: "offers_driver_status_preferred_datetime" },
    },
    {
      key: { "offers.driver": 1, created_at: -1 },
      options: { name: "offers_driver_created_desc" },
    },
    {
      key: { matched_driver: 1, status: 1, preferred_datetime: 1 },
      options: { name: "matched_driver_status_preferred_datetime" },
    },
  ],
  bookings: [
    {
      key: { passenger_id: 1, createdAt: -1 },
      options: { name: "passenger_created_desc" },
    },
    {
      key: { passenger_id: 1, status: 1, createdAt: -1 },
      options: { name: "passenger_status_created_desc" },
    },
    {
      key: { ride_id: 1, status: 1, createdAt: -1 },
      options: { name: "ride_status_created_desc" },
    },
  ],
};

async function ensureCollectionIndexes(db, collectionName, indexes) {
  console.log(`\n[INDEX] ${collectionName}`);
  const collection = db.collection(collectionName);

  for (const { key, options } of indexes) {
    try {
      const name = await collection.createIndex(key, options || {});
      console.log(`  OK ${name}`);
    } catch (error) {
      console.error(`  FAIL ${JSON.stringify(key)} -> ${error.message}`);
    }
  }
}

async function main() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI, { retryWrites: false });
    const db = mongoose.connection.db;

    await ensureCollectionIndexes(db, "rides", INDEX_PLAN.rides);
    await ensureCollectionIndexes(db, "riderequests", INDEX_PLAN.riderequests);
    await ensureCollectionIndexes(db, "bookings", INDEX_PLAN.bookings);

    console.log("\nDone: Trip card indexes ensured.");
    process.exit(0);
  } catch (error) {
    console.error("\nFatal: failed to create indexes", error.message || error);
    process.exit(1);
  } finally {
    try {
      await mongoose.connection.close();
    } catch (_) {
      // no-op
    }
  }
}

main();
