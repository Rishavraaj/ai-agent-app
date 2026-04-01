import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type ActionItem = { task: string; assignee?: string | null; dueDate?: string | null };

export async function sendMeetingSummaryEmail({
  to,
  name,
  title,
  summary,
  actionItems,
}: {
  to: string;
  name: string;
  title: string;
  summary: string;
  actionItems: ActionItem[];
}) {
  const itemsHtml = actionItems
    .map(
      (a) =>
        `<li><strong>${a.task}</strong>${a.assignee ? ` — ${a.assignee}` : ""}${a.dueDate ? ` (${a.dueDate})` : ""}</li>`
    )
    .join("");

  await resend.emails.send({
    from: "MeetingAI <noreply@yourdomain.com>",
    to,
    subject: `Meeting Notes: ${title}`,
    html: `
      <h2>Hi ${name},</h2>
      <h3>📋 ${title}</h3>
      <h4>Summary</h4>
      <p>${summary}</p>
      ${actionItems.length ? `<h4>Action Items</h4><ul>${itemsHtml}</ul>` : ""}
      <p style="color:#888;font-size:12px">Powered by MeetingAI</p>
    `,
  });
}
