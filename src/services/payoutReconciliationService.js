const Payout = require("../models/Payout");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

/**
 * Payout Reconciliation Service
 * 
 * This is a critical safety net that runs periodically to catch and fix
 * any payouts that got stuck due to:
 * - Server crashes during withdrawal flow
 * - Network timeouts to Stripe
 * - Webhook delivery failures
 * - Any other unexpected interruption
 * 
 * HOW IT WORKS:
 * 1. Finds payouts stuck in "pending" for > 1 hour (should be processed in seconds)
 * 2. Finds payouts stuck in "processing" for > 7 days (Stripe transfers settle in 2-5 days)
 * 3. For each stuck payout:
 *    a. Checks Stripe to see if a transfer actually exists
 *    b. If transfer exists → mark as processing/completed
 *    c. If no transfer → refund wallet + mark as failed
 * 
 * SCHEDULE: Run every 30 minutes via cron or setInterval
 */

const STUCK_PENDING_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const STUCK_PROCESSING_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Main reconciliation function
 * Call this on a schedule (e.g., every 30 minutes)
 */
async function reconcileStuckPayouts() {
  console.log("[RECONCILIATION] Starting payout reconciliation...");
  
  let fixed = 0;
  let refunded = 0;
  let errors = 0;

  try {
    // ===== 1. Handle stuck PENDING payouts =====
    // These are payouts where the DB transaction committed but Stripe transfer
    // was never attempted (server crash) or failed with a timeout
    const stuckPendingPayouts = await Payout.find({
      status: "pending",
      requested_at: { $lt: new Date(Date.now() - STUCK_PENDING_THRESHOLD_MS) },
    }).populate("wallet_id");

    console.log(`[RECONCILIATION] Found ${stuckPendingPayouts.length} stuck pending payouts`);

    for (const payout of stuckPendingPayouts) {
      try {
        await reconcilePendingPayout(payout);
        refunded++;
      } catch (err) {
        console.error(`[RECONCILIATION] Error reconciling pending payout ${payout._id}:`, err.message);
        errors++;
      }
    }

    // ===== 2. Handle stuck PROCESSING payouts =====
    // These are payouts where Stripe transfer was created but we never got
    // the webhook confirming completion or failure
    const stuckProcessingPayouts = await Payout.find({
      status: "processing",
      processing_started_at: { $lt: new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS) },
    });

    console.log(`[RECONCILIATION] Found ${stuckProcessingPayouts.length} stuck processing payouts`);

    for (const payout of stuckProcessingPayouts) {
      try {
        await reconcileProcessingPayout(payout);
        fixed++;
      } catch (err) {
        console.error(`[RECONCILIATION] Error reconciling processing payout ${payout._id}:`, err.message);
        errors++;
      }
    }

    // ===== 3. Handle payouts flagged for manual refund =====
    const manualRefundPayouts = await Payout.find({
      status: "failed",
      "metadata.needs_manual_refund": true,
    });

    console.log(`[RECONCILIATION] Found ${manualRefundPayouts.length} payouts needing manual refund retry`);

    for (const payout of manualRefundPayouts) {
      try {
        await retryManualRefund(payout);
        refunded++;
      } catch (err) {
        console.error(`[RECONCILIATION] Error retrying refund for payout ${payout._id}:`, err.message);
        errors++;
      }
    }

    console.log(`[RECONCILIATION] Complete: ${fixed} fixed, ${refunded} refunded, ${errors} errors`);
    return { fixed, refunded, errors };
  } catch (error) {
    console.error("[RECONCILIATION] Fatal error:", error);
    throw error;
  }
}

/**
 * Reconcile a payout stuck in "pending" status
 * Check if a Stripe transfer was actually created, otherwise refund
 */
async function reconcilePendingPayout(payout) {
  console.log(`[RECONCILIATION] Checking pending payout ${payout._id} (user: ${payout.user_id})`);

  const user = await User.findById(payout.user_id);
  if (!user || !user.stripeAccountId) {
    // No Stripe account — definitely needs refund
    await refundStuckPayout(payout, "No Stripe account found during reconciliation");
    return;
  }

  // Check Stripe for any transfers matching this payout
  try {
    const transfers = await stripe.transfers.list({
      limit: 10,
      destination: user.stripeAccountId,
    });

    const matchingTransfer = transfers.data.find(
      (t) => t.metadata?.payout_id === payout._id.toString()
    );

    if (matchingTransfer) {
      // Transfer EXISTS on Stripe — mark as processing (don't refund!)
      console.log(`[RECONCILIATION] Found matching transfer ${matchingTransfer.id} for payout ${payout._id}`);
      await payout.markProcessing(null, matchingTransfer.id);

      // Update transaction too
      await Transaction.findOneAndUpdate(
        { reference_id: payout._id, type: "withdrawal" },
        {
          status: "completed",
          stripe_transfer_id: matchingTransfer.id,
          processed_at: new Date(),
        }
      );
    } else {
      // No transfer found — refund the wallet
      console.log(`[RECONCILIATION] No transfer found for payout ${payout._id} — refunding`);
      await refundStuckPayout(payout, "No Stripe transfer found after timeout");
    }
  } catch (stripeError) {
    console.error(`[RECONCILIATION] Stripe API error for payout ${payout._id}:`, stripeError.message);
    // Don't refund on API error — try again next cycle
    throw stripeError;
  }
}

