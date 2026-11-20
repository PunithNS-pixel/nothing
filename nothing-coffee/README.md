# Nothing® — animated coffee storefront concept

This is a responsive, original front-end website prototype influenced by the layout and motion language of https://www.dialedcoffee.com. It uses **Nothing** as the brand and original vector can illustrations, rather than copying the third-party website's proprietary photography, code, fonts, or long-form marketing copy.

## Run

Open `index.html` directly in a browser, or serve the directory locally:

```bash
cd nothing-coffee
python3 -m http.server 8000
```

Then visit http://localhost:8000 . No npm install or build step is required. Web fonts use Google Fonts when available, with system fallbacks.

## Features

- Responsive product hero with three color themes, floating canned-coffee artwork, decorative particles, swipe support, and flavor-switch animation.
- Scrolling ticker, intersection-triggered reveals, animated product cards, collapsible FAQ, and layout for team / office ordering.
- Working demo cart: add/remove items, quantities, subtotal, and local browser persistence.
- Newsletter and checkout interactions are clearly marked as demos: **no personal data is stored by the form, and no orders are processed**.
- Accessible labels, semantic sections, keyboard-operable navigation, and reduced-motion support.

## Before production launch

- Replace illustrative products, prices, ingredient details, caffeine claims, and marketing copy with your verified Nothing brand information.
- Provide your **own licensed photos, brand assets, and fonts** if you want photographic cans instead of SVG illustrations.
- Connect the product inventory and checkout to a real ecommerce backend (for example Shopify, WooCommerce, or Stripe).
- Connect newsletter and contact forms to an authorized mailing/CRM system; add privacy terms, payment policies, delivery information, and support channels.
- Test mobile/browser accessibility, shipping/tax calculations, and legal compliance.

## Source layout

- `index.html` — page structure
- `styles.css` — colors, responsive layout, scroll/hover animation
- `app.js` — carousel, cart, interaction logic
- `assets/can-*.svg` — original editable vector can concepts

This is a functioning **front-end concept**, not a pixel-perfect reproduction of custom proprietary WebGL animations, or a production-ready shopping backend.
