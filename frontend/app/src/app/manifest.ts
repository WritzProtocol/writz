import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Writz Protocol",
    short_name: "Writz",
    description:
      "Borrow dollars against native BTC, without a custodian holding it and without anyone seeing the amount.",
    start_url: "/",
    display: "standalone",
    background_color: "#F6F7F8",
    theme_color: "#001D3D",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
