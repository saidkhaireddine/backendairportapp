require("dotenv").config();
const mongoose = require("mongoose");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Payout = require("../src/models/Payout");
const Wallet = require("../src/models/Wallet");
const Transaction = require("../src/models/Transaction");

async function clearOpenPayouts() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set in environment");
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set in environment");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const openPayouts = await Payout.find({ status: { $in: ["pending", "processing"] } });
  console.log(`Found ${openPayouts.length} open payouts to clear`);

  let completedCount = 0;
  let refundedCount = 0;
  let erroredCount = 0;

  for (const payout of openPayouts) {
    console.log("==============================");
    console.log(`Payout ${payout._id} status=${payout.status} amount=${payout.amount}`);

    const tx = await Transaction.findOne({ reference_id: payout._id, type: "withdrawal" });

    try {
      const now = new Date();
      const baseMeta = { ...(payout.metadata || {}), manual_clear: true, cleared_at: now };

      if (payout.stripe_transfer_id) {
        let transfer;
        try {
          transfer = await stripe.transfers.retrieve(payout.stripe_transfer_id);
        } catch (err) {
          if (err?.statusCode === 404) {
            console.log(`Transfer ${payout.stripe_transfer_id} not found; refunding payout ${payout._id}`);
            await Wallet.atomicRefund(payout.wallet_id, payout.amount);
            payout.status = "failed";
            payout.failure_reason = "Manual clear: transfer missing";
            payout.failure_code = "manual_clear";
            payout.metadata = { ...baseMeta, refund_reason: "transfer_not_found" };
            await payout.save();

            if (tx) {
              tx.status = "failed";
              tx.metadata = { ...(tx.metadata || {}), manual_clear: true, refund_reason: "transfer_not_found" };
              tx.processed_at = now;
              await tx.save();
            }
            refundedCount++;
            continue;
          }
          throw err;
        }

        if (transfer.reversed || transfer.status === "canceled") {
          console.log(`Transfer ${transfer.id} reversed/canceled; refunding payout ${payout._id}`);
          await Wallet.atomicRefund(payout.wallet_id, payout.amount);
          payout.status = "failed";
          payout.failure_reason = "Manual clear: transfer reversed";
          payout.failure_code = "manual_clear";
          payout.metadata = { ...baseMeta, refund_reason: "transfer_reversed" };
          await payout.save();

          if (tx) {
            tx.status = "failed";
            tx.metadata = { ...(tx.metadata || {}), manual_clear: true, refund_reason: "transfer_reversed" };
            tx.processed_at = now;
            await tx.save();
          }
          refundedCount++;
        } else {
          console.log(`Transfer ${transfer.id} valid; marking payout ${payout._id} completed`);
          payout.status = "completed";
          payout.completed_at = now;
          payout.metadata = { ...baseMeta, transfer_status: transfer.status };
          await payout.save();

          if (tx) {
            tx.status = "completed";
            tx.processed_at = now;
            tx.metadata = { ...(tx.metadata || {}), manual_clear: true, transfer_status: transfer.status };
            await tx.save();
          }
          completedCount++;
        }
      } else {
        console.log(`No transfer id for payout ${payout._id}; refunding`);
        await Wallet.atomicRefund(payout.wallet_id, payout.amount);
        payout.status = "failed";
        payout.failure_reason = "Manual clear: no transfer created";
        payout.failure_code = "manual_clear";
        payout.metadata = { ...baseMeta, refund_reason: "no_transfer" };
        await payout.save();

        if (tx) {
          tx.status = "failed";
          tx.metadata = { ...(tx.metadata || {}), manual_clear: true, refund_reason: "no_transfer" };
          tx.processed_at = now;
          await tx.save();
        }
        refundedCount++;
      }
    } catch (err) {
      erroredCount++;
      console.error(`Error clearing payout ${payout._id}:`, err.message);
    }
  }

  console.log("==============================");
  console.log(`Completed: ${completedCount}`);
  console.log(`Refunded: ${refundedCount}`);
  console.log(`Errored: ${erroredCount}`);

  await mongoose.disconnect();
  console.log("MongoDB disconnected");
}

clearOpenPayouts()
  .then(() => {
    console.log("Done");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
