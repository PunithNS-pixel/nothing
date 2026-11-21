# Nothing Market — backend and administration

This backend belongs to the **Nothing Market multi-category retail store**. See the root README for the complete architecture and customer journey.

## Database administrator access

The local PostgreSQL container is configured with database `nothing` and user `nothing`, whose password is the private `LOCAL_DB_PASSWORD` in `backend/.env`. This is a database connection account and is **not the storefront admin login**.

The quickest administrative shell from repository root:

```powershell
docker compose -f backend/compose.yml --env-file backend/.env exec postgres psql -U nothing -d nothing
```

Inside psql, `\dt` lists tables; `SELECT count(*) FROM users;` counts user records. Use `\q` to exit. Do not show password hashes or personal information in demo screenshots.

For an optional local-only visual database interface, set unique `PGADMIN_EMAIL` / `PGADMIN_PASSWORD` in your private `backend/.env`, then run:

```powershell
docker compose -f backend/compose.yml --env-file backend/.env --profile dbadmin up -d pgadmin
```

Open http://localhost:5050 and sign in with `PGADMIN_EMAIL` and `PGADMIN_PASSWORD`. In pgAdmin choose **Add New Server**:

- Name: `Nothing Market Local`
- Connection hostname: `postgres` (service hostname within Docker networking)
- Port: `5432`
- Maintenance database: `nothing`
- Username: `nothing`
- Password: the private `LOCAL_DB_PASSWORD`

The pgAdmin web port is bound to `127.0.0.1`, not publicly exposed. Its own credentials do not grant access to PostgreSQL without the separate DB connection credentials. Do not expose pgAdmin to the public internet.

When using the Aiven deployment profile, start the optional `pgadmin` service using `backend/compose.aiven.yml` and `backend/.env.aiven`. Enter the **Aiven PostgreSQL host, port, database, user and password** from the Aiven console, and configure SSL mode **Require** in the pgAdmin server connection settings. Do **not** enter `postgres` as the host for an Aiven connection.

## Automated local integration checks

Run the read-only PowerShell diagnostics:

```powershell
powershell -ExecutionPolicy Bypass -File backend/scripts/verify-integrations.ps1
```

This checks Compose, PostgreSQL queries, application catalog, fuzzy and substring OpenSearch responses, Kafka topics and outbox delivery evidence, RabbitMQ broker health, Prometheus target status and Grafana health. It does not place test orders or delete data. It cannot verify Aiven simply by seeing local Compose containers: check the Aiven console and start the Aiven Compose profile separately.

To verify the order-to-Kafka-to-OpenSearch flow, place a test COD order, then re-run the diagnostics and compare order, outbox, consumed and inventory counts. Production checks should include authenticated browser testing and failure-recovery drills.

## Terraform

```powershell
cd backend/infrastructure/terraform
terraform init
terraform validate
terraform plan
```

Terraform requires an authorized Aiven API token and project configuration; `terraform validate` checks definitions but does not verify cloud resources have been provisioned. Terraform state can contain secrets; use a secure remote state backend. Prefer environment variables for your API token over committing Terraform variable files.

## Security boundaries

- Customer accounts, retailer approval and the store administrator account are application-level identities.
- PostgreSQL administrative access is privileged database access, not part of the public website.
- Aiven PostgreSQL `avnadmin` is a service-scoped database account, not a machine root or an Aiven organization admin.
- Credentials must remain in private `.env` files. Never paste them in issues, chat or commits.

## Expanded retail demo catalog (seed)

The seed now contains **46 named items** across Electronics, Home & Living, Fashion, Grocery and Beauty (14 existing plus 32 additional). They have distinct names, descriptions, prices, city labels and positive stock. The seed is idempotent: existing products, purchases, accounts and inventory are not reset or overwritten. New products are added on backend startup when `SEED_RETAIL_CATALOG=true`. The new items without an assigned photograph use existing category icons in the frontend; add licensed product photos later.

For local Docker use `git pull origin backend` then `docker compose -f backend/compose.yml --env-file backend/.env up -d --build --force-recreate app frontend`. Open `http://localhost:8000/api/store/catalog` to inspect live PostgreSQL product data. The storefront now routes API requests on the same origin (`/api`), rather than contacting port 8090 from the browser, to keep authentication cookies consistent.

