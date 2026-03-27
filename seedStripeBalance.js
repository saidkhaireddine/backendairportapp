require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

/**
 * SEED SCRIPT: Fills your Stripe Test Balance (Available Balance)
 * Uses the special tok_bypassPending token.
 */
const seedBalance = async (amountInEur = 500) => {
  try {
    console.log(`--- Starting Stripe Balance Seed: ${amountInEur} EUR ---`);

    // Use the official bypassPending token
    const charge = await stripe.charges.create({
      amount: amountInEur * 100,
      currency: "eur",
      source: "tok_bypassPending", 
      description: "Manual seed for available balance",
    });

    console.log(`✅ SUCCESS: Charge created: ${charge.id}`);
    
    // Fetch balance to verify
    const balance = await stripe.balance.retrieve();
    const availableEur = balance.available.find(b => b.currency === 'eur');
    const pendingEur = balance.pending.find(b => b.currency === 'eur');
    
    console.log(`--- Stripe Balance ---`);
    console.log(`Available: ${(availableEur?.amount / 100).toFixed(2)} EUR`);
    console.log(`Pending: ${(pendingEur?.amount / 100).toFixed(2)} EUR`);
    
    console.log("\nTry your /withdraw endpoint again!");
  } catch (error) {
    console.error("❌ Seeding failed:", error.message);
  }
};

if (require.main === module) {
  seedBalance(500); 
}

module.exports = seedBalance;
