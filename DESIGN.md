# Arcloom design system

Arcloom is a precise workspace for following evidence across investigations. A reviewer should distinguish a report, a proposed test, an observation and an accepted finding at a glance. Every count, graph connection, activity entry and provider label must come from actual application state.

## Visual language

- Warm paper canvas, white work surfaces, deep evergreen navigation and a restrained copper accent. Status colors carry consistent semantic meaning and always have text labels.
- Locally bundled DM Sans for controls and body copy, Newsreader for the opening heading, and monospace for hashes and identifiers.
- Body text at 14–16px and supporting text at least 12px. Controls have at least a 40px desktop or 44px touch target. Evidence and policy prose should remain readable without zooming.
- Thin neutral borders, 8–12px corners and consistent spacing establish hierarchy. Charts and graph views show actual records and explain their measures.

## Interaction

Keep one clear next action per stage: submit a report, approve a lab test, review evidence or start a fresh investigator. Empty states explain how to begin; disabled actions explain what is required. Preserve useful data while refreshing and keep one-time credentials visible until the user dismisses them.

Use named mobile navigation, visible keyboard focus, predictable dialog focus and an accessible route to the main content. Hash routes retain the selected view or investigation through reload and browser history. Show graph overviews and readable detail views, with keyboard selection as well as pointer interaction.

Use short CSS transitions and honor reduced-motion preferences. Progress feedback represents real pending work. Credentials remain in server-side configuration; browser forms show safe connection status without returning stored secrets.

## Content

Use concrete task labels and explain the consequence of approval or acceptance. Keep deterministic mode visible. Distinguish current evidence from historical conclusions, runner observations from reviewed findings, and provider diagnostics from investigations. Errors give an actionable next step without exposing credentials.

## Review checklist

Check 390px, 768px, 1024px and 1440px layouts, keyboard focus, report dialogs, graph selection, long case names, failed requests and role restrictions. Verify reduced motion, readable status contrast, mobile navigation, evidence export and the two separate human checkpoints. Use automated accessibility checks alongside keyboard and visual review.
