require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

async function checkCurrencies() {
  try {
    console.log("--- Currency Support Test ---");
    
    // Check account info
    const account = await stripe.accounts.retrieve();
    console.log(`Account ID: ${account.id}`);
    console.log(`Default Currency: ${account.default_currency}`);
    console.log(`Country: ${account.country}`);

    // Try to seed 10 EUR explicitly
    console.log("\nAttempting to seed 10 EUR...");
    try {
      const charge = await stripe.charges.create({
        amount: 1000,
        currency: "eur",
        source: "tok_visa",
        description: "EUR Test Seed",
      });
      console.log(`✅ EUR Charge Created: ${charge.id}`);
    } catch (e) {
      console.log(`❌ EUR Charge Failed: ${e.message}`);
    }

    // Check balance again
    const balance = await stripe.balance.retrieve();
    console.log("\n--- Current Balance Array ---");
    balance.available.forEach(b => {
      console.log(`Available: ${b.amount/100} ${b.currency.toUpperCase()}`);
    });
    balance.pending.forEach(b => {
      console.log(`Pending: ${b.amount/100} ${b.currency.toUpperCase()}`);
    });

    if (!balance.available.find(b => b.currency === 'eur') && !balance.pending.find(b => b.currency === 'eur')) {
      console.log("\n⚠️ EUR balance is still missing even after seeding.");
      console.log("This usually means your Stripe Test account is pinned to USD.");
      
      console.log("\n--- PROPOSAL ---");
      console.log("Since your account is USD-based, we should try switching the app to USD for testing purposes,");
      console.log("or you may need to create a Stripe account in a EUR country.");
    }

  } catch (error) {
    console.error("Test failed:", error);
  }
}

checkCurrencies();
