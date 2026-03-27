const express = require("express");
const BookingController = require("../controllers/bookingController");
const authMiddleware = require("../middleware/auth");
const { validate, validationRules, Joi } = require("../middleware/validation");

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Validation schemas
const createBookingSchema = Joi.object({
  seats: validationRules.positiveInt,
  luggage: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().valid("10kg", "20kg", "hors_norme", "sac").required(),
        quantity: Joi.number().integer().min(1).required(),
      })
    )
    .default([]),
});

const updateBookingSchema = Joi.object({
  status: Joi.string().valid("accepted", "rejected", "cancelled"),
  seats: validationRules.positiveInt.optional(),
}).min(1);

// Routes
router.post(
  "/rides/:rideId/bookings",
  validate(createBookingSchema),
  BookingController.create
);
// Routes for getting bookings
router.get("/bookings/my-bookings", BookingController.getMyBookings);
router.get("/me/bookings", BookingController.getMyBookings);
router.patch(
  "/bookings/:id",
  validate(updateBookingSchema),
  BookingController.updateBooking
);

module.exports = router;
