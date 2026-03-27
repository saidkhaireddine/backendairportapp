const User = require("../models/User");
const Ride = require("../models/Ride");
const Booking = require("../models/Booking");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

/**
 * POST /api/v1/payments/create-intent
 * Body: { rideId, seats }
 * Auth: required
 *
 * Creates a PaymentIntent for a ride BEFORE creating booking.
 */
exports.createPaymentIntent = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { rideId, seats, luggage } = req.body;
    
    console.log("Payment intent request:", { userId, rideId, seats, luggage });
    
    if (!rideId || !seats) {
      return res.status(400).json({ 
        success: false, 
        message: "rideId and seats are required" 
      });
    }
    
    const ride = await Ride.findById(rideId).populate('driver_id');
    if (!ride) {
      return res.status(404).json({ 
        success: false, 
        message: "Ride not found" 
      });
    }
    
    console.log("Found ride:", ride._id);
    
    // Check if enough seats available
    if (ride.seats_left < seats) {
      return res.status(400).json({ 
        success: false, 
        message: `Only ${ride.seats_left} seats available` 
      });
    }
    
    const driver = ride.driver_id;
    console.log("Driver:", driver?._id, "Stripe Account:", driver?.stripeAccountId);
    
    // Calculate total price and platform fee
    const totalAmount = Math.round(ride.price_per_seat * seats * 100); // in cents
    const platformFeePercent = parseFloat(process.env.PLATFORM_FEE_PERCENT || "10");
    const applicationFeeAmount = Math.round(totalAmount * (platformFeePercent / 100));
    
    console.log("Payment calculation:", {
      pricePerSeat: ride.price_per_seat,
      seats,
      totalAmount,
      platformFeePercent,
      applicationFeeAmount
    });
    
    let paymentIntentData = {
      amount: totalAmount,
      currency: process.env.STRIPE_CURRENCY || "eur", // Dynamic currency
      payment_method_types: ["card"],
      metadata: {
        rideId: ride._id.toString(),
        passengerId: userId,
        driverId: driver?._id?.toString() || "",
        seats: seats.toString(),
        luggage: JSON.stringify(luggage || []),
      },
    };
    
    console.log("Payment will be collected by platform and credited to driver wallet via webhook");
    
    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);
    
    console.log("PaymentIntent created:", paymentIntent.id);
    
    res.status(201).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalAmount,
      currency: "EUR",
    });
  } catch (error) {
    console.error("Payment intent creation error:", error);
    next(error);
  }
};

/**
 * POST /api/v1/payments/create-offer-intent
 * Body: { requestId, offerId }
 * Auth: required
 *
 * Creates a PaymentIntent for accepting an offer on a ride request.
 */
exports.createOfferPaymentIntent = async (req, res, next) => {
  const RideRequest = require("../models/RideRequest");
  
  try {
    const userId = req.user.id;
    const { requestId, offerId } = req.body;
    
    console.log("Offer payment intent request:", { userId, requestId, offerId });
    
    if (!requestId || !offerId) {
      return res.status(400).json({ 
        success: false, 
        message: "requestId and offerId are required" 
      });
    }
    
    const request = await RideRequest.findOne({
      _id: requestId,
      passenger: userId,
    }).populate('offers.driver');
    
    if (!request) {
      return res.status(404).json({ 
        success: false, 
        message: "Request not found" 
      });
    }
    
    const offer = request.offers.id(offerId);
    if (!offer) {
      return res.status(404).json({ 
        success: false, 
        message: "Offer not found" 
      });
    }
    
    if (offer.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: "Offer is no longer pending" 
      });
    }
    
    const driver = await User.findById(offer.driver);
    console.log("Driver:", driver?._id, "Stripe Account:", driver?.stripeAccountId);
    
    // Calculate total price and platform fee
    const totalAmount = Math.round(offer.price_per_seat * request.seats_needed * 100); // in cents
    const platformFeePercent = parseFloat(process.env.PLATFORM_FEE_PERCENT || "10");
    const applicationFeeAmount = Math.round(totalAmount * (platformFeePercent / 100));
    
    console.log("Offer payment calculation:", {
      pricePerSeat: offer.price_per_seat,
      seats: request.seats_needed,
      totalAmount,
      platformFeePercent,
      applicationFeeAmount
    });
    
    let paymentIntentData = {
      amount: totalAmount,
      currency: process.env.STRIPE_CURRENCY || "eur", // Dynamic currency
      payment_method_types: ["card"],
      metadata: {
        requestId: request._id.toString(),
        offerId: offerId,
        passengerId: userId,
        driverId: driver?._id?.toString() || "",
        seats: request.seats_needed.toString(),
        type: "offer_acceptance",
      },
    };
    
    console.log("Offer payment will be collected by platform and credited via webhook");
    
    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);
    
    console.log("Offer PaymentIntent created:", paymentIntent.id);
    
    res.status(201).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalAmount,
      currency: "EUR",
    });
  } catch (error) {
    console.error("Offer payment intent creation error:", error);
    next(error);
  }
};

