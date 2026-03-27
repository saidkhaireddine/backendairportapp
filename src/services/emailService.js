const { Resend } = require("resend");

// Use Resend API for reliable email delivery on cloud platforms
// Set env: RESEND_API_KEY and FROM_EMAIL
console.log("📧 Email service: Using Resend API");
console.log("📧 RESEND_API_KEY configured:", !!process.env.RESEND_API_KEY);

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

async function sendEmail({ to, subject, text, html }) {
  if (!resend) {
    throw new Error("RESEND_API_KEY must be configured");
  }

  const from = process.env.FROM_EMAIL || "onboarding@resend.dev";

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    text,
    html,
  });

  if (error) {
    throw new Error(error.message);
  }

  console.log("Email sent via Resend:", data?.id);
  return data;
}

module.exports = { sendEmail };
