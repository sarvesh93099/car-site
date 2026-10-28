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
- **Billing:** create numbered bills, record payments and track the remaining balance, and choose **Send bill via WhatsApp** to send the actual PDF directly to the saved customer number through your connected WhatsApp Business account. Downloading and device sharing remain available.
- Quotations and bills accept the same convenient phone formats as customer requests. The server adds +91 to local mobile numbers and saves every accepted number in international format for WhatsApp sharing.
- Saved documents automatically prepare a PDF with the studio logo, customer and vehicle details, document number, date, line items, discount, GST, total, payment status and notes. PDFs are generated from saved records through an administrator-only endpoint and are not published at public links. Amounts use INR.
- **Share PDF** passes the complete, validated PDF file to the device share menu. Choose WhatsApp, select the customer, and tap Send. Device sharing requires a supporting browser on HTTPS or localhost and cannot select a WhatsApp recipient automatically. Unsupported browsers download the PDF instead. **Download PDF** and **Open customer chat** provide a fallback if WhatsApp rejects the native attachment: choose **Attach > Document** in the chat and select the saved PDF. Cancelling the share menu does not download or send anything. Native app acceptance and delivery cannot be confirmed by the website. Quotations also retain an optional text-sharing action.
- Status changes and document creation require a signed-in administrator at the server, not just in the interface.

## Connected studio workflow

1. Open **Studio desk ? Today** for new enquiries, appointments due today or overdue, work in progress, ready vehicles and outstanding balances. Dates follow India time.
2. Create a quotation from a customer request to retain the request link. On the quotation, choose **Schedule job**, confirm customer acceptance, set the appointment date and enter the assigned technician's name.
3. Open **Jobs** to search by customer, vehicle or technician and filter by stage. Each job contains its original request, quotation, checklist, work notes and activity history.
4. Use **Start work ? Send to quality check ? Pass quality check**. Complete every service checkbox before entering quality check. Save details to update scheduling, assignment or notes.
5. Once ready, choose **Generate bill**. Prices and taxes come from the saved quotation. Retrying creates no duplicate bill.
6. Choose **Record payment** on the job or in Billing. Enter money already received, its date, method and reference. This records a receipt; it does not charge a customer. Status follows the total received: Unpaid, Partially paid or Paid. The bill preview and PDF include received and remaining amounts.
7. **Confirm delivery** closes a ready job after its bill has been settled. Delivered jobs remain available for review.

Payment submissions use a persistent retry key and concurrent writes cannot overpay a bill. Entries record the administrator's name and timestamp. Existing bills previously marked Paid retain their settled balance and explicitly show that detailed payment records are unavailable. Job and payment tables/indexes are created automatically at server startup; existing records are retained. The server's direct bill-status PATCH now rejects manual changes: use the payment form.

This workflow uses the existing administrator login. Technician assignment is a name, not a separate staff login or permission grant. Payment reversals/refunds, image uploads and separate advisor/technician accounts are not included in this release. PostgreSQL uses the same persistent job and payment data as local SQLite; a deployed PostgreSQL smoke test is still required before relying on the workflow in production.

## Direct WhatsApp bill delivery

If WhatsApp on Android reports **Can't send empty file** after device sharing, use **Empty file in WhatsApp?** in the bill preview. Save the downloaded PDF, remove the failed attachment in WhatsApp, then choose **Attach > Document** and select the saved file from Downloads. The app uses this saved-file method for later device shares during the same page session. A browser `DataError` also offers the complete PDF for download. This is a recovery path for the device handoff; it does not claim automatic WhatsApp delivery.

The **Send bill via WhatsApp** button sends the saved bill as a PDF attachment using Meta's WhatsApp Cloud API. The server generates the PDF, uploads it to Meta, and addresses the document to the customer's saved number using Meta's [document message API](https://www.postman.com/meta/whatsapp-business-platform/request/zjtbdpz/send-document-message-by-id). This action is available for bills; quotations retain their existing sharing options.

Connect a WhatsApp Business account with a Cloud API business phone number and a server-side access token authorized for `whatsapp_business_messaging`. A personal WhatsApp account or a `wa.me` link cannot provide this server-side attachment flow. Add these environment variables to your server, or to **Vercel → Project → Settings → Environment Variables**, then restart or redeploy:

| Variable | Value |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Meta access token for your business phone number. Keep it on the server; never add it to browser code. Use a suitable production token when launching. |
| `WHATSAPP_PHONE_NUMBER_ID` | The Meta phone number **ID**, not the phone number itself. |
| `WHATSAPP_API_VERSION` | A supported Graph API version from your Meta app, in `vNN.0` format. Required explicitly so upgrades are deliberate. |
| `WHATSAPP_BILL_TEMPLATE` | Optional approved template name, configured as described below. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Template language code; defaults to `en_US`. Must match the approved template. |

For local development, set environment variables in the PowerShell terminal before `npm start`, as with the administrator credentials above. The application does not load `.env` files automatically. Without the required settings, the button becomes **Share bill PDF to WhatsApp** once the PDF is ready. It opens the device share menu: choose WhatsApp, select the customer, and tap Send. Browsers without file sharing download the PDF and show instructions for attaching it in the customer chat. **Check connection** refreshes the Business connection status after setup. Credentials are never returned by the status endpoint. Use Meta's test phone and allowed test recipients while setting up the connection.

Without a template, the API sends a document message, which requires the customer to have messaged your business within the last 24 hours. To initiate bill delivery outside that window, create and get approval for a template with a **DOCUMENT header** and exactly three positional body parameters, in this order:

1. Customer name, `{{1}}`.
2. Bill number, `{{2}}` (for example, `V31-B-0002`).
3. Total in INR, `{{3}}`.

Example body: `Hello {{1}}, your V31 Concepts bill {{2}} for {{3}} is attached. Thank you.` Supply a sample PDF during Meta's template approval process, then set `WHATSAPP_BILL_TEMPLATE` and its language. The application attaches the actual bill as the document header when sending. Contact only customers who have agreed to receive these WhatsApp messages.

Sending is an explicit administrator action after saving a bill. **Submitted to WhatsApp** means Meta accepted the request; it does not confirm delivery or that the customer read it. Delivery webhooks are not configured by this application. The server keeps send attempts for each saved bill version to prevent duplicate submissions, including across tabs and server restarts. A change in payment status allows the updated bill to be sent. Clear provider rejections allow a manual retry; uncertain outcomes block resending that version so a timeout cannot silently create duplicate bills. Check WhatsApp Business before resolving an uncertain send. Downloads and device sharing remain available, and never run automatically when direct sending fails.

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

PDF downloads use `/api/documents?pdf=<id>` through the same function as saved document history. Keep the `includeFiles` configuration in `vercel.json`: it packages the studio logo and PDFKit fonts for the deployed function. PDF code loads only when downloading, so a PDF failure does not block access to saved bills. Existing PostgreSQL and SQLite records remain compatible; no database reset or migration is needed.

The default GST field preserves the previous app's 18% value and is editable; configure pricing and document details for your business before issuing customer bills. This app does not process payments. WhatsApp bills are sent only when an administrator chooses **Send bill via WhatsApp**, after configuring the connection above.

## Checks

```powershell
npm test
```

Integration tests use an isolated temporary database and cover access controls, role assignment, request ownership, tampered prices, input validation, persisted records, document totals, status updates, cross-site writes, static-file exposure and session revocation. WhatsApp tests mock Meta's API to check PDF attachments, template parameters, failures and duplicate protection without sending real messages.

```powershell
npm install
npm run test:browser
```

Browser tests use installed Google Chrome and an isolated test database. They exercise customer and admin journeys, responsive layout, document conversion, printing content, PDF downloads, the WhatsApp attachment workflow, invalid PDF rejection, retry and WhatsApp chat links. Install Chrome if it is not already available.

## Design and assets

V31 branding is retained. The design uses an editorial automotive layout, restrained entrance and hover transitions, accessible dialogs, keyboard focus styles and a reduced-motion setting. The hero photograph is downloaded locally from the [Unsplash image CDN](https://images.unsplash.com/photo-1503376780353-7e6692767b70). Fonts are served by Google Fonts with system fallbacks.
