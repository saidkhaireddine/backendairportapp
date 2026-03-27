require("dotenv").config();
const mongoose = require("mongoose");
const Message = require("../src/models/Message");

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ Missing MONGO_URI or MONGODB_URI env var");
    process.exit(1);
  }

  try {
    console.log("🚀 Connecting to MongoDB...");
    await mongoose.connect(uri, { autoIndex: false });
    console.log("✅ Connected");

    const indexes = [
      // Desc order (existing queries that sort -1)
      { key: { request_id: 1, createdAt: -1 }, name: "request_createdAt" },
      { key: { booking_id: 1, createdAt: -1 }, name: "booking_createdAt" },

      // Asc order to match ascending sorts (createdAt: 1)
      { key: { request_id: 1, createdAt: 1 }, name: "request_createdAt_asc" },
      { key: { booking_id: 1, createdAt: 1 }, name: "booking_createdAt_asc" },

      // Read state helpers
      { key: { receiver_id: 1, read: 1, createdAt: -1 }, name: "receiver_read_createdAt" },
      { key: { request_id: 1, receiver_id: 1, read: 1, createdAt: -1 }, name: "request_receiver_read_createdAt" },
    ];

    console.log("🛠  Ensuring message indexes (idempotent)...");

    for (const idx of indexes) {
      try {
        const res = await Message.collection.createIndex(idx.key, { name: idx.name, background: true });
        console.log(`✅ Index ensured: ${res}`);
      } catch (err) {
        if (err?.code === 85) {
          console.warn(`ℹ️  Index exists with different name, skipping: ${idx.name}`);
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    console.error("❌ Failed to create indexes", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
})();
