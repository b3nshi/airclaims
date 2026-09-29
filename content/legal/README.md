# Legal texts — LEGAL REVIEW REQUIRED

All texts here are drafts written for the MVP and must be reviewed by a lawyer before launch.

- One file per agreement and locale: `{locale}/{kind}.md`, where `kind` is an `agreement_type`
  (`terms_of_service`, `privacy_notice`, `email_authorization`).
- Frontmatter `version` is stored in `agreements.version`. **Any change to the text needs a new
  version** (e.g. `terms-v2`); signed versions must stay reproducible, so keep old texts in git.
- `controller.json` fills `{{CONTROLLER_NAME}}`, `{{CONTROLLER_NIF}}`, `{{CONTROLLER_ADDRESS}}`,
  `{{CONTACT_EMAIL}}`. Still placeholders: fill before launch (and bump versions).
- Per-claim variables: `{{SIGNER_NAME}}`, `{{ALIAS_EMAIL}}`, `{{FLIGHT}}`, `{{FLIGHT_DATE}}`,
  `{{AIRLINE}}`, `{{FEE_BASE}}`, `{{FEE_MIN}}`.
- The SHA-256 stored in `agreements.document_sha256` is computed over the exact rendered text
  (after substitution), as shown to the user.
- Syntax: `# ` heading, `## ` subheading, `- ` list item, blank line between paragraphs.
