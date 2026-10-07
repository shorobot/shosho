# QUEUED — customer accounts (OTP login), personal cabinet, and push to the customer base

Filed by S0 2026-10-06 on the owner's request. **Not started.** The owner described the feature and said
to queue it if now is not the moment. It is not, for reasons under "Why not now"; this file is the queue
entry and the dependency order.

**The decisions are now settled — see D-016**, answered by the owner the same day: accounts optional, OTP by
**both SMS and email**, **MessageBird** as the SMS provider, **bonuses deferred**, and **push as the primary
channel with an in-app bell**. Two of the owner's answers changed the plan below and the file has been
revised accordingly — findings 3 and 7 carry what changed.

**Why this is one file and not six boots.** A boot written weeks before it runs goes stale and misleads —
S0 spent 2026-10-06 refreshing S4-03 and S6-01 for exactly that reason (S6-01 pointed at seed logins a
later session had deleted). So each phase below is scoped here and issued as a full boot when it is
actually next, measured against the code at that moment. The scoping is the durable part; file:line
detail is not.

## What the owner asked for, in their own terms
Registration must be minimal: enter a phone number **or** an email, the system sends an access code, you
type it on the next screen — done. Name and address are offered afterwards and may be left until the
first order. At checkout, if the address is new, offer to save it. The personal cabinet holds bonuses and
lets the customer edit their own data. Then: push notifications across the customer base.

## Three findings that change how this gets built
S0 measured these against the code before filing; each one changes a decision, not just a detail.

1. **It contradicts a documented product rule, so the owner has to retire that rule deliberately.**
   `docs/design/README.md` line 48 is one of the twelve product rules S6 verifies literally: *"Guest
   checkout, no account. Customer profile is created automatically from the first order (matched by
   phone)."* Line 26 repeats "guest checkout, no account" in the checkout spec. Nothing about this is an
   obstacle — it is the owner's product — but it must be changed in the design and in the rule list, or
   S6 will correctly report the new feature as a violation. **Assumption until the owner says otherwise:
   accounts are *optional* and guest checkout survives unchanged**, which is what their description
   implies ("name and address can be added later").
2. **Push does not need accounts, and accounts are not what is blocking push.** The owner sequenced it
   "login first, then push". The schema disagrees: `customers.consent_push` and the `push_opened`
   customer-event type have existed since S2-01, the Kampagne wizard is designed, and S2-06 is building
   `campaigns` / `campaign_recipients` / `resolve_segment` right now. What is missing is **transport** —
   S0 grepped the whole repo: there is **no `push_subscriptions` table, no VAPID key handling, no service
   worker, nothing**. Campaigns will be able to record intent and have nowhere to send it. So push can
   ship without login; accounts make the subscription↔customer link reliable across devices and
   re-identifiable later, which is worth a lot, but it is a quality argument, not a dependency.
3. **On iPhone, web push only works if the customer adds the site to their home screen — and the owner's
   answer resolves this rather than being blocked by it.** iOS Safari delivers web push only to a PWA the
   user has installed; a normal visit cannot receive it. S0 raised this to argue for email-first. **The
   owner's answer removes the argument: native Android and iOS apps are planned, and will carry direct
   push and banners.** Native push has no such limitation, so the reach problem belongs to the web
   interim, not to the product. Two consequences, both now in D-016:
   - **Web push stays worth building for Android and desktop web**, with honest reach copy on the
     Kampagne screen so staff are not told a campaign reached people it could not.
   - **The push token store must be channel-agnostic from its first migration** — one interface holding a
     web-push subscription, an FCM token or an APNs token, with the channel as a column. The native apps
     are coming, so designing this web-push-only and retrofitting later is the expensive order. This is
     the single most important thing to get right early and costs almost nothing to get right now.

## Two more things that must be decided, not discovered later
4. **Phone OTP costs money per message and is an abuse target; email OTP is free.** Supabase Auth does
   both. Phone OTP needs an SMS provider (Twilio or similar) — a new vendor, a per-message cost, and a
   German regulatory surface. Worse, **SMS pumping** is a real attack: a script triggers thousands of
   codes to premium-rate numbers and the bill is the owner's. **There is currently no rate limiting
   anywhere in SHOSHO** — an open S7-01 finding. So phone OTP must not ship before rate limiting does;
   email-only OTP can ship earlier and carries no per-message cost. This is an owner decision because it
   is their money.
