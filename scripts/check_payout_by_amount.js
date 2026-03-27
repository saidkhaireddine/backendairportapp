// Check a specific payout by amount (cents) and report Stripe transfer/payout state.
// Usage: node scripts/check_payout_by_amount.js [amount_cents]
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

const amountFilter = parseInt(process.argv[2] || process.env.AMOUNT_CENTS || "1000", 10);
if (Number.isNaN(amountFilter) || amountFilter <= 0) {
  console.error("Provide a valid amount in cents (arg or AMOUNT_CENTS env)");
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB\n");

  const payout = await Payout.findOne({ amount: amountFilter })
    .sort({ createdAt: -1 })
    .lean();

  if (!payout) {
    console.log(`No payout found with amount ${amountFilter} cents`);
    return;
  }

  const tx = await Transaction.findOne({
    reference_id: payout._id,
    reference_type: "payout",
  })
    .sort({ createdAt: -1 })
    .lean();

  const user = await User.findById(payout.user_id).lean();
  const acct = user?.stripeAccountId;

  console.log("Payout found:");
  console.log({
    payout_id: payout._id.toString(),
    user: payout.user_id?.toString(),
    amount_cents: payout.amount,
    status: payout.status,
    failure_reason: payout.failure_reason || null,
    metadata: payout.metadata || null,
    transaction_id: tx?._id || null,
    tx_status: tx?.status || null,
    tx_stripe_transfer_id: tx?.stripe_transfer_id || null,
    stripe_account: acct || null,
  });

  if (tx?.stripe_transfer_id) {
    try {
      const transfer = await stripe.transfers.retrieve(tx.stripe_transfer_id);
      console.log("Stripe transfer:", {
        id: transfer.id,
        amount: transfer.amount,
        currency: transfer.currency,
        destination: transfer.destination,
        status: transfer.reversed ? "reversed" : transfer.status,
      });
    } catch (err) {
      console.warn(`Could not retrieve transfer ${tx.stripe_transfer_id}:`, err.message);
    }
  } else {
    console.log("No Stripe transfer id on transaction");
  }

  const bankPayoutId = payout.metadata?.bank_payout_id || tx?.metadata?.bank_payout_id;
  if (bankPayoutId && acct) {
    try {
      const bankPayout = await stripe.payouts.retrieve(bankPayoutId, {
        stripeAccount: acct,
      });
      console.log("Bank payout:", {
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
      console.warn(`Could not retrieve bank payout ${bankPayoutId} on account ${acct}:`, err.message);
    }
  } else if (bankPayoutId && !acct) {
    console.warn("Have bank_payout_id but no stripeAccountId on user; cannot retrieve.");
  } else {
    console.log("No bank payout id recorded.");
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
