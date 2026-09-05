# Admin Test Mode backend support

This build adds secure admin authentication endpoints for the 3D Dice Activity bridge.

## Railway variable

Add this variable to the **Mixer Dungeon Master bot Railway service**:

- `DICE_ADMIN_PASSWORD` = the admin password you chose

Do not put the password in the Activity's browser JavaScript.

## Added endpoints

- `POST /dice/admin/login` with JSON `{ "password": "..." }`
  - Returns a random 30-minute bearer token on success.
  - Rate-limited to 8 attempts per minute per client IP.
- `GET /dice/admin/session` with `Authorization: Bearer <token>`
  - Verifies that Test Mode is still authorized.
- `POST /dice/admin/logout` with `Authorization: Bearer <token>`
  - Ends the current admin session.
- `/health` now reports `diceAdminConfigured` without exposing the password.

## Important

The uploaded `Mixer-Dungeon-Master-main.zip` contains the Discord bot / bridge only. It does **not** contain the current Mixer Dice Table Activity frontend shown in the screenshot. The Admin button, password modal, D4/D6/D8/D10/D12/D20/D100 test controls, and physical D100 visuals must be added to that separate Activity project.

The backend side is now ready for that UI without hard-coding the password into client-side code.
