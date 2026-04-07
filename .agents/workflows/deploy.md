---
description: How to perform a cache-busting update for deployment
---
Perform a cache‑busting update using query‑string versioning and service worker cache invalidation.

### VERSION TO APPLY
Use the current release version (e.g., 1.0.1).

### REQUIRED CHANGES

1. **Update index.html asset versions**
Locate the `<link>` and `<script>` tags that reference `styles.css` and `app.js`.
Change:
```html
styles.css?v=OLD_VERSION
app.js?v=OLD_VERSION
```
to:
```html
styles.css?v=NEW_VERSION
app.js?v=NEW_VERSION
```

2. **Update service-worker.js cache name**
Open `service-worker.js`.
Find the line:
```javascript
const CACHE_NAME = 'vn-ocr-cache-...';
```
Replace the entire value with (v + new version):
```javascript
const CACHE_NAME = 'vn-ocr-cache-vNEW_VERSION';
```

### RULES
- Do NOT rename `app.js` or `styles.css`.
- Do NOT create or delete any files.
- Only modify the version strings and `CACHE_NAME`.
- Do NOT modify HTML structure or service worker logic.
