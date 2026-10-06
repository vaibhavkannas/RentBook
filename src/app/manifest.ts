import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RentBook",
    short_name: "RentBook",
    description: "Record monthly rent receipts into your Google Sheet.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f1",
    theme_color: "#1f5f4a",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
