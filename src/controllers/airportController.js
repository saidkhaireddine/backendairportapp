const Airport = require("../models/Airport");

class AirportController {
  /**
   * Get all airports (with search and geo-location)
   * GET /api/v1/airports
   */
  static async getAll(req, res, next) {
    try {
      const { country, q, latitude, longitude, radius = 200000 } = req.query; // Default radius 200km

      const parsedLatitude = latitude !== undefined ? parseFloat(latitude) : null;
      const parsedLongitude = longitude !== undefined ? parseFloat(longitude) : null;
      const parsedRadius = Number.isFinite(parseInt(radius, 10))
        ? parseInt(radius, 10)
        : 200000;
      const isGeoSearch =
        Number.isFinite(parsedLatitude) && Number.isFinite(parsedLongitude);

      const filter = { is_active: true };

      // Text Search using MongoDB text index
      if (q) {
        filter.$text = { $search: q };
      }

      // Geospatial Search
      if (isGeoSearch) {
        filter.location = {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [parsedLongitude, parsedLatitude],
            },
            $maxDistance: parsedRadius,
          },
        };
      }

      if (country) {
        filter.country = country;
      }

      // Keep geospatial queries tight and cap broad list queries.
      const requestedLimit = Number.isFinite(parseInt(req.query.limit, 10))
        ? parseInt(req.query.limit, 10)
        : null;
      const defaultLimit = isGeoSearch ? 80 : q ? 100 : 2000;
      const maxLimit = isGeoSearch ? 150 : 2000;
      const limit = Math.min(requestedLimit || defaultLimit, maxLimit);

      // Also ensure airports have valid coordinates for map display
      // Skip this filter when doing geospatial search (already ensures valid location)
      if (!q && !country && !isGeoSearch) {
        filter.latitude = { $ne: null };
        filter.longitude = { $ne: null };
      }

      let query = Airport.find(filter).limit(limit).lean();

      // Add text score sorting if text search was used
      if (q) {
        query = query
          .select({
            name: 1,
            city: 1,
            country: 1,
            iata: 1,
            icao: 1,
            latitude: 1,
            longitude: 1,
            location: 1,
            timezone: 1,
            score: { $meta: "textScore" },
          })
          .sort({ score: { $meta: "textScore" } });
      } else {
        query = query.select(
          "name city country iata icao latitude longitude location timezone"
        );
        // Keep distance ordering from $near for geo search; only sort by name for broad lists.
        if (!isGeoSearch) {
          query = query.sort({ name: 1 });
        }
      }

      const airports = await query;

      res.status(200).json({
        success: true,
        data: airports,
        count: airports.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get airport by ID
   * GET /api/v1/airports/:id
   */
  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const airport = await Airport.findById(id);

      if (!airport) {
        return res.status(404).json({
          success: false,
          message: "Airport not found",
        });
      }

      res.status(200).json({
        success: true,
        data: airport,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AirportController;
