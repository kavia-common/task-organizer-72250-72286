#!/usr/bin/env node
/**
 * Seed sample data for the Todo app into MongoDB.
 *
 * This script:
 * - Reads MongoDB connection info from environment variables:
 *   - MONGODB_URL: e.g. mongodb://user:pass@localhost:5000/?authSource=admin
 *   - MONGODB_DB: database name e.g. myapp
 *   If not present, it attempts to load from ./db_visualizer/mongodb.env (export VAR="...").
 *
 * - Creates required indexes on users and tasks collections.
 * - Upserts a demo user with a pre-hashed password (bcrypt hash string).
 * - Inserts a parent task and multiple subtasks for the demo user.
 * - Is idempotent: previous sample seed tasks (tagged with "sample_seed") are deleted before inserting again.
 *
 * Usage:
 *   # Ensure MongoDB is running and accessible.
 *   # Option 1: Provide environment variables
 *   MONGODB_URL="mongodb://appuser:dbuser123@localhost:5000/?authSource=admin" \
 *   MONGODB_DB="myapp" \
 *   node seed_sample_data.js
 *
 *   # Option 2: Source db_visualizer/mongodb.env (created by startup.sh)
 *   source db_visualizer/mongodb.env
 *   npm run seed    # if using package.json provided alongside this script
 *
 * Note: This script only writes text values and dates; the password is a precomputed bcrypt hash
 *       (so there is no need to install bcrypt to run the seeding).
 */

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

// Helpers to load env vars from db_visualizer/mongodb.env if not already set
function loadEnvFallback() {
  const envPath = path.join(__dirname, 'db_visualizer', 'mongodb.env');
  if (!fs.existsSync(envPath)) return;

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('export ')) return;
      const exportLine = trimmed.substring(7);
      const [key, ...valueParts] = exportLine.split('=');
      if (!key || valueParts.length === 0) return;
      let value = valueParts.join('=');
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    });
    console.log('✓ Loaded env from db_visualizer/mongodb.env');
  } catch (err) {
    console.warn('⚠ Failed to load db_visualizer/mongodb.env:', err.message);
  }
}

if (!process.env.MONGODB_URL || !process.env.MONGODB_DB) {
  loadEnvFallback();
}

const MONGODB_URL = process.env.MONGODB_URL;
const MONGODB_DB = process.env.MONGODB_DB;

if (!MONGODB_URL || !MONGODB_DB) {
  console.error('ERROR: MONGODB_URL and MONGODB_DB environment variables are required.');
  console.error('Example:');
  console.error('  export MONGODB_URL="mongodb://appuser:dbuser123@localhost:5000/?authSource=admin"');
  console.error('  export MONGODB_DB="myapp"');
  process.exit(1);
}