/**
 * Reconcile a payout stuck in "processing" status
 * Check actual transfer status on Stripe
 */
async function reconcileProcessingPayout(payout) {
  console.log(`[RECONCILIATION] Checking processing payout ${payout._id} (transfer: ${payout.stripe_transfer_id})`);

  if (!payout.stripe_transfer_id) {
    // No transfer ID — this shouldn't happen, but refund to be safe
    await refundStuckPayout(payout, "Processing payout has no transfer ID");
    return;
  }

  try {
    const transfer = await stripe.transfers.retrieve(payout.stripe_transfer_id);

    if (transfer.reversed) {
      // Transfer was reversed — refund wallet
      await refundStuckPayout(payout, "Stripe transfer was reversed");
    } else {
      // Transfer exists and is not reversed — mark completed
      console.log(`[RECONCILIATION] Transfer ${transfer.id} is valid, marking payout ${payout._id} as completed`);
      await payout.markCompleted();

      await Transaction.findOneAndUpdate(
        { reference_id: payout._id, type: "withdrawal" },
        { status: "completed", processed_at: new Date() }
      );
    }
  } catch (stripeError) {
    if (stripeError.statusCode === 404) {
      // Transfer doesn't exist on Stripe — refund
      await refundStuckPayout(payout, "Stripe transfer not found (404)");
    } else {
      throw stripeError;
    }
  }
}

/**
 * Refund a stuck payout — restore money to user's wallet
 */
async function refundStuckPayout(payout, reason) {
  console.log(`[RECONCILIATION] Refunding payout ${payout._id}: ${reason}`);

  try {
    // Atomic refund — safe even with concurrent requests
    await Wallet.atomicRefund(payout.wallet_id, payout.amount);

    // Mark payout as failed
    await payout.markFailed(reason, "reconciliation_refund");

    // Update transaction
    await Transaction.findOneAndUpdate(
      { reference_id: payout._id, type: "withdrawal" },
      {
        status: "failed",
        metadata: { failure_reason: reason, reconciled: true },
      }
    );

    console.log(`[RECONCILIATION] Refunded ${payout.amount} cents for payout ${payout._id}`);
  } catch (error) {
    console.error(`[RECONCILIATION] CRITICAL: Failed to refund payout ${payout._id}:`, error.message);
    // Flag for manual intervention
    payout.metadata = {
      ...payout.metadata,
      needs_manual_refund: true,
      refund_amount: payout.amount,
      reconciliation_error: error.message,
      reconciliation_attempted_at: new Date(),
    };
    await payout.save();
    throw error;
  }
}

/**
 * Retry refunds that previously failed
 */
async function retryManualRefund(payout) {
  console.log(`[RECONCILIATION] Retrying refund for payout ${payout._id}`);

  const refundAmount = payout.metadata?.refund_amount || payout.amount;

  try {
    await Wallet.atomicRefund(payout.wallet_id, refundAmount);

    // Clear the manual refund flag
    payout.metadata = {
      ...payout.metadata,
      needs_manual_refund: false,
      manual_refund_completed_at: new Date(),
    };
    await payout.save();

    // Update transaction
    await Transaction.findOneAndUpdate(
      { reference_id: payout._id, type: "withdrawal" },
      {
        status: "failed",
        metadata: { refund_retried: true, refunded_at: new Date() },
      }
    );

    console.log(`[RECONCILIATION] Manual refund successful for payout ${payout._id}`);
  } catch (error) {
    console.error(`[RECONCILIATION] Manual refund retry failed for payout ${payout._id}:`, error.message);
    throw error;
  }
}

/**
 * Start the reconciliation scheduler
 * Call this when the server starts
 */
function startReconciliationScheduler() {
  const intervalMs = parseInt(process.env.RECONCILIATION_INTERVAL_MS) || 30 * 60 * 1000; // 30 minutes default

  console.log(`[RECONCILIATION] Scheduler started (interval: ${intervalMs / 1000 / 60} minutes)`);

  // Run once on startup (after a delay to let DB connect)
  setTimeout(() => {
    reconcileStuckPayouts().catch((err) =>
      console.error("[RECONCILIATION] Initial run failed:", err.message)
    );
  }, 30000); // 30 second delay after startup

  // Then run on interval
  setInterval(() => {
    reconcileStuckPayouts().catch((err) =>
      console.error("[RECONCILIATION] Scheduled run failed:", err.message)
    );
  }, intervalMs);
}

module.exports = {
  reconcileStuckPayouts,
  startReconciliationScheduler,
};
