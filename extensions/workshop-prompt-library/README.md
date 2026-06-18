# Prompt Library

Save reusable prompts, manage them in one place, and insert them from the toolbox without leaving your chat.

## What it does

Prompt Library gives you a global set of prompts on this device. You can create your own prompts, edit them, delete the ones you no longer need, copy prompt text, and insert a prompt into the current message box.

It also includes starter prompts. They are saved locally so the library still works when updates are unavailable, and every starter prompt is tagged **Starters** so you can filter them quickly. Prompts from earlier versions are imported automatically the first time the updated library opens.

## Where it shows up

- **Prompts** in the toolbox near the message box: opens a compact picker for inserting a prompt.
- **Prompt Library** in the Extensions navigation: opens the full library for management.
- **Prompt Library settings**: includes a single action to refresh starter prompts.

## How to use it

Use the toolbox button when you are writing in a chat:

- Search for a prompt by name, tag, or prompt text.
- Select a prompt to insert it into your draft.
- Use Copy when you want the text on your clipboard instead.
- Open Prompt Library from the picker when you want to manage prompts.

Use the full Prompt Library when you want to maintain your collection:

- **New prompt** opens a side panel where you can enter a name, tags, and prompt text.
- **Edit** opens the same side panel with the prompt filled in.
- **Delete** asks for confirmation before removing the prompt.
- **Insert** adds the prompt to your current draft and closes the library.
- **Refresh starters** updates the ready-made prompts saved on this device.

## Settings

Prompt Library keeps settings intentionally small. Use **Refresh starter prompts** to update the ready-made prompts. Your own prompts are managed inside the Prompt Library, not in Settings.

## Permissions

- `settings.provide`: shows the starter prompt refresh action and imports prompts saved in earlier versions.
- `storage.local`: saves your prompts and starter prompts on this device.
- `network.fetch`: refreshes starter prompts when you choose to update them.
- `composer.read`: checks whether your message box is ready before adding a prompt.
- `composer.write`: adds the prompt you pick to your message box.
- `clipboard.write`: copies a prompt when you choose Copy.
- `notifications.show`: confirms when a prompt has been added to your message box.
- `commands.provide`: adds Prompt Library commands and the starter prompt refresh action.
- `ui.workspace`: adds Prompt Library to the Extensions navigation.
- `ui.toolbox`: adds the Prompts button near the message box.
- `ui.fullView`: opens the prompt management library.
- `ui.popup`: shows the compact prompt picker from the toolbox.
- `ui.drawer`: opens the prompt editor in a side panel.
- `ui.dialog`: asks for confirmation before deleting a prompt.
