import { auth } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { headers } from "next/headers";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
    customer_email: session.user.email,
    metadata: { userId: session.user.id },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/meetings?upgraded=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/upgrade`,
  });

  return Response.json({ url: checkoutSession.url });
}
