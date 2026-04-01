import { stripe } from "@/lib/stripe";
import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as { metadata: { userId: string }; customer: string };
    await db
      .update(user)
      .set({ stripePlan: "pro", stripeCustomerId: session.customer })
      .where(eq(user.id, session.metadata.userId));
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as { customer: string };
    await db
      .update(user)
      .set({ stripePlan: "free" })
      .where(eq(user.stripeCustomerId, sub.customer));
  }

  return new Response("ok");
}
