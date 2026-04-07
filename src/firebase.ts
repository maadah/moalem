import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// Helper to clean and validate environment variables
const getEnv = (key: string, fallback: string) => {
  const value = import.meta.env[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
};

const firebaseConfig = {
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID', "n8nhostinger-478419"),
  appId: getEnv('VITE_FIREBASE_APP_ID', "1:146801984988:web:91ed23d802ad37252ffb19"),
  apiKey: getEnv('VITE_FIREBASE_API_KEY', "AIzaSyC1w2EZdjvTtOo8-RZGE5UoZCcJyn08KtY"),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN', "n8nhostinger-478419.firebaseapp.com"),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET', "n8nhostinger-478419.firebasestorage.app"),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', "146801984988"),
  firestoreDatabaseId: getEnv('VITE_FIREBASE_DATABASE_ID', "ai-studio-82f79215-9e3a-468e-971e-079777ac98c8")
};

// Diagnostic logging (Safe for production as it only shows prefixes)
console.log(`[Firebase Config Check] Using API Key starting with: ${firebaseConfig.apiKey.substring(0, 8)}...`);

if (firebaseConfig.apiKey.startsWith('AIzaSyCm')) {
  console.error("CRITICAL: Gemini Key detected in Firebase field! Use the key starting with AIzaSyC1 instead.");
}

let app;
try {
  app = initializeApp(firebaseConfig);
} catch (error) {
  console.error("Firebase initialization error:", error);
  app = initializeApp({ apiKey: "invalid" });
}

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || "(default)");
export const auth = getAuth(app);
export const storage = getStorage(app);
