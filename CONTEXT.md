# POSTORY

The domain language of POSTORY — a SaaS where small brand agencies generate,
approve, schedule, and publish social content for their clients. This file is a
**glossary only**: what each term _is_, and which words to avoid so we don't
drift. Implementation lives in code and ADRs, never here.

## Language

### Tenancy

**Organization**:
An agency — the top-level tenant and billing entity. Owned by better-auth. One
organization can never see another's data.
_Avoid_: Account, tenant, workspace, team.

**Brand**:
A single client's workspace inside an organization. The tenancy unit below the
org — every piece of content, account, and approval hangs off exactly one brand.
Identified internally by an immutable `id`; its `slug` is a derived convenience,
not a user-facing handle.
_Avoid_: Client, workspace, account, project.

**Member**:
A person who belongs to an organization, with a role (`owner`, `admin`,
`approver`, `creator`). Members are internal to the agency.
_Avoid_: User (that's the better-auth auth record), seat, teammate.

**Client**:
The external brand stakeholder who approves posts and views reports via
tokenized portal links. A client is **never** a member and never has an
account — they exist only as a `client_contact_email` on a Brand and as portal
tokens.
_Avoid_: Customer, user, reviewer, stakeholder (loosely).

**Brand Assignment**:
The link that grants a Member access to a specific Brand. It only _gates_
Members whose role is `creator` — a creator sees exactly the Brands they are
assigned to, and nothing until an admin assigns them. Owner, admin, and approver
always see every Brand in the Organization regardless of assignments (an
assignment for them is stored but inert). Managed by owner/admin.
_Avoid_: brand role, brand permission, team membership, brand seat.

### Brand content & voice

**Voice Profile**:
A Brand's optional AI guidance — a free-text tone, banned words, preferred Brand
Hashtags, and sample posts — that seeds all AI copy and image generation for
that Brand. Stored per Brand; absent means "no guidance" (AI degrades
gracefully).
_Avoid_: brand voice settings, style guide, persona, tone (tone is one field of it).

**Brand Hashtags**:
A single flat list of a Brand's preferred hashtags, one field of its Voice
Profile; the composer and AI draw from it. Stored bare (no leading `#`).
_Avoid_: hashtag sets, tags, keywords.

### Posts & composing

**Post**:
A single piece of content authored for a Brand and routed through the lifecycle
(draft → review → approved → scheduled → published). It hangs off exactly one
Brand; its editable content lives in Post Versions, not on the Post row itself.
_Avoid_: message, content item, update, story.

**Post Version**:
An immutable snapshot of a Post's content — the selected target Platforms and a
per-Platform Caption. Each save appends a new version; approvals bind to a
specific version, so any edit after approval means a new version (and a trip
back to draft). Never mutated in place.
_Avoid_: revision, draft (a draft is a Post _status_, not a version), edit.

**Composer**:
The screen where a Member hand-writes (and later AI-generates) a Post: pick
target Platforms, write a Caption variant per Platform, attach media, schedule.
It saves drafts; it never publishes.
_Avoid_: editor, post builder, studio.

**Caption**:
The text body of a Post for one Platform — one **variant** per targeted
Platform, each validated against that Platform's character limit. Editing one
Platform's caption never changes another's.
_Avoid_: copy (copy is the AI-generation act), body, text, description.

**Media Asset**:
An image or video belonging to a Brand (`media_assets`), stored in the object
store (R2 in prod, MinIO in dev) under an `org/{orgId}/brand/{brandId}/…` key.
Has a **kind** (image/video) and a **source** — **upload** (C4: presigned
direct-to-store PUT, confirmed by a server HEAD, the authoritative mime/size
gate) or **generated** (D2: an AI image the Inngest job PUTs to the store and
records with its source model + Generation Job id). Attached to a Post **per
Platform** (`content.variants[platform].mediaIds`); the flat union lands in
`post_versions.media_ids`. Starts moderation `pending` (D5 gates it before
publish).
_Avoid_: attachment, file, upload (upload is the source, not the asset), image (a video is one too).

**Media Spec**:
A Platform's media rules (`platforms/config.ts`): accepted mime types + max size
(the hard, server-enforced gate) and accepted aspect ratios + max video duration
(advisory in the Composer, hard-gated at publish). Read via `getMediaSpec`;
`assetFitsPlatform` computes the advisory warnings.
_Avoid_: media rules, constraints, format (a format is one field of the spec).

**Preview Card**:
The Composer's feed-accurate rendering (C5) of the active Platform's Caption +
Media in that Platform's native chrome — a stacked feed card (Instagram /
Facebook / LinkedIn / Threads) or a full-bleed 9:16 frame (TikTok / YouTube
Shorts). It follows the active caption tab and is purely presentational (no
publishing, no persistence). Layout comes from `getPreviewChrome`; identity is
the Platform's connected-account handle/avatar, falling back to the Brand.
_Avoid_: mockup, thumbnail, live preview (nothing is live — it's illustrative).

### AI generation & credits

**AI Copy**:
The act of generating caption text with AI (C2): a Member writes a **brief**,
the model returns a batch of caption **variants** for the active Platform,
shaped by the Brand's Voice Profile. A **refine** reworks one variant with an
instruction. All generation runs in an Inngest job, never a request handler
(ADR-003); tokens stream to the Composer over Inngest realtime.
_Avoid_: caption (a caption is the stored text; "copy" is the generation act), completion, prompt (the prompt is an input to generation).

**AI Image**:
The act of generating an image with AI (D1–D3): a Member writes a **prompt**
(optionally seeded from the Caption) and picks a **tier** (standard / premium —
maps to the `image_standard` / `image_premium` credit rate) + an **aspect
preset** (1:1, 4:5, 9:16, 16:9); the OpenRouter Image API returns 2–4 variant
images. The Inngest job fans out one call per variant, stores each in the object
store, and records a generated Media Asset — a chosen variant attaches to the
Post through the same seam as an upload. Brand style (Voice Profile tone) seasons
the prompt. Moderation is deferred (D5).
_Avoid_: picture, graphic, render (the run is a Generation Job; the output is a Media Asset).

**Generation Job**:
One AI generation run (`generation_jobs` row) — type copy or image now (video is
D7). Moves queued → running → succeeded | failed. Records the model id, the
credits reserved, and the credits settled; the Credit Ledger stays the source of
truth for spend.
_Avoid_: task, request, generation (ambiguous — this is the tracked run).

**Credit / Credit Ledger**:
Credits are the AI-usage currency (integers; ~$0.015 retail each). The
**Credit Ledger** (`credit_ledger`) is append-only: every grant, debit, and
refund is a new row — corrections are compensating rows, never edits. Balance =
SUM(delta) per org. A generation **reserves** (debits) credits BEFORE the
OpenRouter call, then **settles** or **refunds** after (failed generations are
unbilled, so they refund in full). New trial orgs get a hardcoded grant (150).
_Avoid_: tokens, points, balance (balance is the derived SUM, not the ledger), quota.

### Publishing plumbing

**Zernio Profile**:
Invisible internal plumbing: a container in Zernio that groups a Brand's
connected Social Accounts — Zernio calls it "the tenant boundary", which is
exactly what a Brand is for us, so Brand ↔ profile is **1:1** (ADR-009, amended
after R1 resolved: Zernio profiles hold any number of accounts including
multiple of the same platform, so no overflow profiles). Provisioned **lazily** —
the single profile is created on first account placement, not at brand creation.
Users never see profiles.
_Avoid_: Channel, group, workspace.

**Social Account**:
A connected platform account (Instagram, Facebook, TikTok, LinkedIn, Threads,
YouTube) placed on one of a Brand's Zernio Profiles. This is the unit Zernio
bills per account-day.
_Avoid_: Channel, handle (the handle is a _field_ on the account), connection.

**Platform**:
One of the six launch social networks a Social Account can belong to. A
_format_ (Reel, Short, carousel) is not a platform.
_Avoid_: Network, channel, service.
