# Todo Database (MongoDB) - Data Model, Indexing, and Seeding

This document describes the MongoDB collections used by the Todo application. It includes field definitions (types and required/optional), how subtasks are modeled using `parent_id`, recommended indexes to support sorting/search/filtering, and sample documents and index creation statements.

Environment variables (from the database container definition):
- MONGODB_URL: connection URL (example: mongodb://user:pass@localhost:5000/?authSource=admin)
- MONGODB_DB: target database name (example: myapp)

Example connect command (adjust to your environment):
- mongosh "$MONGODB_URL" --eval "db = db.getSiblingDB('$MONGODB_DB'); db.getName();"

Quick seeding for demo/validation:
- Seed script path: `todo_database/seed_sample_data.js` (Node.js)
- Requirements: Node.js runtime. The script depends on `mongodb` driver (installed via `npm i` in `todo_database/`).
- It reads `MONGODB_URL` and `MONGODB_DB` from environment; if not set, it attempts to load from `db_visualizer/mongodb.env`.

Usage:
1) Ensure MongoDB is running (e.g., run `startup.sh` in this folder first).
2) Set environment variables:
   export MONGODB_URL="mongodb://appuser:dbuser123@localhost:5000/?authSource=admin"
   export MONGODB_DB="myapp"
3) Install deps and run:
   cd todo_database
   npm install
   npm run seed

Notes:
- The seed script upserts a demo user (email: demo.user@example.com) with a pre-hashed bcrypt password ("Password123!").
- It creates required indexes and inserts a parent task with several subtasks.
- Re-running the seed is safe: it removes previously inserted sample tasks tagged with `sample_seed` before inserting again.

--------------------------------------------------------------------------------
1) Collections Overview
--------------------------------------------------------------------------------

Two primary collections:
- users: Stores end user accounts and profile settings.
- tasks: Stores tasks and subtasks. Subtasks are modeled via a `parent_id` field referencing another document in the same collection.

--------------------------------------------------------------------------------
2) users Collection
--------------------------------------------------------------------------------

Purpose: Represents an application user.

Fields:
- _id: ObjectId (MongoDB-generated primary key)
- email: string (required, unique, lowercase) – used for login
- password_hash: string (required) – store a secure hash (e.g., bcrypt), not raw passwords
- display_name: string (optional)
- status: string (optional, default "active") – recommended values: "active", "disabled"
- settings: object (optional) – e.g., { timezone: "UTC", theme: "dark" }
  - settings.timezone: string (optional)
  - settings.theme: string (optional; e.g., "dark" or "light")
- created_at: Date (required) – when the account was created
- last_login_at: Date (optional)

Example document:
{
  _id: ObjectId("65f1c8a0a0a0a0a0a0a0a0a0"),
  email: "jane.doe@example.com",
  password_hash: "$2b$10$abcdefg...hashed...",
  display_name: "Jane Doe",
  status: "active",
  settings: {
    timezone: "America/New_York",
    theme: "dark"
  },
  created_at: ISODate("2025-01-01T12:00:00Z"),
  last_login_at: ISODate("2025-01-05T09:15:00Z")
}

Recommended indexes:
- Unique index for login
  db.users.createIndex({ email: 1 }, { unique: true, name: "ux_users_email" })
- Creation time index for admin/listing
  db.users.createIndex({ created_at: -1 }, { name: "ix_users_created_at_desc" })

--------------------------------------------------------------------------------
3) tasks Collection
--------------------------------------------------------------------------------

Purpose: Stores tasks and subtasks; subtasks are modeled hierarchically using `parent_id`.

Fields:
- _id: ObjectId (MongoDB-generated primary key)
- user_id: ObjectId (required) – references users._id; all tasks belong to a user
- title: string (required) – short description
- description: string (optional) – long description/notes (searchable)
- priority: int (optional, default 3) – recommended scale: 1 (low), 2, 3 (normal), 4, 5 (high)
- estimated_minutes: int (optional) – estimated time to complete
- due_at: Date (optional) – due date/time
- completed: boolean (required, default false)
- completed_at: Date (optional) – when completed
- parent_id: ObjectId (optional/null) – references tasks._id to model a subtask; omit or set to null for top-level tasks
- tags: array<string> (optional) – e.g., ["work", "urgent"]
- created_at: Date (required) – when created
- updated_at: Date (required) – when last updated

Notes on subtasks and parent_id:
- A subtask is any task document where parent_id holds the ObjectId of another task in the same collection.
- Inheritance (at creation time): By default, subtasks should copy these values from the parent if not explicitly specified:
  - user_id (always same as parent)
  - priority
  - due_at
  - tags (can be copied or initialized as empty; copying supports filter consistency)
- There is no hard enforcement in MongoDB; the backend should implement this behavior when creating subtasks.

