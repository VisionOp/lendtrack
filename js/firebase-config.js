// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB6DHR-Ir4DF_6Fpj9LRX2J8QLRZZg64dc",
  authDomain: "lendtrack-45bb2.firebaseapp.com",
  projectId: "lendtrack-45bb2",
  storageBucket: "lendtrack-45bb2.firebasestorage.app",
  messagingSenderId: "707195622890",
  appId: "1:707195622890:web:13bde659f555b783298e93",
  measurementId: "G-TGQ51N32KG"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db  = firebase.firestore();