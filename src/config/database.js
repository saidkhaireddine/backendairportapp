const mongoose = require("mongoose");

function getSafeMongoTarget(uri) {
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname || ""}`;
  } catch (_) {
    return "<unparseable-uri>";
  }
}

// Connect to MongoDB
const connectDB = async () => {
  // Priority: MONGODB_URI (local) > MONGODB_URI_CLOUD (Atlas)
  const uriFrom = process.env.MONGODB_URI ? "MONGODB_URI" : "MONGODB_URI_CLOUD";
  const dbURI = process.env.MONGODB_URI || process.env.MONGODB_URI_CLOUD;
  const isLocal = dbURI && dbURI.includes("localhost");

  if (!dbURI) {
    console.error("❌ No MongoDB URI found in .env file.");
    process.exit(1);
  }

  try {
    if (isLocal) {
      console.log("🏠 Connecting to Local MongoDB...");
    } else {
      console.log("🌐 Connecting to MongoDB Atlas...");
    }
    console.log(`🔎 Mongo URI source: ${uriFrom}`);
    console.log(`🔎 Mongo target: ${getSafeMongoTarget(dbURI)}`);
    await mongoose.connect(dbURI, {
      retryWrites: false, // Fix for "Transaction numbers are only allowed on a replica set member or mongos"
      serverSelectionTimeoutMS: 15000,
    });
    console.log("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    if (err?.name) console.error("❌ MongoDB error name:", err.name);
    if (isLocal) {
      console.error("💡 TIP: Make sure MongoDB service is running. Run: net start MongoDB");
    } else {
      console.error("💡 TIP: Confirm Atlas Network Access includes 0.0.0.0/0 (or your runtime egress IP) and DB user credentials are valid.");
    }
    process.exit(1);
  }

  // Handle connection events (attached after successful connection)
  mongoose.connection.on("disconnected", () => {
    console.log("⚠️  MongoDB disconnected");
  });

  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB error:", err);
  });
};

module.exports = { connectDB, mongoose };
