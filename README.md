# Apex Hours

Shift-hours calendar for Apex Training Centre. Tap a day to log a shift (employee, start and end time); the calendar shows initials and times (e.g. `JD 2-9pm`), and the bottom of the page totals hours per employee for any date range. Month and 2-week views, editable shifts, password lock screen.

- `index.html` is the whole app (styles, script and logo are inline).
- `apex-logo.png` is the white logo used on the page.

The page saves shifts through the Claude Artifact database (`window.claude.use("db")`), so it saves data only when opened as the published Claude artifact. Opened as a plain file or on another host it loads but cannot save.