// PUBLIC_INTERFACE
async function run() {
  /** Seed entrypoint for inserting demo user and sample tasks into MongoDB. */
  const client = new MongoClient(MONGODB_URL);
  try {
    await client.connect();
    const db = client.db(MONGODB_DB);
    const users = db.collection('users');
    const tasks = db.collection('tasks');

    console.log(`Connected to MongoDB -> ${MONGODB_URL}`);
    console.log(`Using database -> ${MONGODB_DB}`);

    // Ensure indexes (users)
    await users.createIndex({ email: 1 }, { unique: true, name: 'ux_users_email' });
    await users.createIndex({ created_at: -1 }, { name: 'ix_users_created_at_desc' });

    // Ensure indexes (tasks) - follow README recommendations
    await tasks.createIndex({ user_id: 1, created_at: -1 }, { name: 'ix_tasks_user_created_desc' });
    await tasks.createIndex(
      { user_id: 1, parent_id: 1, created_at: 1 },
      { name: 'ix_tasks_user_parent_created' }
    );
    await tasks.createIndex(
      { user_id: 1, completed: 1, created_at: -1 },
      { name: 'ix_tasks_user_completed_created' }
    );
    await tasks.createIndex(
      { user_id: 1, completed: 1, due_at: 1 },
      { name: 'ix_tasks_user_completed_due' }
    );
    await tasks.createIndex(
      { user_id: 1, completed: 1, priority: -1, due_at: 1 },
      { name: 'ix_tasks_user_completed_priority_due' }
    );
    await tasks.createIndex(
      { title: 'text', description: 'text' },
      { name: 'tx_tasks_title_description', weights: { title: 5, description: 1 } }
    );

    const now = new Date();

    // Upsert a demo user
    const demoEmail = 'demo.user@example.com';

    // A valid bcrypt hash string for the password "Password123!"
    // This is static sample data – no bcrypt dependency required at runtime.
    const demoPasswordHash =
      '$2b$12$KIXQxB7Di1urN6byN1NsxOz3Rp3XIanFkFJxuxMxDPZWS9Vyhi3ya'; // bcrypt("Password123!")

    const upsertUserResult = await users.findOneAndUpdate(
      { email: demoEmail },
      {
        $setOnInsert: {
          email: demoEmail,
          created_at: now,
        },
        $set: {
          password_hash: demoPasswordHash,
          display_name: 'Demo User',
          status: 'active',
          settings: { timezone: 'UTC', theme: 'dark' },
          last_login_at: null,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    // findOneAndUpdate may return different structures depending on driver version; normalize _id
    const demoUser =
      upsertUserResult.value ||
      (await users.findOne({ email: demoEmail }, { projection: { _id: 1 } }));
    if (!demoUser || !demoUser._id) {
      throw new Error('Failed to upsert/find the demo user.');
    }
    const demoUserId = demoUser._id;
    console.log(`✓ Demo user ready -> _id: ${demoUserId.toString()}, email: ${demoEmail}`);

    // Clean existing sample tasks for idempotency (identified by tag "sample_seed")
    const deleteRes = await tasks.deleteMany({
      user_id: demoUserId,
      tags: 'sample_seed',
    });
    if (deleteRes.deletedCount > 0) {
      console.log(`Removed ${deleteRes.deletedCount} existing sample tasks (tag=sample_seed).`);
    }

    // Insert a parent task
    const parentTaskDoc = {
      user_id: demoUserId,
      title: 'Plan quarterly roadmap',
      description: 'Outline Q2 initiatives and milestones.',
      priority: 4,
      estimated_minutes: 180,
      due_at: new Date('2025-03-31T23:59:59Z'),
      completed: false,
      completed_at: null,
      parent_id: null,
      tags: ['work', 'planning', 'sample_seed'],
      created_at: now,
      updated_at: now,
    };

    const parentInsert = await tasks.insertOne(parentTaskDoc);
    const parentTaskId = parentInsert.insertedId;
    console.log(`✓ Inserted parent task -> _id: ${parentTaskId.toString()}`);

    // Insert subtasks with varied fields (inherit some parent attributes)
    const subTasks = [
      {
        user_id: demoUserId,
        title: 'Draft OKRs',
        description: 'Create first pass of OKRs.',
        priority: 4, // inherit parent priority
        estimated_minutes: 60,
        due_at: new Date('2025-03-15T12:00:00Z'), // inherit parent due if not specified
        completed: false,
        completed_at: null,
        parent_id: parentTaskId,
        tags: ['work', 'planning', 'sample_seed'], // inherit parent tags plus seed marker
        created_at: now,
        updated_at: now,
      },
      {
        user_id: demoUserId,
        title: 'Collect input from team',
        description: 'Get feedback from stakeholders.',
        priority: 4,
        estimated_minutes: 45,
        due_at: new Date('2025-03-20T17:00:00Z'),
        completed: false,
        completed_at: null,
        parent_id: parentTaskId,
        tags: ['work', 'planning', 'sample_seed'],
        created_at: now,
        updated_at: now,
      },
      {
        user_id: demoUserId,
        title: 'Finalize roadmap presentation',
        description: 'Finalize deck and review timeline.',
        priority: 5, // higher priority
        estimated_minutes: 90,
        due_at: new Date('2025-03-28T21:00:00Z'),
        completed: false,
        completed_at: null,
        parent_id: parentTaskId,
        tags: ['work', 'planning', 'urgent', 'sample_seed'],
        created_at: now,
        updated_at: now,
      },
    ];

    const subInsert = await tasks.insertMany(subTasks);
    console.log(`✓ Inserted ${subInsert.insertedCount} subtasks`);

    // Insert a couple of root-level tasks
    const rootTasks = [
      {
        user_id: demoUserId,
        title: 'Grocery shopping',
        description: 'Buy ingredients for the week.',
        priority: 2,
        estimated_minutes: 90,
        due_at: new Date('2025-02-01T17:00:00Z'),
        completed: false,
        completed_at: null,
        parent_id: null,
        tags: ['personal', 'errands', 'sample_seed'],
        created_at: now,
        updated_at: now,
      },
      {
        user_id: demoUserId,
        title: 'Read a book',
        description: 'Finish current novel.',
        priority: 1,
        estimated_minutes: 120,
        due_at: null,
        completed: false,
        completed_at: null,
        parent_id: null,
        tags: ['personal', 'sample_seed'],
        created_at: now,
        updated_at: now,
      },
    ];

    const rootInsert = await tasks.insertMany(rootTasks);
    console.log(`✓ Inserted ${rootInsert.insertedCount} root tasks`);

    console.log('\nSeeding complete.');
    console.log('Demo credentials:');
    console.log(`  email: ${demoEmail}`);
    console.log('  password (plaintext for demo): Password123!');
    console.log('\nNote: Password is stored as a bcrypt hash string in the database.');
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  } finally {
    try {
      await client.close();
    } catch (_) {}
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
