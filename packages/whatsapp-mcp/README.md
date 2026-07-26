# @pappcorn/whatsapp-mcp

An MCP server for WhatsApp. Lets Claude send messages and approved templates
from your own business number, through Meta's official **WhatsApp Cloud API**.

Meta directly — no reseller. Meta charges nothing for inbound messages or for
free-form replies inside the 24-hour window; resellers charge for both.

## Setup

1. **[Create your Meta app and get a permanent token](../../docs/setup-meta-whatsapp.md)** —
   Meta provisions a free test number, so you can start without buying a line.
2. **[Install it into Claude](../../docs/install.md)**.

```bash
npx -y -p @pappcorn/whatsapp-mcp pappcorn-whatsapp whoami
```

(From a clone: `npm run whatsapp -- whoami`.)

## The 24-hour window — read this first

It shapes what this connector can do.

- When someone messages your number, a **24-hour window** opens. Inside it,
  unlimited free-form text, **free**. Every message from them resets it.
- **Outside it, only pre-approved templates.** Free-form is rejected with error
  `131047`.
- This server has **no inbound receiver, so it cannot know whether the window is
  open**. It sends and reads the error — deliberately. The error text names the
  next step.

First-day move: have the person message you first, then reply freely for 24h.

## Tools

| Tool                      | What it does                                                                   |
| ------------------------- | ------------------------------------------------------------------------------ |
| `whatsapp_whoami`         | Your number, verified name, and **quality rating**                             |
| `whatsapp_list_templates` | Approved templates, their languages and how many `{{n}}` parameters each takes |
| `whatsapp_send_template`  | Send a pre-approved template — works cold, outside the window                  |
| `whatsapp_send_message`   | Free-form text — only inside an open 24-hour window                            |

Watch the quality rating. When it falls, Meta throttles and eventually bans the
number.

## Why send and send_template are separate tools

Their failure modes and their **consent semantics** differ. A single unified
`send` would tempt the model to quietly fall back to a template when free-form
is rejected — which spends money and burns the number's reputation without you
knowing. Keeping them apart forces the choice to be explicit.

## Security

- **No hardcoded number, account or tenant.** Everything comes from
  configuration; every send takes an optional `from_phone_number_id` override.
- **The token is never printed** by any tool or error path.
- **Official Cloud API only.** This does not drive the WhatsApp Web protocol the
  way `whatsmeow`/Baileys-based tools do — those risk getting the account
  banned.
- **Sends are outward-facing** and cost money; the tool descriptions say so, so
  Claude confirms recipient and content before sending.

Errors are mapped to actionable text rather than passed through raw: `131047`
tells you the window is closed and to use a template, `190` tells you the token
is the temporary one, `131030` tells you the recipient isn't allowlisted.

## Configuration

| Variable                     | Purpose                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| `WHATSAPP_ACCESS_TOKEN`      | System User permanent token (three permissions — see the setup guide) |
| `WHATSAPP_PHONE_NUMBER_ID`   | Numeric ID from WhatsApp → API Setup. **Not** the phone number        |
| `WHATSAPP_WABA_ID`           | Business account ID; needed only to list templates                    |
| `WHATSAPP_GRAPH_API_VERSION` | Defaults to `v25.0`                                                   |

## Not in v1

**Outbound only.** Nobody can message your assistant and get a reply — that
needs a public HTTPS endpoint to receive Meta's webhooks, which is an always-on
service rather than a local MCP server. No media sending. And no message
history: the Cloud API has no endpoint to read past messages at all.
