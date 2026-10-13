-- Erbil Delivery World: initial schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE admin_users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
  token_hash  text PRIMARY KEY,
  admin_id    int NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE TABLE categories (
  id                    serial PRIMARY KEY,
  slug                  text NOT NULL UNIQUE,
  name_ar               text NOT NULL,
  name_en               text NOT NULL,
  default_building_type text NOT NULL CHECK (default_building_type IN ('restaurant','shop','factory','warehouse','office')),
  color                 text NOT NULL DEFAULT '#2563eb',
  sort                  int NOT NULL DEFAULT 0,
  archived              boolean NOT NULL DEFAULT false
);

-- Logos, covers and gallery pictures live in the database, so they persist
-- with the rest of the data on any host without a separate object store.
CREATE TABLE images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mime        text NOT NULL,
  bytes       bytea NOT NULL,
  size        int NOT NULL,
  sha256      text NOT NULL,
  width       int,
  height      int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchants (
  id               serial PRIMARY KEY,
  code             text NOT NULL UNIQUE,
  name_ar          text NOT NULL,
  name_en          text NOT NULL,
  category_id      int NOT NULL REFERENCES categories(id),
  description_ar   text NOT NULL DEFAULT '',
  description_en   text NOT NULL DEFAULT '',
  address_ar       text NOT NULL DEFAULT '',
  address_en       text NOT NULL DEFAULT '',
  lat              double precision NOT NULL,
  lng              double precision NOT NULL,
  entrance_lat     double precision NOT NULL,
  entrance_lng     double precision NOT NULL,
  pickup_lat       double precision NOT NULL,
  pickup_lng       double precision NOT NULL,
  dropoff_lat      double precision NOT NULL,
  dropoff_lng      double precision NOT NULL,
  building_type    text NOT NULL CHECK (building_type IN ('restaurant','shop','factory','warehouse','office')),
  sign_size        text NOT NULL DEFAULT 'medium' CHECK (sign_size IN ('small','medium','large')),
  sign_position    text NOT NULL DEFAULT 'front' CHECK (sign_position IN ('front','roof','pylon')),
  brand_color      text NOT NULL DEFAULT '#1d4ed8',
  logo_image_id    uuid REFERENCES images(id) ON DELETE SET NULL,
  cover_image_id   uuid REFERENCES images(id) ON DELETE SET NULL,
  hours            jsonb,
  phone            text NOT NULL DEFAULT '',
  website          text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','archived')),
  interior_enabled boolean NOT NULL DEFAULT false,
  is_fictional     boolean NOT NULL DEFAULT true,
  notes            text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchants_status_idx ON merchants(status);

CREATE TABLE merchant_gallery (
  merchant_id int NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  image_id    uuid NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  sort        int NOT NULL DEFAULT 0,
  PRIMARY KEY (merchant_id, image_id)
);

CREATE TABLE menu_items (
  id             serial PRIMARY KEY,
  merchant_id    int NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name_ar        text NOT NULL,
  name_en        text NOT NULL,
  description_ar text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  price_iqd      int,
  sort           int NOT NULL DEFAULT 0
);
CREATE INDEX menu_items_merchant_idx ON menu_items(merchant_id);

CREATE TABLE packages (
  id                    serial PRIMARY KEY,
  slug                  text NOT NULL UNIQUE,
  name_ar               text NOT NULL,
  name_en               text NOT NULL,
  description_ar        text NOT NULL DEFAULT '',
  description_en        text NOT NULL DEFAULT '',
  price_usd             numeric(10,2) NOT NULL DEFAULT 0,
  period                text NOT NULL DEFAULT 'month',
  features              jsonb NOT NULL DEFAULT '[]',
  benefits              jsonb NOT NULL DEFAULT '{}',
  location_limit        int NOT NULL DEFAULT 1,
  featured_limit        int NOT NULL DEFAULT 0,
  eligible_category_ids int[] NOT NULL DEFAULT '{}',
  default_duration_days int NOT NULL DEFAULT 30,
  active                boolean NOT NULL DEFAULT true,
  sort                  int NOT NULL DEFAULT 0
);

CREATE TABLE sponsorships (
  id          serial PRIMARY KEY,
  merchant_id int NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  package_id  int NOT NULL REFERENCES packages(id),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX sponsorships_merchant_idx ON sponsorships(merchant_id);

CREATE TABLE missions (
  id                      serial PRIMARY KEY,
  code                    text NOT NULL UNIQUE,
  type                    text NOT NULL CHECK (type IN ('restaurant_order','retail_parcel','warehouse_shipment','document_delivery','b2b_parcel','interior_pickup')),
  title_ar                text NOT NULL,
  title_en                text NOT NULL,
  origin_merchant_id      int NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  destination_merchant_id int REFERENCES merchants(id) ON DELETE CASCADE,
  destination_lat         double precision,
  destination_lng         double precision,
  destination_label_ar    text NOT NULL DEFAULT '',
  destination_label_en    text NOT NULL DEFAULT '',
  package_ar              text NOT NULL DEFAULT '',
  package_en              text NOT NULL DEFAULT '',
  details                 jsonb NOT NULL DEFAULT '{}',
  time_limit_s            int CHECK (time_limit_s IS NULL OR time_limit_s > 0),
  reward_coins            int NOT NULL CHECK (reward_coins >= 0),
  reward_xp               int NOT NULL CHECK (reward_xp >= 0),
  branded                 boolean NOT NULL DEFAULT false,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (destination_merchant_id IS NOT NULL OR (destination_lat IS NOT NULL AND destination_lng IS NOT NULL))
);

CREATE TABLE players (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash        text NOT NULL UNIQUE,
  display_name      text NOT NULL,
  xp                int NOT NULL DEFAULT 0,
  level             int NOT NULL DEFAULT 1,
  coins             int NOT NULL DEFAULT 0,
  deliveries        int NOT NULL DEFAULT 0,
  vehicle           text NOT NULL DEFAULT 'motorcycle',
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mission_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  mission_id     int NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  status         text NOT NULL CHECK (status IN ('accepted','going_to_pickup','collected','going_to_destination','delivered','cancelled')),
  -- snapshot of the mission at acceptance, so an admin edit mid-run cannot move the goalposts
  pickup_lat     double precision NOT NULL,
  pickup_lng     double precision NOT NULL,
  dropoff_lat    double precision NOT NULL,
  dropoff_lng    double precision NOT NULL,
  est_distance_m int NOT NULL,
  reward_coins   int NOT NULL,
  reward_xp      int NOT NULL,
  bonus_coins    int NOT NULL DEFAULT 0,
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  collected_at   timestamptz,
  delivered_at   timestamptz,
  cancelled_at   timestamptz,
  deadline_at    timestamptz
);
-- at most one unfinished run per player
CREATE UNIQUE INDEX mission_runs_one_active ON mission_runs(player_id)
  WHERE status IN ('accepted','going_to_pickup','collected','going_to_destination');
CREATE INDEX mission_runs_player_idx ON mission_runs(player_id, accepted_at DESC);

-- One row per reward ever paid. The unique keys are what make a second claim impossible.
CREATE TABLE rewards (
  id            bigserial PRIMARY KEY,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  run_id        uuid UNIQUE REFERENCES mission_runs(id) ON DELETE CASCADE,
  challenge_key text,
  coins         int NOT NULL,
  xp            int NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, challenge_key)
);

CREATE TABLE player_achievements (
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  code        text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, code)
);

CREATE TABLE player_discoveries (
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  merchant_id   int NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, merchant_id)
);

CREATE TABLE analytics_events (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('profile_view','map_discovery','mission_offer','mission_accept','mission_complete')),
  merchant_id int REFERENCES merchants(id) ON DELETE CASCADE,
  mission_id  int REFERENCES missions(id) ON DELETE SET NULL,
  player_id   uuid REFERENCES players(id) ON DELETE SET NULL,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_merchant_idx ON analytics_events(merchant_id, type, created_at);
CREATE INDEX analytics_events_created_idx ON analytics_events(created_at);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  admin_id   int REFERENCES admin_users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  details    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_state (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
