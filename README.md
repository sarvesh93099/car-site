# V31 Concepts

A customer storefront and private studio desk for V31 Concepts. Built with plain HTML, CSS and JavaScript, a Node.js server, and SQLite. Uses PostgreSQL for hosted storage and PDFKit for PDF generation. No build step.

## Start the website

Use Node.js 22.13 or newer (Node 24 LTS or newer recommended).

```powershell
npm install
npm start
```

Open **http://localhost:3000**. Use the server URL instead of opening `index.html` directly: accounts, shared catalogue updates and studio records need the backend.

On the first start, the terminal displays the admin email (`admin@gmail.com`) and a randomly generated password. Save the password securely; it is only displayed once. Choose **Log in → Admin** on the website. The default email applies only when creating a new database; it does not change an existing admin account.

To choose your credentials before the first start, set them in the same PowerShell terminal:

```powershell
$env:ADMIN_EMAIL = 'your-email@example.com'
$env:ADMIN_PASSWORD = 'your-unique-password-at-least-12-characters'
npm start
```

These variables initialize the first administrator only. Changing them later does not replace an existing account. Customer accounts are created under **Log in → Normal user → Create an account**. Public registration cannot create administrators.

## Customer experience

- The site opens to the public catalogue; no login is required to browse or request items.
- Search, category filters and a quantity-based request basket work on phones and desktop.
- Guests submit their name, WhatsApp number, vehicle and optional notes. Indian mobile numbers need only 10 digits; a leading 0, 91 or +91 is also accepted. International numbers can start with + or 00, and spaces, hyphens and parentheses are welcome. Requests are saved in the studio inbox, with a reference number shown to the customer.
- Normal users can track requests submitted while signed in. Guest requests do not become linked to an account automatically.
- Requests are expressions of interest, not paid or automatically confirmed orders. The studio confirms stock, service scope, appointment details and pricing directly.
- A basket is retained in the browser; customer contact details are not stored there.

## Admin experience

- **Studio desk → Customer requests:** review incoming requests, update status, and prepare quotations from selected items.
- **Catalogue → Add product or service:** publish a named item, category, description and price. A price of zero indicates a custom-priced item.
- **Quotations:** choose items, edit quantities and prices, add a discount and GST rate, save, print, or share. Existing quotations can prefill a new bill.
- **Billing:** create numbered bills, record unpaid/paid status, download a PDF directly, or choose **Share PDF** to share the file through WhatsApp or another installed app.
- Quotations and bills accept the same convenient phone formats as customer requests. The server adds +91 to local mobile numbers and saves every accepted number in international format for WhatsApp sharing.
- Saved documents automatically prepare a PDF with the studio logo, customer and vehicle details, document number, date, line items, discount, GST, total, payment status and notes. PDFs are generated from saved records through an administrator-only endpoint and are not published at public links. Amounts use INR.
- **Share PDF** opens the device share menu when PDF file sharing is supported (HTTPS or localhost). Choose WhatsApp, select the customer shown in the preview, and complete sending. If file sharing is unsupported, the PDF downloads instead; use **Open customer chat** and attach the downloaded PDF as a document. **Download PDF** is always available after preparation. Cancelling the share menu does not send anything. The app does not automatically send messages or claim delivery. Quotations also retain an optional text-sharing action.
- Status changes and document creation require a signed-in administrator at the server, not just in the interface.

## Storage and hosting

Records and hashed passwords are stored in `data/studio.sqlite`. Sessions expire after 24 hours and are kept in HttpOnly, SameSite cookies. Request prices and document totals are computed on the server. The static-file allowlist prevents publishing the database and source files.

The `data/` directory is ignored by Git. Back it up with the server stopped (or use SQLite's backup facilities). Never delete it to reset a password: it contains all studio records. Previous `v31_quotes_v1` browser storage is untouched; the old browser-only history is not automatically imported into the new database.

For a public launch on a traditional Node host, use a persistent writable disk, an HTTPS reverse proxy, and `COOKIE_SECURE=true`. Set `HOST=0.0.0.0` only when the server should listen beyond the local machine; the default is `127.0.0.1`. `PORT` defaults to `3000`. `DB_PATH` can override the SQLite database location.

### Deploying to Vercel

Vercel uses the function in `api/[...path].js` for the API. Set up a hosted PostgreSQL database (for example, through Vercel's Neon integration), then add these environment variables in **Project → Settings → Environment Variables** before deploying:

- `DATABASE_URL`: the database connection string from the PostgreSQL provider.
- `ADMIN_EMAIL`: `admin@gmail.com` (or your preferred administrator email).
- `ADMIN_PASSWORD`: a unique password of at least 12 characters.

Deploy the latest commit after adding the variables. The first function startup creates the schema, seeds the catalogue, and creates the admin account if none exists. These credentials are only used to create the initial account; changing them later does not update an existing user. Vercel's temporary filesystem is not used for production data. Do not point `DB_PATH` at a Vercel filesystem location.

The default GST field preserves the previous app's 18% value and is editable; configure pricing and document details for your business before issuing customer bills. This app does not process payments or send automatic customer notifications.

## Checks

```powershell
npm test
```

Integration tests use an isolated temporary database and cover access controls, role assignment, request ownership, tampered prices, input validation, persisted records, document totals, status updates, cross-site writes, static-file exposure and session revocation.

```powershell
npm install
npm run test:browser
```

Browser tests use installed Google Chrome and an isolated test database. They exercise customer and admin journeys, responsive layout, document conversion, printing content, PDF downloads, file sharing, cancellation, retry and WhatsApp chat links. Install Chrome if it is not already available.

## Design and assets

V31 branding is retained. The design uses an editorial automotive layout, restrained entrance and hover transitions, accessible dialogs, keyboard focus styles and a reduced-motion setting. The hero photograph is downloaded locally from the [Unsplash image CDN](https://images.unsplash.com/photo-1503376780353-7e6692767b70). Fonts are served by Google Fonts with system fallbacks.