/**
 * POST /api/v1/payments/complete
 * Body: { paymentIntentId, rideId, seats }
 * Auth: required
 *
 * Verifies payment and creates the booking after successful payment
 */
exports.completePayment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { paymentIntentId, rideId, seats, luggage } = req.body;
    
    console.log("Complete payment request:", { userId, paymentIntentId, rideId, seats, luggage });
    
    if (!paymentIntentId || !rideId || !seats) {
      return res.status(400).json({ 
        success: false, 
        message: "paymentIntentId, rideId and seats are required" 
      });
    }
    
    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ 
        success: false, 
        message: `Payment not completed. Status: ${paymentIntent.status}` 
      });
    }
    
    console.log("Payment verified:", paymentIntent.status);
    
    // Find the ride
    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ 
        success: false, 
        message: "Ride not found" 
      });
    }
    
    // Check seats again
    if (ride.seats_left < seats) {
      // Refund the payment since seats are no longer available
      await stripe.refunds.create({ payment_intent: paymentIntentId });
      return res.status(400).json({ 
        success: false, 
        message: "Seats no longer available. Payment refunded." 
      });
    }
    
    // Create the booking with status 'accepted' (already paid)
    let booking;
    try {
      booking = await Booking.create({
        ride_id: rideId,
        passenger_id: userId,
        seats: seats,
        luggage: luggage || [],
        status: 'accepted', // Already paid, so automatically accepted
        payment_status: 'paid',
        payment_method: 'card',
        payment_intent_id: paymentIntentId,
      });
    } catch (bookingError) {
      // If booking creation fails, refund the Stripe payment
      console.error("Booking creation failed, issuing refund:", bookingError.message);
      try {
        await stripe.refunds.create({ payment_intent: paymentIntentId });
        console.log("Refund issued for payment intent:", paymentIntentId);
      } catch (refundError) {
        console.error("CRITICAL: Refund also failed for PI:", paymentIntentId, refundError.message);
      }
      return res.status(500).json({
        success: false,
        message: "Failed to create booking. Payment has been refunded.",
      });
    }
    
    console.log("Booking created:", booking._id);
    
    // Update ride seats and per-type luggage remaining
    const luggageInc = {};
    if (luggage && luggage.length > 0) {
      luggage.forEach(item => {
        luggageInc[`luggage_remaining.count_${item.type}`] = -item.quantity;
      });
    }
    await Ride.findByIdAndUpdate(
      rideId,
      { $inc: { seats_left: -seats, ...luggageInc } },
      { new: true }
    );
    
    console.log(`Ride ${rideId} seats updated, removed ${seats} seats and luggage:`, luggage);

    // Credit driver's wallet via our internal system
    // The money from the PaymentIntent stays on the platform's Stripe balance
    // This virtual balance can be withdrawn to bank later
    const driver = await User.findById(ride.driver_id);
    if (driver) {
      try {
        // Get or create driver's wallet
        const wallet = await Wallet.getOrCreateWallet(ride.driver_id);
        
        // Calculate amounts
        const grossAmount = paymentIntent.amount;
        const feePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENT || "10");
        const feeAmount = Math.round(grossAmount * (feePercentage / 100));
        const netAmount = grossAmount - feeAmount;
        
        // Get passenger info
        const passenger = await User.findById(userId);
        
        // Add to wallet
        await wallet.addEarnings(netAmount, false);
        
        // Create transaction record
        await Transaction.createRideEarning({
          wallet_id: wallet._id,
          user_id: ride.driver_id,
          gross_amount: grossAmount,
          fee_percentage: feePercentage,
          booking,
          ride,
          passenger,
          stripe_payment_intent_id: paymentIntentId,
        });
        
        console.log(`Credited ${netAmount} cents to driver ${ride.driver_id}'s wallet`);
      } catch (walletError) {
        console.error("Error crediting driver wallet:", walletError);
        // Don't fail the booking, just log the error
      }
    }
    
    res.status(201).json({
      success: true,
      message: "Payment completed and booking confirmed!",
      booking: booking,
    });
  } catch (error) {
    console.error("Payment completion error:", error);
    next(error);
  }
};

