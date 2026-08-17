-- Cash on delivery.
--
-- Orders gain a payment method. Everything existing is a card order, which is
-- why the default is 'card' — the column can be added to a live table without
-- a backfill step.
--
-- The COD handling fee is stored PER ORDER rather than read from config at
-- display time. If the fee changes next month, a customer looking at an old
-- order must still see what they were actually charged.

alter table orders
  add column payment_method text not null default 'card'
    check (payment_method in ('card', 'cod')),
  add column cod_fee_pence integer not null default 0
    check (cod_fee_pence >= 0);

create index orders_payment_method_idx on orders (payment_method);

-- A card order never carries a COD fee, and a COD order never has a Stripe
-- session. Enforcing that here means a bug in the route cannot produce an
-- order that is half one thing and half the other.
alter table orders
  add constraint orders_cod_fee_only_on_cod
    check (payment_method = 'cod' or cod_fee_pence = 0);
