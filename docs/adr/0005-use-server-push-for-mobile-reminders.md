# Use server-scheduled push for mobile reminders

Cyd Mobile sends schedule registration to Cyd’s service and uses server-scheduled push notifications rather than relying only on local notification scheduling, because delivery must remain stable when the app is closed. A push is only a scheduled reminder: opening it leads to review and requires the user to start the work, and the server is never authorized to run Bluesky deletion or hold Bluesky credentials.
