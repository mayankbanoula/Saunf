import type { MetadataRoute } from "next";

// Lets people add Saunf to their home screen, which iPhones require for push notifications.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Saunf",
    short_name: "Saunf",
    description: "Your team's private task workspace.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#002f70",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
