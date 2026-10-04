import { MongoClient } from "mongodb";

let client;
let database;

export async function db() {
  if (!database) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI environment variable is not defined");
    }
    if (!client) {
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000,
      });
    }
    await client.connect();
    database = client.db(process.env.MONGODB_DB || "avexora_examos");
  }
  return database;
}

export async function getClient() {
  if (!client) {
    await db();
  }
  return client;
}
