const mongoose = require("mongoose");

/**
 * ProcessedWebhook Model
 * Tracks all Stripe webhook events that have been processed.
 * Used for idempotency - prevents double-processing of the same event.
 * 
 * Stripe can send the same webhook event multiple times due to:
 * - Network retries
 * - Server restarts
 * - Stripe internal retries
 * 
 * By recording each event ID, we skip duplicates and prevent double credits/debits.
 */
const processedWebhookSchema = new mongoose.Schema(
  {
    event_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      description: "Stripe event ID (e.g., evt_xxxxx)",
    },
    event_type: {
      type: String,
      required: true,
      description: "Stripe event type (e.g., payment_intent.succeeded)",
    },
    processed_at: {
      type: Date,
      default: Date.now,
    },
    result: {
      type: String,
      enum: ["success", "skipped", "error"],
      default: "success",
    },
    error_message: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Auto-delete old records after 30 days to prevent collection from growing infinitely
processedWebhookSchema.index({ processed_at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

/**
 * Check if an event has already been processed
 * @param {string} eventId - Stripe event ID
 * @returns {boolean} true if already processed
 */
processedWebhookSchema.statics.isProcessed = async function (eventId) {
  const existing = await this.findOne({ event_id: eventId });
  return !!existing;
};

/**
 * Mark an event as processed
 * @param {string} eventId - Stripe event ID
 * @param {string} eventType - Stripe event type
 * @param {string} result - Processing result
 * @param {object} metadata - Additional context
 */
processedWebhookSchema.statics.markProcessed = async function (eventId, eventType, result = "success", metadata = {}) {
  try {
    await this.create({
      event_id: eventId,
      event_type: eventType,
      result,
      metadata,
    });
  } catch (error) {
    // If duplicate key error, it was already processed (race condition safe)
    if (error.code === 11000) {
      return;
    }
    throw error;
  }
};

/**
 * Mark an event as processed with error
 */
processedWebhookSchema.statics.markError = async function (eventId, eventType, errorMessage) {
  try {
    await this.create({
      event_id: eventId,
      event_type: eventType,
      result: "error",
      error_message: errorMessage,
    });
  } catch (error) {
    if (error.code === 11000) {
      return;
    }
    throw error;
  }
};

const ProcessedWebhook = mongoose.model("ProcessedWebhook", processedWebhookSchema);

module.exports = ProcessedWebhook;
