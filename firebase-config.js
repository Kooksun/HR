/**
 * Firebase runtime configuration for Horse Racing Arena.
 * Populate each field with the Web App config values from the Firebase console.
 */
window.__FIREBASE_CONFIG__ = {
  /**
   * Web API Key (General > Your apps > SDK setup and configuration).
   * Example: "AIzaSyA...".
   */
  apiKey: "AIzaSyDioYtc2VVN5erDiv_Tp-VdG4Zg1P9fm3k",

  /**
   * Authentication domain, typically "<project-id>.firebaseapp.com".
   */
  authDomain: "kooksun-hr.firebaseapp.com",

  /**
   * Realtime Database URL. Keep the trailing slash.
   */
  databaseURL: "https://kooksun-hr-default-rtdb.firebaseio.com/",

  /**
   * Firebase project ID (lowercase).
   */
  projectId: "kooksun-hr",

  /**
   * Default storage bucket (General settings).
   * Example: "<project-id>.appspot.com".
   */
  storageBucket: "kooksun-hr.firebasestorage.app",

  /**
   * Sender ID from the Web App config.
   */
  messagingSenderId: "403254476989",

  /**
   * App ID (starts with "1:...").
   */
  appId: "1:403254476989:web:c05fb023e550516037b7d4",
};

/**
 * Shared secret the host uses to prove ownership of the session.
 * For local development you can reuse SESSION_SECRET from .env.local.
 */
window.__SESSION_SECRET__ = "dev-session-secret";
