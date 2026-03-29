const Notification = require("../models/Notification");
const { safeDel } = require("../config/redisClient");

class NotificationService {
  /**
   * Helper to create notification and invalidate cache
   */
  static async createAndInvalidateCache(userId, notificationData) {
    const notification = await Notification.create(notificationData);
    // Invalidate user's notification cache so they see updates immediately
    await safeDel(`notifications:${userId.toString()}`);
    return notification;
  }

  /**
   * Notification types
   */
  static TYPES = {
    BOOKING_REQUEST: "booking_request",
    BOOKING_CANCELLED: "booking_cancelled",
    RIDE_CANCELLED: "ride_cancelled",
    CHAT_MESSAGE: "chat_message",
    RATE_DRIVER: "rate_driver",
    RATE_PASSENGER: "rate_passenger",
    OFFER_RECEIVED: "offer_received",
    REQUEST_ACCEPTED: "request_accepted",
    OFFER_ACCEPTED: "offer_accepted",
    OFFER_REJECTED: "offer_rejected",
  };

  /**
   * Send booking request notification to driver
   */
  static async notifyBookingRequest(driverId, bookingData) {
    return await this.createAndInvalidateCache(driverId, {
      user_id: driverId,
      type: this.TYPES.BOOKING_REQUEST,
      payload: {
        booking_id: bookingData.id,
        ride_id: bookingData.ride_id,
        passenger_name: `${bookingData.passenger_first_name} ${bookingData.passenger_last_name}`,
        seats: bookingData.seats,
        pickup_location: bookingData.pickup_location,
        dropoff_location: bookingData.dropoff_location,
      },
    });
  }



  /**
   * Send booking cancelled notification
   */
  static async notifyBookingCancelled(
    userId,
    bookingData,
    isCancelledByPassenger
  ) {
    return await this.createAndInvalidateCache(userId, {
      user_id: userId,
      type: this.TYPES.BOOKING_CANCELLED,
      payload: {
        booking_id: bookingData.id,
        ride_id: bookingData.ride_id,
        cancelled_by: isCancelledByPassenger ? "passenger" : "driver",
      },
    });
  }

  /**
   * Send ride cancelled notification to all passengers
   */
  static async notifyRideCancelled(passengerId, rideData) {
    return await this.createAndInvalidateCache(passengerId, {
      user_id: passengerId,
      type: this.TYPES.RIDE_CANCELLED,
      payload: {
        ride_id: rideData.id,
        airport_name: rideData.airport_name,
        datetime_start: rideData.datetime_start,
      },
    });
  }

  /**
   * Send chat message notification to receiver
   */
  static async notifyChatMessage(receiverId, messageData) {
    // One notification per conversation (booking or request). Replace older notification with the latest message.
    const filter = {
      user_id: receiverId,
      type: this.TYPES.CHAT_MESSAGE,
    };

    if (messageData.booking_id) {
      filter["payload.booking_id"] = messageData.booking_id;
    }
    if (messageData.request_id) {
      filter["payload.request_id"] = messageData.request_id;
    }

    // Remove any previous notification for this conversation so only the most recent message shows.
    await Notification.deleteMany(filter);

    return await this.createAndInvalidateCache(receiverId, {
      user_id: receiverId,
      type: this.TYPES.CHAT_MESSAGE,
      payload: {
        booking_id: messageData.booking_id,
        request_id: messageData.request_id,
        sender_id: messageData.sender_id,
        sender_name: messageData.sender_name,
        sender_role: messageData.sender_role,
        message_type: messageData.message_type,
        content: messageData.content,
        message_id: messageData.message_id,
        ride_id: messageData.ride_id,
        ride_from: messageData.ride_from,
        ride_to: messageData.ride_to,
      },
    });
  }

