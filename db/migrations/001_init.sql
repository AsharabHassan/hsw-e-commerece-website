-- Harley Street Wellness store — initial schema.
--
-- Money is INTEGER PENCE throughout. There are no floats in this schema and
-- there must never be: 0.1 + 0.2 is not 0.3, and a shop that rounds money
-- wrongly is a shop that gets its accounts qualified.

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table categories (
  id        serial primary key,
  slug      text not null unique,
  name      text not null,
  blurb     text,
  sort      integer not null default 0
);

create table products (
  id               serial primary key,
  slug             text not null unique,
  name             text not null,
  subtitle         text,
  category_id      integer references categories(id) on delete set null,

  price_pence      integer not null check (price_pence >= 0),

  summary          text,

  -- Ordered array of typed content blocks; see lib/sanitize.js for the
  -- accepted shapes. This is what lets one template render both the bespoke
  -- Urolithin A page and an ordinary product page.
  story_blocks     jsonb not null default '[]'::jsonb,

  meta_description text,

  is_published     boolean not null default false,

  -- A seeded demo product. Renders a visible "not for sale" badge and cannot
  -- be added to a basket. Cleared by the operator in the admin panel once the
  -- real copy, price and compliance checks are in.
  is_placeholder   boolean not null default true,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index products_published_idx on products (is_published);
create index products_category_idx  on products (category_id);

create table product_images (
  id         serial primary key,
  product_id integer not null references products(id) on delete cascade,
  path       text not null,
  alt        text not null default '',
  sort       integer not null default 0
);

create index product_images_product_idx on product_images (product_id, sort);

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table users (
  id            serial primary key,
  -- Stored lower-cased by the model; citext is not available in PGlite.
  email         text not null unique,
  password_hash text not null,
  name          text not null default '',
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table sessions (
  sid    text primary key,
  sess   jsonb not null,
  expire timestamptz not null
);

create index sessions_expire_idx on sessions (expire);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table orders (
  id                   serial primary key,

  -- Unguessable identifier used in customer-facing URLs, so a guest can see
  -- their order without an account and nobody can enumerate orders by id.
  public_token         text not null unique,

  -- Null for guest checkout. Backfilled if the guest later registers with the
  -- same email address.
  user_id              integer references users(id) on delete set null,

  email                text not null,

  status               text not null default 'pending'
                       check (status in ('pending','paid','shipped','cancelled','refunded')),

  subtotal_pence       integer not null check (subtotal_pence >= 0),
  shipping_pence       integer not null default 0 check (shipping_pence >= 0),
  total_pence          integer not null check (total_pence >= 0),

  ship_name            text not null,
  ship_line1           text not null,
  ship_line2           text,
  ship_city            text not null,
  ship_postcode        text not null,
  ship_country         text not null default 'GB',
  ship_phone           text,

  stripe_session_id    text,
  stripe_payment_intent text,

  created_at           timestamptz not null default now(),
  paid_at              timestamptz
);

create index orders_user_idx    on orders (user_id);
create index orders_email_idx   on orders (email);
create index orders_status_idx  on orders (status);
create index orders_created_idx on orders (created_at desc);

create table order_items (
  id                serial primary key,
  order_id          integer not null references orders(id) on delete cascade,

  -- Nullable so deleting a product never destroys order history.
  product_id        integer references products(id) on delete set null,

  -- Snapshots. Editing a product must never rewrite what a customer was
  -- charged or what they were told they were buying.
  name_snapshot     text not null,
  slug_snapshot     text,
  unit_price_pence  integer not null check (unit_price_pence >= 0),

  qty               integer not null check (qty > 0)
);

create index order_items_order_idx on order_items (order_id);
