import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "n8nhostinger-478419",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:146801984988:web:91ed23d802ad37252ffb19",
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyC1w2EZdjvTtOo8-RZGE5UoZCcJyn08KtY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "n8nhostinger-478419.firebaseapp.com",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "n8nhostinger-478419.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "146801984988",
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || "ai-studio-82f79215-9e3a-468e-971e-079777ac98c8"
};

// Debugging helper to detect swapped keys
if (firebaseConfig.apiKey.startsWith('AIzaSyCm')) {
  console.error("CRITICAL: It looks like you put your Gemini API Key in the VITE_FIREBASE_API_KEY field. Please use the Firebase API Key (starting with AIzaSyC1) instead.");
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