COD now keeps the successful order confirmation separate from the subsequent optional catalog/order-history refresh. Stripe is offered only when `/api/checkout/stripe/config` confirms both configured Stripe test credentials, and it still requires an actual signed test webhook before an order is fulfilled. Do not use production Stripe keys before reconciliation/refund handling is complete.

## Storefront login and image improvements

Visitors now have separate **SIGN IN** and **CREATE ACCOUNT** buttons. Signed-in customers have **ACCOUNT** and one-click **SIGN OUT** buttons. Signing out clears the in-browser bag so the next visitor cannot see another customer's selection; the database cart stays associated with the original account. No one needs to type \u0060LOGOUT\u0060.

Product cards use individually chosen Unsplash photos where available, with distinct product-specific illustrations and descriptive labels for the remaining products. If an external image cannot load, the illustration automatically replaces it. The demo photos are representative, not photographs of actual fulfilment inventory or proof of product branding. Marketplace pictures from Amazon/Flipkart were **not** copied or hotlinked. The Unsplash License is at https://unsplash.com/license. For real sales, sellers should upload photographs of the specific products they will ship.

After pulling this commit, run \u0060docker compose -f backend/compose.yml --env-file backend/.env up -d --build --force-recreate app frontend\u0060. Catalog seeding only fills missing photo URLs and never overwrites established images or quantity values. Refresh \u0060http://localhost:8000\u0060 with Ctrl+Shift+R.

## Marketplace UX and verified checkout (November 2026)

The customer storefront at `http://localhost:8000` now includes a category showcase, popular picks / deals backed by real `price` and `specialPrice` fields, add-to-cart feedback with a **VIEW CART** action, and a responsive five-tab bottom nav (Home, Categories, Deals, Account, Cart). COD no longer requires typing YES: customers review an order-confirmation dialog. They can select, create, or correct saved addresses, including recipient name, mobile number, landmark, city, state and six-digit Indian PIN. Both `/api/addresses` writes and order placement enforce phone and name when `CHECKOUT_REQUIRE_PHONE=true` (the local Compose default). Existing addresses without this information must be edited before ordering.

**Fashion sizes are actual SKUs:** 16 independently stocked variants across T-shirt, hoodie, jacket and running shoes. The frontend groups these into one size selector per style, and submits the **selected variant productId** to the PostgreSQL cart and order. This demonstrates inventory-backed sizes, **not** size-specific garment images or validated fit charts. Seller-supplied on-model photographs and true dimensions are needed before representing garment fit.

**Email verification is implemented but needs an actual SMTP sender.** To enforce inbox ownership (including for previously created accounts), put the following in private `backend/.env` using legitimate credentials from your email provider:

```dotenv
EMAIL_VERIFICATION_REQUIRED=true
SMTP_HOST=<your-provider-smtp-host>
SMTP_PORT=587
SMTP_USERNAME=<your-provider-username>
SMTP_PASSWORD=<private-provider-password>
SMTP_FROM=<verified-sender-address>
CHECKOUT_REQUIRE_PHONE=true
```

Do not commit `backend/.env`. New signups receive a six-digit OTP valid for ten minutes, with a one-minute resend cooldown and five attempts; the code is stored hashed, not in plaintext. A successful OTP produces a one-time, fifteen-minute proof used in account creation or to verify an existing account. Checkout is blocked for unverified accounts when the feature is enabled. The backend never accepts an invented `verified=true` flag from the browser.

**Important:** `EMAIL_VERIFICATION_REQUIRED=false` remains the development default so local demo sign-in and older automated fixtures keep working without SMTP. In that mode a syntactically valid email is **not** verified; do not present it as verified to users. Switch to `true` before any real store launch. Provider delivery, abuse protection per IP, bounce handling, and operational monitoring remain deployment responsibilities. Verification demonstrates control of the inbox, not identity or physical-address verification.

Promotions are seeded only on untouched demo products with known original prices, with the server enforcing current `specialPrice`. Do not claim flash-sale expiry or product reviews that do not exist. Photographs are representative Unsplash demo media; Amazon/Flipkart photos and brand assets have **not** been copied. Obtain actual seller product/size media, measurements, photo rights and commercial inventory before launch.


## Marketplace checkout release — November 2026

The customer flow now has a responsive three-stage dialog, rather than a series of disconnected prompts:

