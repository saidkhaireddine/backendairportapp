const axios = require("axios");
const User = require("../models/User");
const { generateTokens } = require("../utils/jwt");
const { isProfileComplete } = require("./googleAuthService");

/**
 * Verifies Facebook access token via Facebook Graph API
 * @param {string} accessToken - Facebook access token from client
 * @returns {Promise<object>} Facebook user info (id, name, email, first_name, last_name, picture)
 */
async function verifyFacebookToken(accessToken) {
  const graphUrl = `https://graph.facebook.com/me?fields=id,email,first_name,last_name,picture.type(large)&access_token=${accessToken}`;
  const { data } = await axios.get(graphUrl);
  if (!data || !data.id) {
    throw new Error("Invalid Facebook token");
  }
  return data;
}

/**
 * Login or register user with Facebook
 * @param {string} accessToken - Facebook access token from client
 * @returns {Promise<object>} user, tokens, and profile_complete flag
 */
async function loginOrRegisterWithFacebook(accessToken) {
  const fbUser = await verifyFacebookToken(accessToken);

  // 1. Try to find by facebook_id first
  let user = await User.findOne({ facebook_id: fbUser.id, deleted_at: null });

  // 2. If not found and email available, try by email (account linking)
  if (!user && fbUser.email) {
    user = await User.findOne({ email: fbUser.email.toLowerCase(), deleted_at: null });
    if (user) {
      // Link the Facebook ID to existing account
      user.facebook_id = fbUser.id;
      if (!user.avatar_url && fbUser.picture?.data?.url) {
        user.avatar_url = fbUser.picture.data.url;
      }
      user.profile_complete = isProfileComplete(user);
      await user.save();
    }
  }

  // 3. If still not found, create new user
  if (!user) {
    user = await User.create({
      email: fbUser.email ? fbUser.email.toLowerCase() : `fb_${fbUser.id}@facebook.placeholder`,
      first_name: fbUser.first_name || "",
      last_name: fbUser.last_name || "",
      avatar_url: fbUser.picture?.data?.url || null,
      facebook_id: fbUser.id,
      auth_provider: "facebook",
      role: "both",
      email_verified: !!fbUser.email,
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

module.exports = { verifyFacebookToken, loginOrRegisterWithFacebook };
