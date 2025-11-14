import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Capacitor } from '@capacitor/core';

// Add an Android-only class when running inside the Capacitor Android app.
// This ensures the CSS adjustments below only apply for native Android,
// and do not affect the web build.
try {
  if (Capacitor?.getPlatform && Capacitor.getPlatform() === 'android') {
    // add class to both html and body to make selectors straightforward
    document.documentElement.classList.add('android-native');
    document.body.classList.add('android-native');
  }
} catch (e) {
  // ignore any errors when Capacitor isn't available in the current runtime
}

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for offline caching
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // no-op
    });
  });
}
