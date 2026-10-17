import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.description,
    id: "/",
    start_url: "/",
    scope: "/",
    lang: "en",
    display: "standalone",
    background_color: BRAND.colors.background,
    theme_color: BRAND.colors.accent,
    // /apple-icon/512 is full bleed with the mark in the safe zone, which is what a maskable icon needs.
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
