const admin = require("firebase-admin");

// Initialize Firebase Admin SDK. Prefer providing credentials via
// GOOGLE_APPLICATION_CREDENTIALS env var (path to service account JSON) or
// FIREBASE_SERVICE_ACCOUNT_JSON (stringified JSON) for containers.
function initFirebaseAdmin() {
  if (admin.apps && admin.apps.length) return admin.app();

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // SDK will pick up GOOGLE_APPLICATION_CREDENTIALS if set
    admin.initializeApp();
  }

  return admin.app();
}

module.exports = initFirebaseAdmin();