/**
 * POST /api/v1/payments/ride
 * Body: { bookingId }
 * Auth: required
 *
 * Creates a PaymentIntent for a booking, splits payment between driver and platform.
 * (Legacy - for existing bookings)
 */
exports.createRidePayment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { bookingId } = req.body;
    
    console.log("Payment request:", { userId, bookingId });
    
    if (!bookingId) {
      return res
        .status(400)
        .json({ success: false, message: "bookingId is required" });
    }
    
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      console.log("Booking not found:", bookingId);
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }
    
    console.log("Found booking:", booking);
    
    const ride = await Ride.findById(booking.ride_id);
    if (!ride) {
      console.log("Ride not found:", booking.ride_id);
      return res
        .status(404)
        .json({ success: false, message: "Ride not found" });
    }
    
    console.log("Found ride:", ride);
    
    const driver = await User.findById(ride.driver_id);
    if (!driver || !driver.stripeAccountId) {
      console.log("Driver issues:", { 
        driverId: ride.driver_id, 
        hasDriver: !!driver, 
        hasStripeAccount: driver?.stripeAccountId 
      });
      return res
        .status(400)
        .json({
          success: false,
          message: "Driver does not have a Stripe account",
        });
    }
    
    console.log("Driver stripe account:", driver.stripeAccountId);
    
    // Calculate total price and platform fee
    const totalAmount = Math.round(ride.price_per_seat * booking.seats * 100); // in cents
    const platformFeePercent = parseFloat(
      process.env.PLATFORM_FEE_PERCENT || "10",
    );
    const applicationFeeAmount = Math.round(
      totalAmount * (platformFeePercent / 100),
    );
    
    console.log("Payment calculation:", {
      pricePerSeat: ride.price_per_seat,
      seats: booking.seats,
      totalAmount,
      platformFeePercent,
      applicationFeeAmount
    });
    
    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: process.env.STRIPE_CURRENCY || "eur",
      payment_method_types: ["card"],
      metadata: {
        bookingId: booking._id.toString(),
        rideId: ride._id.toString(),
        passengerId: userId,
        driverId: driver._id.toString(),
      },
    });
    
    console.log("Legacy Ride PaymentIntent created (collected by platform):", paymentIntent.id);
    
    res.status(201).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Payment creation error:", error);
    next(error);
  }
};

/**
 * POST /api/v1/payments/wallet
 * Body: { rideId, seats }
 * Auth: required
 *
 * Pay for a ride using wallet balance - NO Stripe fees!
 * This allows users to use their wallet balance to book rides.
 */
