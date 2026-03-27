try {
  require("dotenv").config();
} catch (_) {
  // dotenv is optional when env vars are injected by platform
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

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
      continue;
    }

    out[key] = next;
    i += 1;
  }

  return out;
}

function toObjectId(id, label) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`Invalid or missing ${label}: ${id || "<empty>"}`);
  }
  return new mongoose.Types.ObjectId(id);
}

function flattenPlanStages(plan, stages = []) {
  if (!plan || typeof plan !== "object") return stages;
  if (plan.stage) stages.push(plan.stage);

  if (plan.inputStage) flattenPlanStages(plan.inputStage, stages);
  if (plan.outerStage) flattenPlanStages(plan.outerStage, stages);
  if (plan.innerStage) flattenPlanStages(plan.innerStage, stages);
  if (Array.isArray(plan.inputStages)) {
    for (const p of plan.inputStages) flattenPlanStages(p, stages);
  }
  if (Array.isArray(plan.shards)) {
    for (const shard of plan.shards) {
      flattenPlanStages(shard?.winningPlan || shard, stages);
    }
  }

  return stages;
}

function summarizeExplain(explain) {
  const winningPlan = explain?.queryPlanner?.winningPlan || null;
  const executionStats = explain?.executionStats || {};

  return {
    executionTimeMillis: executionStats.executionTimeMillis ?? null,
    totalDocsExamined: executionStats.totalDocsExamined ?? null,
    totalKeysExamined: executionStats.totalKeysExamined ?? null,
    winningPlan,
    winningPlanStages: flattenPlanStages(winningPlan, []),
  };
}

async function runExplainQueries(ids) {
  const db = mongoose.connection.db;
  const rideRequests = db.collection("riderequests");
  const bookings = db.collection("bookings");

  const [
    bookingsExplain,
    myRequestsExplain,
    myOffersExplain,
    requestDetailsExplain,
  ] = await Promise.all([
    bookings
      .find({ passenger_id: toObjectId(ids.driverId, "driverId (booking passenger_id)") })
      .sort({ createdAt: -1 })
      .limit(20)
      .explain("executionStats"),
    rideRequests
      .find({ passenger: toObjectId(ids.passengerId, "passengerId") })
      .sort({ created_at: -1 })
      .limit(20)
      .explain("executionStats"),
    rideRequests
      .find({ "offers.driver": toObjectId(ids.driverId, "driverId (offers.driver)") })
      .sort({ created_at: -1 })
      .limit(20)
      .explain("executionStats"),
    rideRequests
      .find({ _id: toObjectId(ids.requestId, "requestId") })
      .limit(1)
      .explain("executionStats"),
  ]);

  return {
    bookingsByPassenger: summarizeExplain(bookingsExplain),
    myRequestsByPassenger: summarizeExplain(myRequestsExplain),
    myOffersByDriver: summarizeExplain(myOffersExplain),
    requestDetailsById: summarizeExplain(requestDetailsExplain),
  };
}

async function runIndexChecks() {
  const db = mongoose.connection.db;
  const [bookingIndexes, requestIndexes, rideIndexes] = await Promise.all([
    db.collection("bookings").indexes(),
    db.collection("riderequests").indexes(),
    db.collection("rides").indexes(),
  ]);

  return {
    bookings: bookingIndexes,
    riderequests: requestIndexes,
    rides: rideIndexes,
  };
}

async function runCollectionCounts() {
  const db = mongoose.connection.db;
  const [bookingsCount, requestsCount, ridesCount] = await Promise.all([
    db.collection("bookings").countDocuments(),
    db.collection("riderequests").countDocuments(),
    db.collection("rides").countDocuments(),
  ]);

  return {
    bookings: bookingsCount,
    riderequests: requestsCount,
    rides: ridesCount,
  };
}

async function main() {
  const args = parseArgs();

  const passengerId = args.passengerId || process.env.PERF_PASSENGER_ID;
  const driverId = args.driverId || process.env.PERF_DRIVER_ID;
  const requestId = args.requestId || process.env.PERF_REQUEST_ID;

  if (!passengerId || !driverId || !requestId) {
    console.error("Usage:");
    console.error(
      "  node scripts/db_perf_snapshot.js --passengerId <ObjectId> --driverId <ObjectId> --requestId <ObjectId>"
    );
    console.error("Or set env vars: PERF_PASSENGER_ID, PERF_DRIVER_ID, PERF_REQUEST_ID");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, { retryWrites: false });

    const [explains, indexes, counts] = await Promise.all([
      runExplainQueries({ passengerId, driverId, requestId }),
      runIndexChecks(),
      runCollectionCounts(),
    ]);

    const report = {
      generatedAt: new Date().toISOString(),
      ids: { passengerId, driverId, requestId },
      explains,
      counts,
      indexes,
    };

    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("Failed to generate DB performance snapshot:");
    console.error(error?.stack || error?.message || error);
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