1. Address — saved-address cards; add, edit, name, phone and six-digit PIN; explicit selection.
2. Confirm details — delivery summary, per-item photos, actual size SKU, live item quantities, subtotal and verified price markdowns.
3. Payment — Cash on Delivery or Stripe Checkout. Stripe is shown as disabled when it has no test credentials. COD submits directly to the Spring Boot order API with no typed YES field.

COD requests now carry a customer-generated UUID checkout token. PostgreSQL stores this token uniquely with the order, and a repeated request with the same token returns the original order ID without decrementing stock again. This protects the customer from double orders when retrying a lost network response. The UI disables the Place Order button while the request is active. It also shows the recorded order ID and a link to real order history.

Authenticated order history now includes purchased products, quantities and payment method/status, mapped inside a database transaction. Authenticated wishlists have their own PostgreSQL table and per-user API, with account isolation tests. The header account dropdown has functioning Sign In, Create Account, Profile, Addresses, Orders, Saved Items and Retailer paths; it intentionally does not pretend to offer rewards, loyalty points, shipment tracking or 24-hour support where services are not implemented.

The category icon rail works on desktop and mobile. Filter and search now use live PostgreSQL catalog matches when OpenSearch is unavailable or still catching up to the latest product seed, rather than showing empty results from an index outage.

### Run the release on Windows PowerShell

    cd C:\Users\msome\OneDrive\Desktop\nothing
    git switch backend
    git pull origin backend
    docker compose -f backend/compose.yml --env-file backend/.env up -d --build app frontend
    docker compose -f backend/compose.yml --env-file backend/.env ps -a

Open http://localhost:8000 and hard-refresh with Ctrl + Shift + R. The backend rebuild is required for the new orders checkout token and wishlist database schema; the frontend is bind-mounted into Nginx.

Test: sign in; add an item plus a fashion SKU with a selected size; proceed to cart; choose or add delivery address; review line items and change quantities; continue to Payment; choose COD; press Place COD Order once; verify new order and inventory; on the next transaction, try Stripe sandbox Checkout while the signed webhook CLI listener is running.

### Launch readiness limitations

This is an end-to-end local demo, not yet a production retail service. With email verification required, the environment must provide a genuine SMTP account; otherwise its default remains disabled. Delivery phone format checks are not SMS possession verification. Product photos are representative curated media, not proof of inventory or model-size fit. Estimated delivery dates, open-box delivery, courier tracking, cancellation/refund operations, payment failure reconciliation, seller-managed size charts, and a real consumer-support service must be implemented before displaying those promises. Never copy marketplace product images without rights, and never commit Stripe or SMTP secrets.

## Real email verification and clickable product details

Docker Compose now defaults `EMAIL_VERIFICATION_REQUIRED=true`; a string shaped like an email cannot create an account without a six-digit code sent to that inbox. Without SMTP settings, new signup is **blocked**, not silently registered. This does not validate real-world identity: it proves control of the specified inbox. Existing accounts created before verification can still authenticate, but the storefront prompts them to verify, and the backend blocks COD and Stripe checkout until verification. To finish setup, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and a verified `SMTP_FROM` in **private** `backend/.env`; then recreate the app. An explicit `EMAIL_VERIFICATION_REQUIRED=false` in the private file overrides the secure Docker default, so remove it or change it to true. Verified customers can sign in with either email address or username, but must supply the correct password. New passwords require at least ten characters, mixed case and a digit.

Clicking a product photo, product name or deal image now opens a dedicated responsive product-detail dialog, with a large image, photo zoom, current price, stock, selectable real clothing/shoe size SKU, wishlist, Add to Cart and Buy Now. Buy Now adds the selected SKU and launches the same address → confirm details → payment wizard as the cart. The product URL includes a shareable `?product=<id>` query parameter, which also reopens the detail view after refresh.

For genuine multiple product angles, an authenticated seller can add up to **eight HTTPS image URLs** through `PUT /api/seller/products/{productId}/gallery` with JSON `{"images":["https://seller-cdn.example/product-front.jpg","https://seller-cdn.example/product-side.jpg"]}`. Only that product's owner or an administrator can update it. The public catalog includes these real URLs in an `images` array; the gallery renders as thumbnails. With just the primary catalog photograph, the UI provides an explicitly labeled **Close-up** crop of that same image, not a fabricated second angle. Sellers should provide permission-cleared photos of the exact product; Amazon/Flipkart media must not be copied without rights.

The automated suite includes successful real-format email OTP registration, wrong-password rejection, denial of registration without proof, and product gallery owner isolation.
