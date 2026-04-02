import { MongoClient } from 'mongodb';

let client = null;
let testDataDb = null;

/**
 * Get (or create) a shared MongoClient connection.
 * Returns the TestData database handle by default.
 */
export async function getTestDataDb() {
  if (testDataDb) return testDataDb;

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not configured');

  client = new MongoClient(uri);
  await client.connect();
  testDataDb = client.db('TestData');
  console.log('MongoDB connected: TestData');
  return testDataDb;
}

/**
 * Get a database handle by name on the same connection.
 */
export async function getDb(dbName) {
  if (!client) {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI not configured');
    client = new MongoClient(uri);
    await client.connect();
  }
  return client.db(dbName);
}

/**
 * Graceful shutdown.
 */
export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    testDataDb = null;
  }
}
