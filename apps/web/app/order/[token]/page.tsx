import type { Metadata } from "next";
import { TrackingClient } from "@/components/order/TrackingClient";

export const metadata: Metadata = { title: "Your order", robots: "noindex" };

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TrackingClient token={token} />;
}
