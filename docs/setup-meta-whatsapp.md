# Connect your own WhatsApp number

This gets your assistant sending WhatsApp messages through Meta's official
**WhatsApp Cloud API**, from a number you control.

Meta gives you a free test number, so you can be sending in under an hour
without buying a line or verifying a business.

> We use Meta's API directly — not Twilio or another reseller. Meta charges
> **$0 for inbound** and **$0 for free-form replies inside the 24-hour window**;
> resellers typically charge per message in both directions, which is pure markup
> on exactly the traffic Meta prices at zero.

---

## Before you start

- A Facebook account.
- **A phone number that does NOT already have WhatsApp on it** — or none at all,
  if you use Meta's free test number. To reuse a number that already has
  WhatsApp, you must first delete its WhatsApp account, which permanently loses
  its message history. Running the app and the API on one number
  ("coexistence") is only available through Meta partners, not to direct
  developers. **Use a fresh number.**

---

## Step 1 — Create the app

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps**
   → **Create App**.
2. Choose the use case for connecting with customers on **WhatsApp**.
3. Create or select a **business portfolio** when prompted — the platform
   requires one.
4. In the app, open **WhatsApp → API Setup**. Meta automatically provisions a
   free test number and a test WhatsApp Business Account.

From that screen, note two values:

- **Phone number ID** — a long number. This is *not* the phone number itself,
  and mixing them up is the most common early mistake.
- **WhatsApp Business Account ID (WABA ID)** — needed to list templates.

## Step 2 — Add your test recipients

While the app is in development, you can only message numbers you explicitly
allow. On the same **API Setup** screen, add the numbers you want to message
under the recipient field. Each has to confirm via a code.

## Step 3 — ⚠️ Get a permanent token (three traps live here)

The token shown on the API Setup screen is **temporary**. It works today and is
dead tomorrow, surfacing as **error 190**. Every team hits this once. You need a
System User token instead.

**Trap 1 — the System User is on a different website.** It is *not* under
developers.facebook.com. Go to
[business.facebook.com/settings/system-users](https://business.facebook.com/settings/system-users).

1. **Add** → create a system user with the **Admin** role.

**Trap 2 — assign the assets BEFORE generating the token.** If you generate
first, the permissions screen comes up empty and says *"No permissions
available"*, with no explanation.

2. Select the system user → **Assign Assets**:
   - your **app**, with *Manage app* (Full control)
   - your **WhatsApp account (WABA)**, with *Manage WhatsApp Business accounts*
     (Full control)

3. Now **Generate token**, and select **all three** permissions:
   - `business_management`
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`

   **Trap 3** — most guides list only the last two. Without
   `business_management` the token appears fine and then fails on some calls.

4. Set expiration to **Never**. Copy the token — it is shown once.

## Step 4 — Verify

```bash
cd packages/whatsapp-mcp
WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... npm run whatsapp -- whoami
```

You should see your number, its verified name, and a **quality rating**. Watch
that rating over time: when it drops, Meta throttles and eventually bans the
number.

Then [install it into Claude](install.md).

---

## The 24-hour window — read this before you expect too much

This is the rule that shapes everything WhatsApp.

- When someone messages your number, a **24-hour customer service window**
  opens. Inside it you can send unlimited free-form text, **free**. Every new
  message from them resets the 24 hours.
- **Outside that window, only pre-approved templates can be sent.** Free-form
  text is rejected with error `131047`.
- This connector has no inbound receiver, so **it cannot know whether the window
  is open**. It sends, and reads the error. That is by design — the error text
  tells you what to do next.

**The practical first-day move:** have the person message you first. That opens
the window, and inside it everything is free-form and free — no templates, no
approval, no waiting.

For genuinely proactive messages, create a template in Meta's Business Manager.
Review is automatic and usually under 24 hours.

## Costs

Free-form replies inside the window and all inbound messages cost **nothing**.
Templates are cheap — utility templates are fractions of a cent, and are free
when delivered inside an open window. Marketing templates cost more. Meta
publishes per-country rates; check yours before sending at volume.

## What you do NOT need to start

- **Business verification.** It is not required to send. It gates higher
  messaging limits, not the ability to message.
- **App Review.** Not required when you are the developer using the API for
  your own business.
- **A display-name review.** Triggered later, not an upfront gate.

## Messaging limits

Limits are set per **business portfolio**, not per phone number. New portfolios
start at 250 unique recipients per rolling 24 hours (outside customer service
windows), and scale up as quality stays high and you use your allowance.

---

## What v1 does not do

- **Outbound only.** Nobody can message your assistant and get a reply. That
  requires a public HTTPS endpoint to receive Meta's webhooks — a separate
  always-on service, not something a laptop can do.
- **No media.** Text and templates only.
- **No message history.** The Cloud API has no endpoint to read past messages,
  so there is nothing to expose.