Example top-level task:
{
  _id: ObjectId("65f1c8a0b1b1b1b1b1b1b1b1"),
  user_id: ObjectId("65f1c8a0a0a0a0a0a0a0a0a0"),
  title: "Plan quarterly roadmap",
  description: "Outline Q2 initiatives and milestones.",
  priority: 4,
  estimated_minutes: 180,
  due_at: ISODate("2025-03-31T23:59:59Z"),
  completed: false,
  parent_id: null,
  tags: ["work", "planning"],
  created_at: ISODate("2025-01-02T08:00:00Z"),
  updated_at: ISODate("2025-01-02T08:00:00Z")
}

Example subtask:
{
  _id: ObjectId("65f1c8a0c2c2c2c2c2c2c2c2"),
  user_id: ObjectId("65f1c8a0a0a0a0a0a0a0a0a0"),   // same as parent
  title: "Draft OKRs",
  description: "Create first pass of OKRs.",
  priority: 4,                                    // inherited from parent if not set
  estimated_minutes: 60,
  due_at: ISODate("2025-03-15T12:00:00Z"),        // inherited from parent if not set
  completed: false,
  parent_id: ObjectId("65f1c8a0b1b1b1b1b1b1b1b1"),
  tags: ["work", "planning"],
  created_at: ISODate("2025-01-02T08:30:00Z"),
  updated_at: ISODate("2025-01-02T08:30:00Z")
}

Recommended indexes (create in this order for common queries):
- Base filter by user and creation time (default recent lists)
  db.tasks.createIndex(
    { user_id: 1, created_at: -1 },
    { name: "ix_tasks_user_created_desc" }
  )

- Parent-child relations (fetch subtasks by parent)
  db.tasks.createIndex(
    { user_id: 1, parent_id: 1, created_at: 1 },
    { name: "ix_tasks_user_parent_created" }
  )

- Open vs completed filter
  db.tasks.createIndex(
    { user_id: 1, completed: 1, created_at: -1 },
    { name: "ix_tasks_user_completed_created" }
  )

- Sorting by due date (open tasks first)
  db.tasks.createIndex(
    { user_id: 1, completed: 1, due_at: 1 },
    { name: "ix_tasks_user_completed_due" }
  )

- Sorting by priority, and filtering by completion
  db.tasks.createIndex(
    { user_id: 1, completed: 1, priority: -1, due_at: 1 },
    { name: "ix_tasks_user_completed_priority_due" }
  )

- Text search on title/description (with weights to prioritize title)
  db.tasks.createIndex(
    { title: "text", description: "text" },
    { name: "tx_tasks_title_description", weights: { title: 5, description: 1 } }
  )

Notes:
- Filtering is typically scoped to a single user, so compound indexes start with { user_id: 1, ... }.
- If you frequently list only root tasks (parent_id null), you can add a partial index:
  db.tasks.createIndex(
    { user_id: 1, due_at: 1 },
    { name: "ix_tasks_roots_user_due", partialFilterExpression: { parent_id: { $eq: null } } }
  )

--------------------------------------------------------------------------------
4) Example Queries (reference)
--------------------------------------------------------------------------------

- List root tasks for a user, open first, soonest due:
  db.tasks.find(
    { user_id: ObjectId("..."), parent_id: null, completed: false }
  ).sort({ due_at: 1 })

- Fetch subtasks for a specific parent:
  db.tasks.find(
    { user_id: ObjectId("..."), parent_id: ObjectId("...") }
  ).sort({ created_at: 1 })

- Search by text (title/description):
  db.tasks.find(
    { $text: { $search: "OKRs roadmap" }, user_id: ObjectId("...") }
  ).project({ score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } })

- Sort by priority (desc), then by due date:
  db.tasks.find(
    { user_id: ObjectId("..."), completed: false }
  ).sort({ priority: -1, due_at: 1 })

--------------------------------------------------------------------------------
5) Sample Seed (mongosh) - Optional
--------------------------------------------------------------------------------

You can run this from mongosh against your target database (replace IDs or fetch the inserted IDs programmatically).

// Connect (example):
// mongosh "$MONGODB_URL"
// use myapp

// Create users
const janeId = db.users.insertOne({
  email: "jane.doe@example.com",
  password_hash: "$2b$10$abcdefg...hashed...", // placeholder
  display_name: "Jane Doe",
  status: "active",
  settings: { timezone: "America/New_York", theme: "dark" },
  created_at: new Date(),
  last_login_at: null
}).insertedId;

const johnId = db.users.insertOne({
  email: "john.smith@example.com",
  password_hash: "$2b$10$hijklmn...hashed...",
  display_name: "John Smith",
  status: "active",
  settings: { timezone: "UTC", theme: "light" },
  created_at: new Date(),
  last_login_at: null
}).insertedId;

// Create indexes
db.users.createIndex({ email: 1 }, { unique: true, name: "ux_users_email" });
db.users.createIndex({ created_at: -1 }, { name: "ix_users_created_at_desc" });