exports.payWithWallet = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { rideId, seats, luggage } = req.body;
    
    console.log("Wallet payment request:", { userId, rideId, seats, luggage });
    
    if (!rideId || !seats) {
      return res.status(400).json({ 
        success: false, 
        message: "rideId and seats are required" 
      });
    }
    
    // Find the ride
    const ride = await Ride.findById(rideId).populate('driver_id');
    if (!ride) {
      return res.status(404).json({ 
        success: false, 
        message: "Ride not found" 
      });
    }
    
    // Check if user is trying to book their own ride
    const driverId = ride.driver_id?._id || ride.driver_id;
    if (driverId.toString() === userId) {
      return res.status(400).json({
        success: false,
        message: "You cannot book your own ride"
      });
    }
    
    // Check if enough seats available
    if (ride.seats_left < seats) {
      return res.status(400).json({ 
        success: false, 
        message: `Only ${ride.seats_left} seats available` 
      });
    }
    
    // Calculate total amount in cents
    const totalAmount = Math.round(ride.price_per_seat * seats * 100);
    
    // Get passenger's wallet
    const passengerWallet = await Wallet.getOrCreateWallet(userId);
    
    // Check if passenger has enough balance
    if (passengerWallet.balance < totalAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance",
        required: totalAmount,
        required_display: (totalAmount / 100).toFixed(2),
        available: passengerWallet.balance,
        available_display: (passengerWallet.balance / 100).toFixed(2),
        code: "INSUFFICIENT_BALANCE"
      });
    }
    
    console.log("Wallet payment calculation:", {
      pricePerSeat: ride.price_per_seat,
      seats,
      totalAmount,
      walletBalance: passengerWallet.balance
    });
    
    // Deduct from passenger wallet
    passengerWallet.balance -= totalAmount;
    await passengerWallet.save();
    
    // Create the booking with status 'accepted' (already paid)
    const booking = await Booking.create({
      ride_id: rideId,
      passenger_id: userId,
      seats: seats,
      luggage: luggage || [],
      status: 'accepted',
      payment_status: 'paid',
      payment_method: 'wallet', // Mark as wallet payment
    });
    
    console.log("Booking created with wallet payment:", booking._id);
    
    // Update ride seats and per-type luggage remaining
    const luggageInc = {};
    if (luggage && luggage.length > 0) {
      luggage.forEach(item => {
        luggageInc[`luggage_remaining.count_${item.type}`] = -item.quantity;
      });
    }
    await Ride.findByIdAndUpdate(
      rideId,
      { $inc: { seats_left: -seats, ...luggageInc } },
      { new: true }
    );
    
    // Get passenger info for transaction record
    const passenger = await User.findById(userId);
    
    // Create transaction record for passenger (debit)
    await Transaction.create({
      wallet_id: passengerWallet._id,
      user_id: userId,
      type: 'ride_payment',
      amount: -totalAmount,
      gross_amount: totalAmount,
      fee_amount: 0, // No fees for wallet payments!
      fee_percentage: 0,
      net_amount: totalAmount,
      currency: 'EUR',
      status: 'completed',
      reference_type: 'booking',
      reference_id: booking._id,
      description: `Payment for ride booking - ${seats} seat(s)`,
      ride_details: {
        ride_id: ride._id,
        booking_id: booking._id,
        driver_id: driverId,
        driver_name: ride.driver_id?.name || 'Driver',
        seats: seats,
        price_per_seat: ride.price_per_seat,
        route: `${ride.home_city || 'Origin'} → ${ride.airport_name || 'Airport'}`,
      },
      processed_at: new Date(),
    });
    
    // Credit driver's wallet (full amount - no platform fee for wallet payments)
    const driver = ride.driver_id;
    const driverWallet = await Wallet.getOrCreateWallet(driverId);
    
    // Calculate platform fee (still apply platform fee)
    const platformFeePercent = parseFloat(process.env.PLATFORM_FEE_PERCENT || "10");
    const platformFee = Math.round(totalAmount * (platformFeePercent / 100));
    const driverEarnings = totalAmount - platformFee;
    
    // Add to driver's wallet
    await driverWallet.addEarnings(driverEarnings, false);
    
    // Create transaction record for driver (credit)
    await Transaction.create({
      wallet_id: driverWallet._id,
      user_id: driverId,
      type: 'ride_earning',
      amount: driverEarnings,
      gross_amount: totalAmount,
      fee_amount: platformFee,
      fee_percentage: platformFeePercent,
      net_amount: driverEarnings,
      currency: 'EUR',
      status: 'completed',
      reference_type: 'booking',
      reference_id: booking._id,
      description: `Earnings from wallet payment - ${seats} seat(s)`,
      ride_details: {
        ride_id: ride._id,
        booking_id: booking._id,
        passenger_id: userId,
        passenger_name: passenger?.name || 'Passenger',
        seats: seats,
        price_per_seat: ride.price_per_seat,
        route: `${ride.home_city || 'Origin'} → ${ride.airport_name || 'Airport'}`,
      },
      processed_at: new Date(),
    });
    
    console.log(`Wallet payment completed: ${totalAmount} cents from passenger, ${driverEarnings} cents to driver`);
    
    res.status(201).json({
      success: true,
      message: "Booking paid with wallet balance! No Stripe fees applied.",
      booking: booking,
      payment: {
        amount: totalAmount,
        amount_display: (totalAmount / 100).toFixed(2),
        method: 'wallet',
        new_balance: passengerWallet.balance,
        new_balance_display: (passengerWallet.balance / 100).toFixed(2),
        fees_saved: "Stripe fees", // User saved on Stripe fees
      }
    });
  } catch (error) {
    console.error("Wallet payment error:", error);
    next(error);
  }
};

