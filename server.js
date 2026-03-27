// 1. Load Environment Variables
require("dotenv").config();

// 2. Import the Application and DB Connection
const { connectDB } = require("./src/config/database");
const app = require("./src/app");
const RatingSchedulerService = require("./src/services/ratingSchedulerService");
const { startReconciliationScheduler } = require("./src/services/payoutReconciliationService");
const mongoose = require("mongoose");

// 3. Define the Port
const PORT = process.env.PORT || 3000;

// 4. Connect to Database and Start the Server
async function startServer() {
  try {
    // Connect to MongoDB
    await connectDB();

    // Ensure all model indexes are built (compound indexes for search perf)
    await mongoose.connection.syncIndexes();
    console.log("✅ Databasee indexes synced");

    // Start the rating notification scheduler
    RatingSchedulerService.start();

    // Start the payout reconciliation scheduler (safety net for stuck payouts)
    startReconciliationScheduler();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`
    🚀 Server is running!
    📡 Port: ${PORT}
    🌐 Environment: ${process.env.NODE_ENV || "development"}
      `);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
