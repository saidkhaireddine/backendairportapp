require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

async function diagnoseAndSeed() {
  try {
    console.log("--- Stripe Balance Diagnostic ---");
    
    // 1. Check current balance
    let balance = await stripe.balance.retrieve();
    console.log("Current Balance (Raw):", JSON.stringify(balance, null, 2));
    
    const availableEur = balance.available.find(b => b.currency === 'eur')?.amount || 0;
    const pendingEur = balance.pending.find(b => b.currency === 'eur')?.amount || 0;
    
    console.log(`Available EUR: ${(availableEur / 100).toFixed(2)}`);
    console.log(`Pending EUR: ${(pendingEur / 100).toFixed(2)}`);

    if (availableEur < 10000) { // If less than 100 EUR available
      console.log("\n--- Seeding Balance ---");
      
      // Attempt 1: Using tok_visa_debit_worldwide_success which often settles quickly
      // or tok_bypassPending
      console.log("Method 1: Using tok_bypassPending...");
      try {
        const charge = await stripe.charges.create({
          amount: 100000, // 1000 EUR
          currency: "eur",
          source: "tok_bypassPending",
          description: "Seed available balance",
        });
        console.log(`✅ Method 1 Success: Charge ${charge.id}`);
      } catch (e) {
        console.log(`❌ Method 1 Failed: ${e.message}`);
      }

      // Attempt 2: Using the recommended test card number if possible via a charge
      // Note: Charges API still allows 'sc_...' or tokens. 
      // Let's try tok_visa which is standard success.
      console.log("Method 2: Using tok_visa...");
      try {
        const charge = await stripe.charges.create({
          amount: 50000, // 500 EUR
          currency: "eur",
          source: "tok_visa",
          description: "Seed pending balance",
        });
        console.log(`✅ Method 2 Success: Charge ${charge.id}`);
      } catch (e) {
        console.log(`❌ Method 2 Failed: ${e.message}`);
      }
      
      // Re-check balance
      balance = await stripe.balance.retrieve();
      const newAvailable = balance.available.find(b => b.currency === 'eur')?.amount || 0;
      console.log(`\nNew Available EUR: ${(newAvailable / 100).toFixed(2)}`);
    } else {
      console.log("\nBalance seems sufficient (> 100 EUR).");
    }

    console.log("\n--- Recommendation ---");
    console.log("If Available Balance is still low, Stripe Test Mode might be experiencing delays.");
    console.log("Try making a payment in the app using the 4000...0077 card directly.");

  } catch (error) {
    console.error("Diagnostic failed:", error);
  }
}

diagnoseAndSeed();
