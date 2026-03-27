// Utility script to inspect recent withdrawals and their Stripe state.
// Usage: node scripts/check_withdrawals.js
// Env required: MONGODB_URI (or MONGO_URL), STRIPE_SECRET_KEY
require("dotenv").config();
const mongoose = require("mongoose");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Payout = require("../src/models/Payout");
const Transaction = require("../src/models/Transaction");
const User = require("../src/models/User");

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL;

if (!MONGO_URI) {
  console.error("Missing MONGODB_URI/MONGO_URL env");
  process.exit(1);
}
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY env");
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB\n");

  const payouts = await Payout.find({})
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  if (!payouts.length) {
    console.log("No payouts found");
    return;
  }

  for (const payout of payouts) {
    const tx = await Transaction.findOne({
      reference_id: payout._id,
      reference_type: "payout",
    })
      .sort({ createdAt: -1 })
      .lean();

    const user = await User.findById(payout.user_id).lean();
    const acct = user?.stripeAccountId;

    console.log("==============================");
    console.log(`Payout ${payout._id}`);
    console.log({
      user: payout.user_id?.toString(),
      amount_cents: payout.amount,
      status: payout.status,
      failure_reason: payout.failure_reason || null,
      metadata: payout.metadata || null,
      transaction_id: tx?._id || null,
      tx_status: tx?.status || null,
      tx_stripe_transfer_id: tx?.stripe_transfer_id || null,
      tx_error: tx?.metadata?.error || null,
      tx_error_code: tx?.metadata?.error_code || null,
      stripe_account: acct || null,
    });

    // Verify the Stripe transfer if we have one
    if (tx?.stripe_transfer_id) {
      try {
        const transfer = await stripe.transfers.retrieve(tx.stripe_transfer_id);
        console.log("  Stripe transfer:", {
          id: transfer.id,
          amount: transfer.amount,
          currency: transfer.currency,
          destination: transfer.destination,
          status: transfer.reversed ? "reversed" : "succeeded",
        });
      } catch (err) {
        console.warn(`  Could not retrieve transfer ${tx.stripe_transfer_id}:`, err.message);
      }
    }

    // Verify the bank payout on the connected account if metadata has it
    const bankPayoutId = payout.metadata?.bank_payout_id || tx?.metadata?.bank_payout_id;
    if (bankPayoutId && acct) {
      try {
        const bankPayout = await stripe.payouts.retrieve(bankPayoutId, {
          stripeAccount: acct,
        });
        console.log("  Bank payout:", {
          id: bankPayout.id,
          amount: bankPayout.amount,
          currency: bankPayout.currency,
          status: bankPayout.status,
          arrival_date: bankPayout.arrival_date,
          failure_balance_transaction: bankPayout.failure_balance_transaction,
          failure_code: bankPayout.failure_code,
          failure_message: bankPayout.failure_message,
        });
      } catch (err) {
        console.warn(`  Could not retrieve bank payout ${bankPayoutId} on account ${acct}:`, err.message);
      }
    } else if (bankPayoutId && !acct) {
      console.warn("  Have bank_payout_id but no stripeAccountId on user; cannot retrieve.");
    } else {
      console.log("  No bank payout id recorded.");
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