/**
 * POST /api/v1/payments/confirm
 * Body: { paymentIntentId, bookingId }
 * Auth: required
 *
 * Confirms payment and updates booking status to accepted
 */
exports.confirmPayment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { paymentIntentId, bookingId } = req.body;
    
    console.log("Payment confirmation:", { userId, paymentIntentId, bookingId });
    
    if (!paymentIntentId || !bookingId) {
      return res.status(400).json({ 
        success: false, 
        message: "paymentIntentId and bookingId are required" 
      });
    }
    
    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ 
        success: false, 
        message: "Payment not completed" 
      });
    }
    
    // Find and update booking
    const booking = await Booking.findById(bookingId).populate('ride_id');
    if (!booking) {
      return res.status(404).json({ 
        success: false, 
        message: "Booking not found" 
      });
    }
    
    // Update booking status to accepted
    booking.status = 'accepted';
    await booking.save();
    
    // Update ride seats
    const ride = booking.ride_id;
    await Ride.findByIdAndUpdate(
      ride._id,
      { $inc: { seats_left: -booking.seats } },
      { new: true }
    );
    
    console.log(`Booking ${bookingId} confirmed and accepted after payment ${paymentIntentId}`);
    
    res.status(200).json({
      success: true,
      message: "Payment confirmed and booking accepted",
      booking: booking,
    });
  } catch (error) {
    console.error("Payment confirmation error:", error);
    next(error);
  }
};

/**
 * GET /api/v1/payments/onboarding-link
 * Auth: required
 *
 * Creates a Stripe Express onboarding link for the current user.
 */
exports.createOnboardingLink = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    let stripeAccountId = user.stripeAccountId;

    // If for some reason the account wasn't created at registration, create it now
    if (!stripeAccountId) {
      console.log(`Creating missing Stripe account for user ${userId}`);
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email,
        capabilities: {
          transfers: { requested: true },
        },
      });
      stripeAccountId = account.id;
      user.stripeAccountId = stripeAccountId;
      await user.save();
    }

    // Create onboarding link
    // Default URLs - in production these should be your app's deep links or redirect pages
    const refresh_url = process.env.STRIPE_REAUTH_URL || "https://yourapp.com/reauth";
    const return_url = process.env.STRIPE_DASHBOARD_URL || "https://yourapp.com/dashboard";

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url,
      return_url,
      type: "account_onboarding",
    });

    res.status(200).json({
      success: true,
      url: accountLink.url,
    });
  } catch (error) {
    console.error("Error creating onboarding link:", error);
    next(error);
  }
};
