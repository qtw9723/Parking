// supabase/functions/mailer/smtp.ts
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts"

interface SendOptions {
  sender: "gmail" | "ms"
  to: string
  subject: string
  body: string
}

export async function sendMail(opts: SendOptions): Promise<void> {
  const isGmail = opts.sender === "gmail"
  const user = isGmail
    ? Deno.env.get("GMAIL_USER")!
    : Deno.env.get("MS_USER")!
  const password = isGmail
    ? Deno.env.get("GMAIL_APP_PASSWORD")!
    : Deno.env.get("MS_APP_PASSWORD")!
  const hostname = isGmail ? "smtp.gmail.com" : "smtp.office365.com"

  const port = isGmail ? 465 : 587
  const tls = isGmail ? true : false

  const client = new SMTPClient({
    connection: {
      hostname,
      port,
      tls,
      auth: { username: user, password },
    },
  })

  try {
    await client.send({
      from: user,
      to: opts.to,
      subject: opts.subject,
      content: opts.body,
    })
  } finally {
    await client.close()
  }
}
