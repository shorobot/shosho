import type { Metadata } from "next";
import { OrderLookup } from "@/components/order/OrderLookup";

export const metadata: Metadata = { title: "Track your order", robots: "noindex" };

export default function OrderIndexPage() {
  return <OrderLookup />;
}
