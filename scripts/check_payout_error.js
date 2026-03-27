require('dotenv').config();
const mongoose = require('mongoose');
const Payout = require('../src/models/Payout');

async function checkLastPayoutError() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const lastPayout = await Payout.findOne({})
      .sort({ createdAt: -1 })
      .lean();

    if (!lastPayout) {
      console.log('No payouts found.');
      return;
    }

    console.log('--- Latest Payout Details ---');
    console.log('ID:', lastPayout._id);
    console.log('User ID:', lastPayout.user_id);
    console.log('Amount:', lastPayout.amount);
    console.log('Status:', lastPayout.status);
    console.log('Failure Reason:', lastPayout.failure_reason);
    console.log('Failure Code:', lastPayout.failure_code);
    console.log('Metadata:', JSON.stringify(lastPayout.metadata, null, 2));
    console.log('-----------------------------');

  } catch (error) {
    console.error('Error checking payout:', error);
  } finally {
    await mongoose.connection.close();
  }
}

checkLastPayoutError();
