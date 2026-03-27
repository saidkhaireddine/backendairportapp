require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function testStripeFlow() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const testEmail = `test_${Date.now()}@example.com`;
    console.log(`Testing with email: ${testEmail}`);

    // Simulate Stripe Account Creation
    console.log('--- Step 1: Create Stripe Account ---');
    const account = await stripe.accounts.create({
      type: "express",
      email: testEmail,
      capabilities: {
        transfers: { requested: true },
      },
    });
    console.log('Stripe Account Created:', account.id);

    // Simulate User Creation
    console.log('--- Step 2: Create User in DB ---');
    const user = await User.create({
      email: testEmail,
      first_name: "Test",
      last_name: "User",
      phone: "+33600000000",
      role: "driver",
      stripeAccountId: account.id,
      isStripeVerified: false
    });
    console.log('User created in DB:', user._id);

    // Simulate Onboarding Link Generation
    console.log('--- Step 3: Create Onboarding Link ---');
    const accountLink = await stripe.accountLinks.create({
      account: user.stripeAccountId,
      refresh_url: "http://localhost:3000/reauth",
      return_url: "http://localhost:3000/dashboard",
      type: "account_onboarding",
    });
    console.log('Onboarding Link generated:', accountLink.url);

    // Simulate Webhook Update
    console.log('--- Step 4: Simulate Webhook Update ---');
    // We can't easily trigger a real webhook here, but we can test the DB update logic
    user.isStripeVerified = true;
    await user.save();
    console.log('User verified in DB');

    // Cleanup
    await User.deleteOne({ _id: user._id });
    console.log('Test user deleted');

    console.log('--- Verification Successful ---');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await mongoose.connection.close();
  }
}

testStripeFlow();
