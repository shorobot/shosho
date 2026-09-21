import type { Metadata } from "next";
import { CheckoutClient } from "@/components/checkout/CheckoutClient";

export const metadata: Metadata = { title: "Checkout", robots: "noindex" };

export default function CheckoutPage() {
  return <CheckoutClient />;
}
