import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

/**
 * Configuration de production Firebase v10 SDK pour CSW-ARCADE
 */
const firebaseConfig = {
  apiKey: "AIzaSyBcXrh08RjPuDc6P8CQ6LqrvG5WNo-jzt0",
  authDomain: "csw-arcade.firebaseapp.com",
  projectId: "csw-arcade",
  storageBucket: "csw-arcade.firebasestorage.app",
  messagingSenderId: "948445590109",
  appId: "1:948445590109:web:0f2cec84e7c7d9b00053b4"
};

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
