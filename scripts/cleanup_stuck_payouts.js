require('dotenv').config();
const mongoose = require('mongoose');
const Payout = require('../src/models/Payout');
const Transaction = require('../src/models/Transaction');
const Wallet = require('../src/models/Wallet');

async function cleanupStuckPayouts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find any payout in 'pending' or 'processing'
    const stuckPayouts = await Payout.find({ 
      status: { $in: ['pending', 'processing'] } 
    });

    console.log(`Found ${stuckPayouts.length} stuck payouts.`);

    for (const payout of stuckPayouts) {
      console.log(`Cleaning up Payout ${payout._id} (Status: ${payout.status}, Amount: ${payout.amount})...`);
      
      // We'll mark them as 'failed' and refund the wallet so the user can try again
      payout.status = 'failed';
      payout.failure_reason = 'Stuck payout cleared by cleanup script';
      await payout.save();

      // Refund the wallet
      const wallet = await Wallet.findById(payout.wallet_id);
      if (wallet) {
          wallet.balance += payout.amount;
          await wallet.save();
          console.log(`   Wallet ${wallet._id} refunded ${payout.amount} cents.`);
      }

      // Mark the transaction as failed
      await Transaction.findOneAndUpdate(
        { reference_id: payout._id },
        { status: 'failed', description: 'Withdrawal failed (cleared for retry)' }
      );
    }

    console.log('--- Cleanup Complete ---');
  } catch (error) {
    console.error('Cleanup failed:', error);
  } finally {
    await mongoose.connection.close();
  }
}

cleanupStuckPayouts();
