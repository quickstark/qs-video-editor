# Repository Video Brand Defaults

This is the neutral repository fallback, not a claim about any individual project. A project-local `brand.md` overrides it. Confirm every project-specific name, identity, color, font, logo, vocabulary, and editorial preference before final delivery.

## Default voice

- Truthful, clear, human, and restrained.
- Documentary evidence before decoration.
- Complete thoughts and speaker meaning before arbitrary pace targets.
- Unknown text is omitted, never replaced with a plausible guess.

## Default visual tokens

| Token | Value | Use |
| --- | --- | --- |
| bg | #F6F1EA | Neutral warm background |
| rule | #D6CBC0 | Hairlines and quiet dividers |
| accent | #7B4D4F | One focal accent |
| accent-soft | #D9C0B8 | Subtle secondary tint |
| ink | #28231F | Primary type |
| muted | #6F6761 | Supporting type |

These are safe working defaults only. Snapshot approved project tokens in the project-local brand and graphics `DESIGN.md` before a final render.

## Typography

- Display preview: EB Garamond or Georgia.
- Supporting preview: Inter or Arial.
- Final: approved, licensed font files stored locally and recorded in the project manifest.
- Avoid faux calligraphy, tight tracking, ornamental scripts, and unverified decorative copy by default.

## Editorial defaults

- Preserve source references, checksums, chronology rules, identity evidence, and exact rational timing.
- Do not fabricate quotations, reactions, events, people, places, or speaker identities.
- Generated material is disabled until the brief grants item-level permission; it may never masquerade as documentary evidence.
- Music and third-party assets require durable license records.
- Private media remains local unless an approval names the exact files and destination.

## Machine-readable defaults

~~~json
{
  "schemaVersion": 1,
  "scope": "repository-fallback",
  "projectLocalBrandOverrides": true,
  "voice": ["truthful", "clear", "human", "restrained"],
  "colors": {
    "bg": "#F6F1EA",
    "rule": "#D6CBC0",
    "accent": "#7B4D4F",
    "accent-soft": "#D9C0B8",
    "ink": "#28231F",
    "muted": "#6F6761"
  },
  "fonts": {
    "displayPreview": "EB Garamond",
    "supportingPreview": "Inter",
    "requireApprovedLocalFilesBeforeFinal": true
  },
  "privacy": {
    "localProcessingDefault": true,
    "externalUploadRequiresExactApproval": true
  },
  "generatedAssets": {
    "enabledByDefault": false,
    "documentaryEvidenceAllowed": false
  }
}
~~~
