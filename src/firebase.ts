import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID
};

// Diagnostic logging (Safe for production as it only shows prefixes)
if (firebaseConfig.apiKey) {
  console.log(`[Firebase Config Check] Using API Key starting with: ${firebaseConfig.apiKey.substring(0, 8)}...`);
  
  if (firebaseConfig.apiKey.startsWith('AIzaSyCm')) {
    console.error("CRITICAL: Gemini Key detected in Firebase field! Use the key starting with AIzaSyC1 instead.");
  }
} else {
  console.warn("[Firebase Config Check] No API Key found in environment variables.");
}

let app;
try {
  // Only initialize if we have the minimum required config
  if (!firebaseConfig.apiKey) {
    throw new Error("Missing VITE_FIREBASE_API_KEY");
  }
  app = initializeApp(firebaseConfig);
} catch (error) {
  console.error("Firebase initialization error:", error);
  // Fallback with dummy config to prevent total crash, but auth will fail gracefully
  app = initializeApp({ apiKey: "missing-key", projectId: "missing-id", appId: "missing-app-id" });
}

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || "(default)");
export const auth = getAuth(app);
export const storage = getStorage(app);
