# Msty Claw Extensions

Extensions make Msty Claw feel less like a fixed app and more like a workspace you can shape.
They can add focused tools, better prompts, custom views, themes, review flows, automations, and
small bits of workflow glue that stay close to your chats.

This repository is the public home for official Msty Claw extensions and the authoring contracts
used to build them.

## Explore

Open **Extensions** in Msty Claw to browse and install published extensions. You can also visit the
web catalog at [msty.ai/claw/extensions](https://msty.ai/claw/extensions).

Each extension is a folder under `extensions/` with a `manifest.json` at its root. Some extensions
are declarative; others include plain JavaScript, CSS, assets, and a short README.

## Build

Start with the authoring guide:

- [Authoring guide](docs/extensions-authoring-guide.md)
- [Manifest schema](extensions/manifest.schema.json)
- [Extension API types](extensions/msty-extension-api.d.ts)

The schema explains what an extension can declare. The API types describe what Msty Claw provides
at runtime. Keep both beside your extension while building so your editor can catch mistakes early.

## Trust

Trust badges in Msty Claw are not based on what an extension says in its manifest. They are based on
signature checks during install.

- **Official** means the extension uses the `ai.msty.official.*` namespace and is signed by Msty
  Team.
- **Verified Author** means the package was signed by an approved, signed-in Msty author account.
  People can apply for authoring access in Msty Claw, then sign their packages so users can see the
  Verified Author badge at install time.
- **Unverified Author** means Msty Claw could not verify the author's identity. Users can still
  install the extension, but the app makes that trust state clear.

A trust badge proves package identity. It does not mean every line of an extension has been reviewed
by Msty.
