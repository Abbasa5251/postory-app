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

### Publishing plumbing

**Zernio Profile**:
Invisible internal plumbing: a container in Zernio that holds connected Social
Accounts. Brand ↔ profile is 1:N (ADR-009). Provisioned **lazily** — a profile
is created on first account placement, not at brand creation. Users never see
profiles.
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