db.tasks.createIndex({ user_id: 1, created_at: -1 }, { name: "ix_tasks_user_created_desc" });
db.tasks.createIndex({ user_id: 1, parent_id: 1, created_at: 1 }, { name: "ix_tasks_user_parent_created" });
db.tasks.createIndex({ user_id: 1, completed: 1, created_at: -1 }, { name: "ix_tasks_user_completed_created" });
db.tasks.createIndex({ user_id: 1, completed: 1, due_at: 1 }, { name: "ix_tasks_user_completed_due" });
db.tasks.createIndex({ user_id: 1, completed: 1, priority: -1, due_at: 1 }, { name: "ix_tasks_user_completed_priority_due" });
db.tasks.createIndex({ title: "text", description: "text" }, { name: "tx_tasks_title_description", weights: { title: 5, description: 1 } });

// Insert tasks for Jane (one parent and two subtasks)
const parentTaskId = db.tasks.insertOne({
  user_id: janeId,
  title: "Plan quarterly roadmap",
  description: "Outline Q2 initiatives and milestones.",
  priority: 4,
  estimated_minutes: 180,
  due_at: new Date("2025-03-31T23:59:59Z"),
  completed: false,
  parent_id: null,
  tags: ["work", "planning"],
  created_at: new Date(),
  updated_at: new Date()
}).insertedId;

db.tasks.insertMany([
  {
    user_id: janeId,
    title: "Draft OKRs",
    description: "Create first pass of OKRs.",
    priority: 4,
    estimated_minutes: 60,
    due_at: new Date("2025-03-15T12:00:00Z"),
    completed: false,
    parent_id: parentTaskId,
    tags: ["work", "planning"],
    created_at: new Date(),
    updated_at: new Date()
  },
  {
    user_id: janeId,
    title: "Collect input from team",
    description: "Get feedback from stakeholders.",
    priority: 4,
    estimated_minutes: 45,
    due_at: new Date("2025-03-20T17:00:00Z"),
    completed: false,
    parent_id: parentTaskId,
    tags: ["work", "planning"],
    created_at: new Date(),
    updated_at: new Date()
  }
]);

// Insert tasks for John (root tasks only)
db.tasks.insertMany([
  {
    user_id: johnId,
    title: "Grocery shopping",
    description: "Buy ingredients for the week.",
    priority: 2,
    estimated_minutes: 90,
    due_at: new Date("2025-02-01T17:00:00Z"),
    completed: false,
    parent_id: null,
    tags: ["personal", "errands"],
    created_at: new Date(),
    updated_at: new Date()
  },
  {
    user_id: johnId,
    title: "Read a book",
    description: "Finish current novel.",
    priority: 1,
    estimated_minutes: 120,
    due_at: null,
    completed: false,
    parent_id: null,
    tags: ["personal"],
    created_at: new Date(),
    updated_at: new Date()
  }
]);

--------------------------------------------------------------------------------
6) Optional: Collection Validation (JSON Schema)
--------------------------------------------------------------------------------

While not required, you can add basic schema validation to catch invalid writes:

db.runCommand({
  collMod: "tasks",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["user_id", "title", "completed", "created_at", "updated_at"],
      properties: {
        user_id: { bsonType: "objectId" },
        title: { bsonType: "string", minLength: 1 },
        description: { bsonType: ["string", "null"] },
        priority: { bsonType: ["int", "null"], minimum: 1, maximum: 5 },
        estimated_minutes: { bsonType: ["int", "null"], minimum: 0 },
        due_at: { bsonType: ["date", "null"] },
        completed: { bsonType: "bool" },
        completed_at: { bsonType: ["date", "null"] },
        parent_id: { bsonType: ["objectId", "null"] },
        tags: {
          bsonType: ["array", "null"],
          items: { bsonType: "string" }
        },
        created_at: { bsonType: "date" },
        updated_at: { bsonType: "date" }
      }
    }
  }
});

db.runCommand({
  collMod: "users",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["email", "password_hash", "created_at"],
      properties: {
        email: { bsonType: "string" },
        password_hash: { bsonType: "string" },
        display_name: { bsonType: ["string", "null"] },
        status: { bsonType: ["string", "null"] },
        settings: {
          bsonType: ["object", "null"],
          properties: {
            timezone: { bsonType: ["string", "null"] },
            theme: { bsonType: ["string", "null"] }
          }
        },
        created_at: { bsonType: "date" },
        last_login_at: { bsonType: ["date", "null"] }
      }
    }
  }
});

--------------------------------------------------------------------------------
7) Operational Notes
--------------------------------------------------------------------------------

- Time fields are stored as Date types in UTC.
- Always set created_at and updated_at in the backend; updated_at should change on each modification.
- parent_id should be null (or absent) for root tasks; must be set to a valid tasks._id for subtasks.
- The application should ensure that subtasks share user_id with their parent.
- For full-text search, ensure the text index exists before issuing $text queries.

This README is intended to be sufficient for backend implementation and for manual inspection/troubleshooting using mongosh.
