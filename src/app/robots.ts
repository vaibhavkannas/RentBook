import type { MetadataRoute } from "next";

// RentBook is private: no crawler has any business in it.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