  /**
   * Send rate driver notification to passenger
   * Called 30 minutes after ride departure time
   */
  static async notifyRateDriver(passengerId, ratingData) {
    // Check if notification already sent for this booking
    const existing = await Notification.findOne({
      user_id: passengerId,
      type: this.TYPES.RATE_DRIVER,
      "payload.booking_id": ratingData.booking_id,
    });

    if (existing) {
      return existing; // Don't send duplicate
    }

    return await this.createAndInvalidateCache(passengerId, {
      user_id: passengerId,
      type: this.TYPES.RATE_DRIVER,
      payload: {
        booking_id: ratingData.booking_id,
        ride_id: ratingData.ride_id,
        driver_id: ratingData.driver_id,
        driver_name: ratingData.driver_name,
        driver_avatar: ratingData.driver_avatar,
        ride_direction: ratingData.ride_direction,
        ride_datetime: ratingData.ride_datetime,
      },
    });
  }

  /**
   * Send rate passenger notification to driver
   * Called 30 minutes after ride departure time
   */
  static async notifyRatePassenger(driverId, ratingData) {
    // Check if notification already sent for this booking
    const existing = await Notification.findOne({
      user_id: driverId,
      type: this.TYPES.RATE_PASSENGER,
      "payload.booking_id": ratingData.booking_id,
    });

    if (existing) {
      return existing; // Don't send duplicate
    }

    return await this.createAndInvalidateCache(driverId, {
      user_id: driverId,
      type: this.TYPES.RATE_PASSENGER,
      payload: {
        booking_id: ratingData.booking_id,
        ride_id: ratingData.ride_id,
        passenger_id: ratingData.passenger_id,
        passenger_name: ratingData.passenger_name,
        passenger_avatar: ratingData.passenger_avatar,
        ride_direction: ratingData.ride_direction,
        ride_datetime: ratingData.ride_datetime,
      },
    });
  }

  /**
   * Send offer received notification to passenger
   * Called when a driver makes an offer on a ride request
   */
  static async notifyOfferReceived(passengerId, offerData) {
    return await this.createAndInvalidateCache(passengerId, {
      user_id: passengerId,
      type: this.TYPES.OFFER_RECEIVED,
      payload: {
        request_id: offerData.request_id,
        offer_id: offerData.offer_id,
        driver_id: offerData.driver_id,
        driver_name: offerData.driver_name,
        price_per_seat: offerData.price_per_seat,
        message: offerData.message,
        ride_id: offerData.ride_id,
      },
    });
  }

  /**
   * Send request accepted notification to passenger
   * Called when a driver accepts a ride request
   */
  static async notifyRequestAccepted(passengerId, requestData) {
    return await this.createAndInvalidateCache(passengerId, {
      user_id: passengerId,
      type: this.TYPES.REQUEST_ACCEPTED,
      payload: {
        request_id: requestData.request_id,
        driver_id: requestData.driver_id,
        driver_name: requestData.driver_name,
        ride_id: requestData.ride_id,
        message: requestData.message || "Your ride request has been accepted by a driver.",
      },
    });
  }

  /**
   * Send offer accepted notification to driver
   * Called when a passenger accepts a driver's offer
   */
  static async notifyOfferAccepted(driverId, offerData) {
    return await this.createAndInvalidateCache(driverId, {
      user_id: driverId,
      type: this.TYPES.OFFER_ACCEPTED,
      payload: {
        request_id: offerData.request_id,
        passenger_id: offerData.passenger_id,
        passenger_name: offerData.passenger_name,
        ride_id: offerData.ride_id,
        message: offerData.message || "Your offer has been accepted by the passenger.",
      },
    });
  }

  /**
   * Send offer rejected notification to driver
   * Called when a passenger rejects or another offer is accepted
   */
  static async notifyOfferRejected(driverId, offerData) {
    return await this.createAndInvalidateCache(driverId, {
      user_id: driverId,
      type: this.TYPES.OFFER_REJECTED,
      payload: {
        request_id: offerData.request_id,
        passenger_id: offerData.passenger_id,
        passenger_name: offerData.passenger_name,
        ride_id: offerData.ride_id,
        message: offerData.message || "Your offer was not accepted.",
      },
    });
  }
}

module.exports = NotificationService;
