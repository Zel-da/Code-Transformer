export function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    const base = import.meta.env.BASE_URL ?? "/";
    const swUrl = `${base}sw.js`.replace(/\/\//g, "/");
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register(swUrl, { scope: base })
        .then((reg) => console.log("[SW] registered:", reg.scope))
        .catch((err) => console.warn("[SW] registration failed:", err));
    });
  }
}
