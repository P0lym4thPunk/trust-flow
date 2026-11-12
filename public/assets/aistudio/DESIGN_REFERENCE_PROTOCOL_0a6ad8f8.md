# Design Reference Protocol

The user will upload screenshots/images showing the intended visual style and possibly specific interface layouts. These are required design inputs.

## Required inspection

Before implementing the UI:

1. List every supplied image and identify its likely purpose.
2. Inspect each image at full useful resolution.
3. Separate reference intent into:
   - overall visual language,
   - color palette,
   - typography,
   - spacing and density,
   - component shapes,
   - navigation,
   - chat/composer behaviour,
   - cards and status treatments,
   - iconography,
   - imagery/illustration,
   - responsive clues.
4. Identify which references show exact layouts and which are mood/style references.
5. Create a reference-to-screen map.
6. Record inferred values separately from clearly visible values.

## Do not

- Replace the references with a generic fintech dashboard.
- Copy unrelated brand logos or protected brand identity from a reference.
- Ignore mobile composition.
- Treat a screenshot as proof of hidden interactions.
- Invent exact design tokens when the image does not support them.
- Use stock visuals that conflict with the reference direction.

## Required output before implementation

Create `design/REFERENCE_AUDIT.md` containing:

- Image filename.
- What it appears to represent.
- Elements to preserve.
- Elements to adapt for TrustFlow.
- Unclear details.
- Target screens/components.
- Confidence level.

Create a proposed design token sheet from the references and map it to CSS variables/Tailwind tokens. If exact colors cannot be sampled, label values as approximate.

## Visual fidelity gate

Before feature-heavy implementation, render the main landing page, app shell, conversational workspace and agreement room. Compare them side-by-side with the references.

Correct major hierarchy, spacing, typography, colors and component differences before proceeding.

The uploaded reference images are visual inputs. The product requirements remain authoritative for functionality and content.