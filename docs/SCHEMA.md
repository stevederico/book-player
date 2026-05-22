# Database Schema

## Overview

Skateboard supports three database types through a unified adapter pattern:
- **SQLite** (default) - File-based, zero configuration
- **PostgreSQL** - Production-ready relational database
- **MongoDB** - Document-based NoSQL database

## Tables/Collections

### Users

Stores user profile and subscription information.

#### SQLite / PostgreSQL

```sql
CREATE TABLE Users (
  _id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  subscription_stripeID TEXT,
  subscription_expires BIGINT,
  subscription_status TEXT,
  usage_count INTEGER DEFAULT 0,
  usage_reset_at BIGINT
);

CREATE UNIQUE INDEX idx_users_email ON Users(email);
```

#### MongoDB

```javascript
{
  _id: String,           // UUID
  email: String,         // Unique
  name: String,
  created_at: Number,    // Unix timestamp
  subscription: {
    stripeID: String,    // Stripe customer ID
    expires: Number,     // Unix timestamp
    status: String       // "active", "canceled", etc.
  },
  usage: {
    count: Number,       // Usage count this period
    reset_at: Number     // When usage resets (Unix timestamp)
  }
}
```

**Note:** SQL databases flatten nested objects (e.g., `subscription.stripeID` → `subscription_stripeID`). Adapters handle transformation.

---

### Guides

Audio guide catalog. One row per playable essay/book. Audio + images live on disk under `backend/public/{audio,images}/`; the row stores URL pointers. Chapters and word timings are JSON-serialized into TEXT columns.

#### SQLite

```sql
CREATE TABLE Guides (
  slug              TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  author            TEXT,
  date              TEXT,
  duration          INTEGER,         -- seconds
  audio_url         TEXT,            -- e.g. /audio/the-brand-age.mp3
  thumbnail         TEXT,            -- e.g. /images/the-brand-age/hero.jpg
  timing_offset     REAL DEFAULT 0,  -- compensates for MP3 encoder delay
  default_view_mode TEXT DEFAULT 'real', -- 'real' | 'generated'
  transcript        TEXT,            -- full essay text
  chapters_json     TEXT NOT NULL,   -- JSON array: [{time,title,quote,image,realImage,caption}, ...]
  timing_json       TEXT,            -- JSON: {words: [{w,t}, ...]} — word-level timestamps
  visibility        TEXT DEFAULT 'public', -- 'public' | 'private'
  created_by        TEXT,            -- FK Users._id (nullable)
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_guides_visibility ON Guides(visibility);
CREATE INDEX idx_guides_author     ON Guides(author);
```

#### Field Notes

| Field | Notes |
|---|---|
| `slug` | Kebab-case, `^[a-z0-9-]+$`. Also the on-disk file stem (`<slug>.mp3`). |
| `chapters_json` | Required (`[]` for guides without chapters). Each chapter: `{time: seconds, title, quote, image?, realImage?, caption?, photoLink?, photoLabel?}`. |
| `timing_json` | Nullable. Shape: `{words: [{w: "spoken text", t: 0.42}, ...]}`. Drives word-level highlight + captions overlay. |
| `timing_offset` | Added to every word timestamp client-side. Compensates for MP3 encoder padding (~50-150 ms is typical). |
| `default_view_mode` | Controls whether the player loads `image.generated` or `realImage` first. |
| `visibility` | `GET /api/guides` filters to `public`. `private` rows are hidden from listings and detail. |

---

### Auths

Stores authentication credentials separately from user data.

#### SQLite / PostgreSQL

```sql
CREATE TABLE Auths (
  email TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  userID TEXT NOT NULL REFERENCES Users(_id)
);
```

#### MongoDB

```javascript
{
  email: String,    // Primary key
  password: String, // bcrypt hash
  userID: String    // Reference to Users._id
}
```

---

## Field Descriptions

### Users Table

| Field | Type | Description |
|-------|------|-------------|
| `_id` | String (UUID) | Unique identifier |
| `email` | String | User's email (unique) |
| `name` | String | Display name |
| `created_at` | Unix timestamp | Account creation time |
| `subscription.stripeID` | String | Stripe customer ID |
| `subscription.expires` | Unix timestamp | When subscription ends |
| `subscription.status` | String | Stripe subscription status |
| `usage.count` | Integer | Actions used this period |
| `usage.reset_at` | Unix timestamp | When usage counter resets |

### Auths Table

| Field | Type | Description |
|-------|------|-------------|
| `email` | String | User's email (primary key) |
| `password` | String | bcrypt hash (10 rounds) |
| `userID` | String | Reference to Users._id |

---

## Subscription Status Values

| Status | Description |
|--------|-------------|
| `active` | Subscription is active and paid |
| `canceled` | Canceled but access until period ends |
| `past_due` | Payment failed, grace period |
| `unpaid` | Payment failed, access revoked |
| `trialing` | In trial period |

---

## Usage Tracking

Free users have a monthly usage limit (default: 20).

- `usage.count` - Incremented on each tracked action
- `usage.reset_at` - Set to 30 days after first action
- When `now > reset_at`, counter resets to 0
- Subscribers (`subscription.status === 'active'`) get unlimited usage

---

## Database Configuration

Configuration in `backend/config.json`:

```json
{
  "database": {
    "db": "MyApp",
    "dbType": "sqlite",
    "connectionString": "./databases/MyApp.db"
  }
}
```

### Connection Strings

**SQLite:**
```
./databases/MyApp.db
```

**PostgreSQL:**
```
postgresql://user:password@localhost:5432/myapp
${DATABASE_URL}
```

**MongoDB:**
```
mongodb://localhost:27017
${MONGODB_URL}
```

Environment variable syntax `${VAR_NAME}` is supported for production deployments.

---

## Indexes

### Recommended Indexes

```sql
-- Users table
CREATE UNIQUE INDEX idx_users_email ON Users(email);
CREATE INDEX idx_users_subscription ON Users(subscription_status);

-- Auths table
CREATE INDEX idx_auths_userid ON Auths(userID);

-- Guides table
CREATE INDEX idx_guides_visibility ON Guides(visibility);
CREATE INDEX idx_guides_author     ON Guides(author);
```

MongoDB automatically indexes `_id`. Create email index:

```javascript
db.Users.createIndex({ email: 1 }, { unique: true });
```

---

## Data Transformation

Adapters transform between nested and flat structures:

**API Response (nested):**
```json
{
  "subscription": {
    "stripeID": "cus_xxx",
    "status": "active"
  }
}
```

**SQL Storage (flat):**
```sql
subscription_stripeID = 'cus_xxx'
subscription_status = 'active'
```

This is handled automatically by the database adapters in `backend/adapters/`.

---

## Migration Notes

When switching database types:

1. Export data from current database
2. Transform nested ↔ flat structure as needed
3. Import to new database
4. Update `config.json` with new `dbType` and `connectionString`

The adapter pattern ensures API compatibility regardless of database backend.
