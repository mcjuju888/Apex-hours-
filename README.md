# Apex Hours

Shift-hours calendar for Apex Training Centre. Tap a day, check the shift time (filled in from that weekday's default), then tap an employee's initials to log it. The calendar shows initials and times (e.g. `JD 2-9pm`), and the bottom of the page totals hours per employee for any date range. Weeks start on Sunday. Month and 2-week views, editable shifts, a Settings screen for employees and default shift times, and a password lock screen.

## Files

- `index.html` – the whole page (styles, script and logo inline).
- `api/shifts.js` – Vercel function that loads and saves shifts. It checks the password on every request.
- `apex-logo.png` – the white logo.

## Where shifts are saved

Shifts, employees and default shift times all live in one private JSON file (`apex/shifts.json`) in Vercel Blob file storage. There is no database. Anyone who unlocks the page with the password can add, edit and remove shifts, and the changes are saved for everyone.

## One-time Vercel setup

1. In the Vercel project, open **Storage** → **Create** → **Blob**, choose **Private**, and connect it to this project. This adds the `BLOB_READ_WRITE_TOKEN` environment variable automatically.
2. Optional: add an environment variable `APEX_PASSWORD` to change the password. Without it the password is `1717`.
3. Redeploy so the function picks up the new variables.