5. **A recycled phone number must not inherit the previous owner's record — and this is a safety issue,
   not only privacy.** Customers are keyed by `phone text not null unique`, created automatically by
   `place_order`. If a new person registers with a number that previously belonged to another customer,
   naive "link the account to the customer row with this phone" hands them that stranger's order history,
   saved addresses, and **`kitchen_note` — which is the allergy text copied onto every order card**. An
   inherited allergy note is a food-safety defect, not a data-protection footnote. The linking rule has to
   be explicit, and S0's proposal is: link on first login **only** when the account's verified identifier
   matches the customer row's identifier *and* the row has no other account attached; otherwise start a
   fresh customer row and let staff merge deliberately from the back-office, with the merge audited in
   `customer_events`. Never merge on a phone match alone.
6. **Bonuses do not exist anywhere.** Zero hits for bonus / loyalty / points / reward across the schema,
   and nothing in the design canvas. The owner named them as a cabinet feature, so they need a product
   design first — what earns them, what one is worth, whether they expire, whether they are a discount or
   a voucher (which in Germany has its own accounting and expiry rules), and how they interact with the
   existing `promo_codes`. **Recommendation: cut bonuses from the first release** and ship login + cabinet
   + address saving, which is the part the owner described as wanting to be fast and simple. Bonuses then
   get their own design pass with the owner instead of being invented by a session.

7. **The "bell with new messages" is not push, and conflating the two would be the costliest mistake here.**
   The owner asked for a bell icon showing new messages. That is an **in-app notification centre**: rows in
   the database, an unread count, and realtime — which SHOSHO already uses for the operator board. It needs
   **no** permission prompt, **no** service worker, **no** VAPID keys and **no** PWA install, and it behaves
   identically on iPhone Safari, Android and desktop. So it is the *reliable* surface, and push is the nudge
   that brings someone back to it. Practically this means the bell can ship **before** any push transport
   exists and delivers most of what the owner described on its own; it also gives every later channel —
   web push, FCM, APNs — one place to point at, instead of each channel inventing its own message history.
   It therefore gets its own phase (G below), ahead of push transport, and the first release of messaging
   should be the bell alone.

## Why not now
- **S4-03 is live in `apps/backoffice` in exactly this domain** — the Kunden list, Profil, consents and the
  `customer_events` timeline. Customer accounts change what a customer row *means*.
- **S2-06 is live in `apps/backend`** building campaigns, segments and the consent-driven recipient model —
  the push half of this request.
- A third session in the customer domain at the same time is precisely what D-003 exists to prevent, and
  the contract would be edited from three directions at once.
- The owner's own three open actions still gate more valuable ground than a new feature: the staging
  password rotation (the only thing between a working back-office URL and real staff), and the two Stripe
  secrets — **no live payment has ever run**, so the entire money path is still unexercised.

## Dependency order
```
D-016 ✅ settled 2026-10-06
      │
      ├── C. S7-03 rate limiting + auth audit ─┐   ← BLOCKING for SMS OTP, start it first
      │                                         │
      ├── A. S2-07 backend auth foundation ─────┴── B. S3-04 login + cabinet UI
      │
      └── G. S2-09 bell / notification centre ──── H. S3-06 bell UI
                    │
                    └── D. S2-08 push transport (channel-agnostic) ── E. S3-05 PWA + web push
                                    │
                                    └── F. S5-01 sender (consumes S2-06's claim fn)
```
**C moved to the front and is now blocking, not parallel** — the owner chose SMS OTP, and SMS without rate
limiting is an open financial exposure (finding 4), so the throttle must exist before the SMS channel does.
Email OTP has no such constraint and can ship in A ahead of the SMS half if the owner wants login sooner.

**G/H (the bell) is independent of everything else and is the cheapest real delivery** — it needs no
accounts to *build*, though it needs them to be *useful*, since a message has to belong to someone. Run it
after A, before D.

F already exists in the queue as "S5-01 automation" and is the only one of these that was already planned.

## Phase scoping

### A. S2-07 (Backend) — the account foundation
**Good news, measured rather than assumed — and this corrects S0's own first draft of this file.** The
draft warned that RLS assumes "an `auth.users` row means staff" and would break the moment a customer had
one. **That is wrong, and the opposite is true.** S0 checked before anyone acted on it:
- `auth_role()` is `select role from public.staff where id = auth.uid() and active` — a *lookup*, not an
  assumption. A customer with an `auth.users` row gets `null`, and `is_staff()` coalesces that to `false`.
- Every `to authenticated` policy across the migrations carries an explicit `is_staff(...)` predicate. The
  only one that does not is `staff_self_read`, which is `id = auth.uid()` — correct, since a customer's uid
  is not in `staff`.
- The two functions granted `to authenticated` without an inline predicate — `set_order_status` and
  `add_customer_event` — **both guard internally and raise**: `not_staff` / `forbidden_for_role`, errcode
  `42501`.

