# Side Chat

Side Chat lets you ask follow-up questions against the current chat without adding a new message to the main conversation.

## What it does

- Adds a Side Chat shortcut to the title bar when the current chat has messages.
- Opens a compact popup for side questions.
- Keeps Side Chat history with the current chat.
- Copies user and assistant Side Chat messages.
- Uses the host-provided Side Chat stream so answers include the same conversation background as the built-in flow.

## Permissions

- `context.read`: Uses the current chat as background.
- `models.infer`: Answers side questions with the selected model.
- `storage.chat`: Saves Side Chat history per chat.
- `clipboard.write`: Copies Side Chat messages.
- `ui.titleBar` and `ui.popup`: Adds and opens the Side Chat UI.
