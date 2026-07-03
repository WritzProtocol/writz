import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Writz",
    short_name: "Writz",
    description:
      "Trustless, ZK-private Bitcoin lending on Stellar (Soroban testnet).",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0908",
    theme_color: "#0a0908",
  };
}