So the backend is already safe by construction against a second class of authenticated user. S2 and S7
built it defensively, and this phase's job is to **preserve that property, not to repair it**. That makes A
smaller and lower-risk than first scoped — but it is still one boot on its own, because the property is
easy to lose by accident and nothing currently tests it with a non-staff JWT.

Scope: `customers.auth_user_id` nullable unique; OTP via Supabase (channel per D-016); the linking rule from
finding 5, implemented and tested with the recycled-number case; `get_my_profile` / `get_my_orders` /
`update_my_profile` / address CRUD scoped to the caller; RLS so a customer reads only their own rows and
**cannot** read anyone else's `kitchen_note`. **The regression test that matters most:** a real customer JWT
must be refused by every staff surface and every report — assert it, because today that holds only as a
side effect of no customer ever having had a JWT.

### B. S3-04 (Frontend) — login, cabinet, address saving
Two-screen OTP flow (identifier → code), resend with a visible cooldown, the "offer name and address
afterwards" flow, the personal cabinet (own data, addresses, order history from `get_my_orders`), and the
checkout prompt to save a new address. Guest checkout must remain a first-class path, not a degraded one.
Favourites move from `localStorage` to per-customer — already anticipated in
`proposed/S3-03-banners-i18n-pwa.md`, so reconcile with that file rather than duplicating it.

### C. S7-03 (Security) — audit the new auth surface
OTP abuse (SMS pumping, code brute-force, resend flooding), account enumeration (the response must not
reveal whether an identifier is known), session and token handling for a public-facing authenticated user,
the self-service RLS from A, and the recycled-number linking rule. **Rate limiting is already an open
S7-01 finding with no owner; it becomes blocking here** and should be settled in this phase at the latest.
Concrete starting point rather than a general audit: S7's own `security_audit_policies` /
`security_audit_table_grants` / `security_audit_function_grants` helpers already exist — re-run the matrix
with a **customer** JWT as a new column, which is the row nobody has ever tested. Per A, the expectation is
that everything refuses; a single pass that *confirms* it is a cheap, high-value result.

### D. S2-08 (Backend) — push transport
`push_subscriptions` (endpoint, keys, user agent, customer_id nullable, created/last_seen), VAPID key
handling as a secret, subscription lifecycle including the dead-endpoint cleanup that web push demands,
and the tie from a subscription to a customer. Consent stays in `customers.consent_push`; a subscription
is not consent.

### E. S3-05 (Frontend) — PWA, service worker, permission UX
Manifest, service worker, the install prompt, and a permission request that is asked at a moment the
customer understands rather than on first load. **Must state the iOS limitation in the UI copy** so nobody
is promised notifications their phone will not deliver. Overlaps `proposed/S3-03-banners-i18n-pwa.md` —
merge, do not duplicate.

### F. S5-01 (Automation) — the sender
Consumes S2-06's `claim_campaign_recipients`, sends push and email, writes delivery state back to
`campaign_recipients`, honours the weekly cap and consent. Re-adds an `api` service under D-013, sized from
measurement, and asks TETA+PI for headroom only if the numbers require it.

## Phases added by the owner's answers

### G. S2-09 (Backend) — the bell: in-app notification centre
`customer_notifications` (customer_id, type, title_de/en, body_de/en, deep_link, created_at, read_at,
campaign_id nullable) with RLS so a customer reads and marks read **only their own**, an unread-count that
does not require pulling every row, and realtime on the customer's own channel — the token-scoped pattern
from guest order tracking is the template, and it is already proven. Campaigns write here as well as to any
push channel, so a message exists whether or not a device ever receives a notification. **This is where the
owner's "bell with new messages" actually comes from.**

### H. S3-06 (Frontend) — the bell UI
Bell with unread badge in the header, the message list, mark-as-read, deep-links into orders or the menu,
and an empty state. Works with no permissions granted and on every platform — build and ship this before
asking anyone for notification permission, so the permission request in E has something to point at.

## Still assumed, not answered — confirm before A is issued
Everything else in D-016 is settled. One clause is S0's inference rather than the owner's words: that
**accounts are optional and guest checkout continues unchanged**. Their description implies it ("name and
address can be added later"), and it is the only reading consistent with not losing walk-up orders — but it
retires a documented product rule, so it should be confirmed out loud rather than inferred. If guest
checkout were instead meant to *end*, B and the design update both change shape considerably.

## Not in these phases
- **Bonuses** — deferred by D-016, own design pass with the owner.
- **The native Android and iOS apps** — a separate project. They are named here only because they change
  two things in scope: the push token store must be channel-agnostic from the start (finding 3), and the
  bell's message rows become the shared history every channel points at (finding 7).
