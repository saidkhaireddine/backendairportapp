const axios = require("axios");
const User = require("../models/User");
const { generateTokens } = require("../utils/jwt");

/**
 * Verifies Google ID token via Google's tokeninfo endpoint
 * @param {string} idToken
 * @returns {Promise<object>} Google user info (sub, email, given_name, family_name, picture, email_verified)
 */
async function verifyGoogleIdToken(idToken) {
  const googleApiUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`;
  const { data } = await axios.get(googleApiUrl);
  if (!data || data.email_verified === "false" || !data.email) {
    throw new Error("Invalid or unverified Google token");
  }
  return data;
}

/**
 * Check if a user's profile is complete (has phone + ID images)
 */
function isProfileComplete(user) {
  return !!(user.phone && user.id_image_front_url && user.id_image_back_url);
}

/**
 * Login or register user with Google
 * @param {string} idToken - Google ID token from client
 * @returns {Promise<object>} user, tokens, and profile_complete flag
 */
async function loginOrRegisterWithGoogle(idToken) {
  const googleUser = await verifyGoogleIdToken(idToken);

  // 1. Try to find by google_id first
  let user = await User.findOne({ deleted_at: null });

  // 2. If not found, try by email (account linking)
  if (!user) {
    user = await User.findOne({ email: googleUser.email.toLowerCase(), deleted_at: null });
    if (user) {
      // Link the Google ID to existing account
      if (!user.avatar_url && googleUser.picture) {
        user.avatar_url = googleUser.picture;
      }
      user.email_verified = true;
      user.profile_complete = isProfileComplete(user);
      await user.save();
    }
  }

  // 3. If still not found, create new user
  if (!user) {
    user = await User.create({
      email: googleUser.email.toLowerCase(),
      first_name: googleUser.given_name || "",
      last_name: googleUser.family_name || "",
      avatar_url: googleUser.picture || null,
      auth_provider: "google",
      role: "both",
      email_verified: true,
      phone_verified: false,
      profile_complete: false,
    });
  }

  const tokens = generateTokens(user._id.toString());
  const safeUser = user.toJSON();
  return {
    user: safeUser,
    profile_complete: isProfileComplete(user),
    ...tokens,
  };
}

module.exports = { verifyGoogleIdToken, loginOrRegisterWithGoogle, isProfileComplete };
