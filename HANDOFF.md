# Kokuro Customs storefront: handoff (Human Mode)

Front end is complete against mock data. Payments and fulfillment are intentionally not built.

## Architecture

```
theme/human.css        all design tokens (--k-*) and shared primitives (k-btn, k-chip, k-field, k-panel, k-badge, k-art ...)
Main.dc.html           shell: router state, filters, cart state, data access layer (api()), theme switch
  SiteHeader / SiteFooter          shared chrome
  HomePage / ShopPage / ProductDetail / CustomPage / CartPage     one file per screen
    ProductCard, FilterPanel, PageBanner, PromoBlock, InquiryForm, CartLineItem     reusable components
  CartDrawer           mini-cart after add-to-cart (links to the cart page)
```

Screens receive plain data and callbacks as props. Only `Main.dc.html` owns state and talks to `api()`.

Adding a page: create `XPage.dc.html`, add a `view` value and an `isX` flag plus an `sc-if` block in `Main.dc.html`, add a nav handler. Reuse `PageBanner`, `k-wrap` and the k-* primitives.

### Furry Mode (home built; rest shared)
Implemented: `theme/furry.css` (token overrides), `FurryHome.dc.html`, `FurryPrompt.dc.html` (secret button), `motion/matrix-intro.js` (Human -> Furry intro), mode switching and persistence in `Main.dc.html` (`localStorage['kokuro.mode.v1']`), header "Human Mode" button. Details, options and events are in `MOTION.md` ("Human Mode to Furry Mode"). Backend notes: mode is client-only; cart and catalog are shared across modes. Species tiles are placeholders until products carry a species tag; add one to the product shape and filter the Furry shop by it. Original notes on the token system follow.

All colors, fonts, skew and gutter come from variables in `theme/human.css`. To add a second mode: create `theme/furry.css` with a `[data-theme="furry"] { ...same --k-* variables... }` block, link it next to `human.css`, and set `state.theme` in `Main.dc.html` (it already renders `data-theme="{{ theme }}"` on the root). Page-specific CSS in the page files uses the same variables. Remaining hard-coded values: brand SVG asset URLs (`/_blob/...`) and a few page layout numbers. To swap imagery per mode, move the URLs in `assets()` and the `.dc.html` image tags behind data props.

## The seam: `api()` in `Main.dc.html`

Every method returns a Promise. Replace the bodies, nothing else changes.

| Method | Today | Replace with |
|---|---|---|
| `listProducts()` | `mockCatalog()` | `GET /api/products` |
| `getCart()` | `localStorage["kokuro.cart.v2"]` | `GET /api/cart` |
| `saveCart(cart)` | `localStorage` | `PUT /api/cart` `{ lines }` |
| `subscribe(email)` | resolves ok | `POST /api/newsletter` `{ email }` |
| `submitInquiry(payload)` | resolves ok | `POST /api/custom-inquiries` |

Delete `mockCatalog()` when `listProducts` is live.

## Data shapes

```ts
type Product = {
  id: string; sku: string; name: string; blurb: string; tag: string;   // tag: '' | 'New' ...
  category: 'tees'|'hoodies'|'headwear'|'drinkware'|'desk-gear'|'stickers';
  group: 'apparel'|'drinkware'|'desk-gear'|'stickers';                  // derived from category (landing page rows)
  categoryLabel: string;
  sizeNoun: string;                                                     // 'Size' | 'Fit' | 'Pack'
  colors: { id: string; label: string; hex: string }[];
  sizes:  { id: string; label: string }[];
  variants: { id: string; colorId: string; sizeId: string; priceCents: number; inStock: boolean }[]; // id = `${colorId}/${sizeId}`
  gallery: ({ kind: 'photo'; src: string; pos: string; zoom?: number } | { kind: 'art'; art: 'crest'|'paw'|'claw'|'mountain' })[];
  policies: { shipping: string; returns: string; quality: string };
};
type CartLine = { lineId: string; productId: string; variantId: string; qty: number };   // qty 1..99
type Inquiry = { name: string; email: string; productType: string; quantity: number; designDescription: string; reference: string; notes: string };
```
Money is integer cents, formatted by `money()`. Lines merge on product + variant.

## Catalog source (updated from the original store)
- Products, names, prices and descriptions now come from the original Kokuro Customs store (`store-main/index.html`, `Business Summary.md`): 28 items plus 6 ready-made posters. Kokuro is a made-to-order commission shop: a non-refundable $25 design deposit per distinct item, two free revision rounds ($10 each after), balance due after mockup approval, ships internationally. The Fursona Bar tee and the posters are ready-made, not commissions.
- Category ids match the original: jersey, tops, outerwear, bottoms, underwear, footwear, headwear, accessories, drinkware, home, pets, posters. Variable pricing: Zip Hoodie ($95, $105 from 2XL), Sherpa Blanket ($55 / $65 / $85), posters ($19.99 / $26.99 / $34.99).
- Photos are the original Printful-style mockups, resized to about 1000px.

## Not carried over from the original store (next agent)
- Commission checkout: the deposit flow, custom-details fields (jersey name/number, bar tee fields), ref-sheet upload, multi-currency (USD/EUR/CAD) with tax (8% US, 21% EU VAT, 13% CAD GST/HST), Venmo / Cash App / PayPal handling, EmailJS and Formspree. This preview has a plain cart only.
- Size charts, the poster "Buy on Printful" links, and the original FAQ page.
- Stock flags are all "in stock" and SKUs are invented.

## Placeholders (do not ship as fact)
- Ratings, review counts, wishlist hearts and "42 products" style counts from the mockups are intentionally not built.
- Home page headline and about copy are from the design mockups; confirm before launch.

## Not built (next agent)
1. Checkout (button disabled): order creation, payment provider, tax, shipping.
2. Fulfillment: print-partner order submission, webhooks, tracking.
3. Inquiry file upload (form takes a link) and an admin review queue.
4. Accounts, saved carts, wishlist.
5. Real inventory and variant-level images.
6. Search is client-side name/category match; move server-side if the catalog grows.

## Behaviors working
Category sidebar, price cap, color and size filters, search from the header, sort, grid/list toggle, product gallery thumbnails, color/size/quantity selection with sold-out states, add to cart with mini-cart, cart page with quantity steppers/remove/subtotal, persisted cart, custom print inquiry with validation and confirmation, newsletter validation, mobile menu and collapsible filters, focus styles, reduced-motion respected.
