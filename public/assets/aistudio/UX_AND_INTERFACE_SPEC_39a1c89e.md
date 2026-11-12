# UX and Interface Specification

## Product experience

TrustFlow should feel like a calm, simple workspace for getting agreements and protected payments completed. The user should not feel they are operating a blockchain explorer or a complex financial dashboard.

The primary interaction is a conversational agreement workspace, similar in familiarity to a chat interface, but with purpose-built transaction controls and structured agreement cards.

## Information architecture

### Public landing page

- Header with TrustFlow identity and concise navigation.
- Clear headline explaining protected payments.
- Short explanation of the three use cases.
- Primary **Launch app** action.
- A simple process explanation: Describe → Agree → Fund → Complete.
- Trust and testnet/prototype messaging where appropriate.
- Footer with product links and support information.

### App shell

- Top-left menu icon toggles a collapsible navigation drawer.
- Brand mark/name in the top bar.
- Wallet connection/status and profile control on the right.
- Main content area prioritises the current task.
- On mobile, drawer overlays the content and closes after navigation.
- Keep wallet/profile controls reachable without making the top bar crowded.

### Navigation items

- Overview
- Create agreement
- All agreements
- Pending actions
- Awaiting my approval
- Active
- Completed
- Settings
- Help / About

Do not create too many navigation items. Group statuses under a small number of clear destinations if needed.

## Main conversational workspace

- A short greeting and one-line explanation.
- Three compact transaction-type options: Work, Protected payment, Conditional disbursement.
- Large, clear message composer with example prompts.
- Send action and visible loading state.
- AI response appears as concise conversational text.
- Structured agreement preview appears as a distinct editable card.
- Missing required fields are shown as targeted questions, not a long form dumped on the user.
- User can edit terms, run checker, save draft and share for acceptance.
- The composer must not be the only way to perform critical actions; explicit review controls are required.

## Agreement detail / transaction room

Display:

- Agreement title and human-readable status.
- Amount and asset.
- Payer, recipient and approver(s).
- Condition and deadline.
- Accepted agreement version.
- Funding/release transaction state.
- Activity timeline.
- Current next action.
- Evidence links or submission notes.
- Secondary expandable technical details: network, contract ID, transaction hash and explorer link.

Use plain labels such as "Waiting for funding", "Payment protected", "Waiting for approval" and "Payment released". Avoid exposing contract jargon as primary UI language.

## Interaction requirements

- Every visible button must have a real action or be clearly disabled with a reason.
- Provide skeleton/loading, empty, error, success and pending states.
- Prevent double submission on funding/release actions.
- Wallet actions must be user initiated and clearly explained.
- Use confirmation dialogs for irreversible or consequential actions.
- Use toast/status feedback for non-critical events, but do not rely on toast alone for transaction results.
- Show persistent transaction status in the agreement room.
- Use accessible labels, focus states, keyboard navigation and sufficient contrast.

## Responsive behaviour

- Phone-first layout at narrow widths.
- Navigation drawer becomes a full-height or near-full-height overlay.
- Composer remains easy to reach and does not cover essential content.
- Agreement cards stack vertically.
- Tables become cards or horizontally scrollable only when necessary.
- Desktop may use a wider two-column layout, but mobile remains the design baseline.

## Visual authority

Exact colors, typography, component style, imagery and visual mood are not finalized in text. They must be extracted from the user's uploaded UI references. See `DESIGN_REFERENCE_PROTOCOL.md`.