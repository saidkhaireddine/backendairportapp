#!/usr/bin/env node

/**
 * Migration: Fix past wallet refunds for cancelled ride bookings
 * 
 * This script finds bookings that were cancelled (driver or other reason) 
 * where the passenger paid via wallet but never received a refund,
 * and processes the refund now.
 * 
 * Usage: 
 *   cd myapp-backend
 *   node scripts/fix_past_wallet_refunds.js
 * 
 * Add --dry-run to preview without making changes:
 *   node scripts/fix_past_wallet_refunds.js --dry-run
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Booking = require("../src/models/Booking");
const Ride = require("../src/models/Ride");
const Wallet = require("../src/models/Wallet");
const Transaction = require("../src/models/Transaction");

const DRY_RUN = process.argv.includes("--dry-run");

async function connectDB() {
  const dbURI = process.env.MONGODB_URI || process.env.MONGODB_URI_CLOUD;
  if (!dbURI) {
    console.error("No MongoDB URI found in .env");
    process.exit(1);
  }
  await mongoose.connect(dbURI);
  console.log("Connected to MongoDB");
}

async function main() {
  await connectDB();

  if (DRY_RUN) {
    console.log("\n=== DRY RUN MODE - No changes will be made ===\n");
  }

  // Find all cancelled bookings that were paid via wallet but NOT refunded
  const unrefundedBookings = await Booking.find({
    status: "cancelled",
    payment_status: "paid",  // Still shows "paid" = was never refunded
    $or: [
      { payment_method: "wallet" },
      // Legacy bookings might not have payment_method set but also have no payment_intent_id
      { payment_method: { $exists: false }, payment_intent_id: { $exists: false } },
      { payment_method: null, payment_intent_id: null },
    ],
  }).populate("ride_id").populate("passenger_id", "first_name last_name email");

  console.log(`Found ${unrefundedBookings.length} cancelled wallet bookings that need refunds\n`);

  if (unrefundedBookings.length === 0) {
    console.log("Nothing to process. All wallet refunds are up to date.");
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let failed = 0;
  let totalRefunded = 0;

  for (const booking of unrefundedBookings) {
    const bookingId = booking._id.toString();
    const ride = booking.ride_id;

    if (!ride) {
      console.log(`[SKIP] Booking ${bookingId} - ride not found`);
      failed++;
      continue;
    }

    // Extract IDs safely
    const passengerId = booking.passenger_id?._id 
      ? booking.passenger_id._id.toString() 
      : booking.passenger_id?.toString();
    const driverId = ride.driver_id?._id 
      ? ride.driver_id._id.toString() 
      : ride.driver_id?.toString();

    if (!passengerId || !driverId) {
      console.log(`[SKIP] Booking ${bookingId} - missing passenger or driver ID`);
      failed++;
      continue;
    }

    const totalAmount = Math.round(ride.price_per_seat * booking.seats * 100);
    const feePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENT || "10");
    const driverEarnings = Math.round(totalAmount * ((100 - feePercentage) / 100));

    const passengerName = booking.passenger_id?.first_name 
      ? `${booking.passenger_id.first_name} ${booking.passenger_id.last_name}`
      : passengerId;

    console.log(`[${processed + failed + 1}/${unrefundedBookings.length}] Booking ${bookingId}`);
    console.log(`    Passenger: ${passengerName}`);
    console.log(`    Seats: ${booking.seats}, Amount: EUR ${(totalAmount / 100).toFixed(2)}`);
    console.log(`    Driver debit: EUR ${(driverEarnings / 100).toFixed(2)}`);

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would refund EUR ${(totalAmount / 100).toFixed(2)} to passenger wallet`);
      totalRefunded += totalAmount;
      processed++;
      continue;
    }

    try {
      // 1. Credit passenger wallet with FULL amount (100%)
      const passengerWallet = await Wallet.getOrCreateWallet(passengerId);
      const oldBalance = passengerWallet.balance;
      passengerWallet.balance += totalAmount;
      await passengerWallet.save();

      // 2. Create refund transaction for passenger
      await Transaction.create({
        wallet_id: passengerWallet._id,
        user_id: passengerId,
        type: "refund",
        amount: totalAmount,
        gross_amount: totalAmount,
        fee_amount: 0,
        fee_percentage: 0,
        net_amount: totalAmount,
        currency: "EUR",
        status: "completed",
        reference_type: "booking",
        reference_id: booking._id,
        description: "Retroactive wallet refund - cancelled ride",
        processed_at: new Date(),
      });

      console.log(`    Passenger wallet: ${oldBalance} -> ${passengerWallet.balance} cents`);

      // 3. Deduct from driver wallet
      const driverWallet = await Wallet.getOrCreateWallet(driverId);
      if (driverWallet.balance >= driverEarnings) {
        driverWallet.balance -= driverEarnings;
        driverWallet.total_earned -= driverEarnings;
        await driverWallet.save();

        await Transaction.create({
          wallet_id: driverWallet._id,
          user_id: driverId,
          type: "refund",
          amount: -driverEarnings,
          gross_amount: totalAmount,
          fee_amount: 0,
          fee_percentage: 0,
          net_amount: driverEarnings,
          currency: "EUR",
          status: "completed",
          reference_type: "booking",
          reference_id: booking._id,
          description: "Retroactive driver earnings reversed - cancelled ride",
          processed_at: new Date(),
        });
        console.log(`    Driver wallet debited: ${driverEarnings} cents`);
      } else {
        console.log(`    WARNING: Driver wallet insufficient (${driverWallet.balance}), skipping driver debit`);
      }

      // 4. Update booking status
      await Booking.findByIdAndUpdate(booking._id, {
        payment_status: "refunded",
        payment_method: booking.payment_method || "wallet",
        refunded_at: new Date(),
        refund_reason: "ride_cancelled",
      });

      totalRefunded += totalAmount;
      processed++;
      console.log(`    OK`);
    } catch (err) {
      console.error(`    ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`SUMMARY${DRY_RUN ? " (DRY RUN)" : ""}:`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total refunded: EUR ${(totalRefunded / 100).toFixed(2)}`);
  console.log(`${"=".repeat(60)}\n`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
