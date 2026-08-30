import { MongoClient, Db, Collection, ObjectId } from "mongodb";

const uri = process.env.DATABASE_URL;
if (!uri) throw new Error("DATABASE_URL is required");

const globalForMongo = globalThis as unknown as {
  mongoPromise?: Promise<MongoClient>;
};

const clientPromise =
  globalForMongo.mongoPromise ??
  (globalForMongo.mongoPromise = new MongoClient(uri).connect());

export async function getDb(): Promise<AppDb> {
  const client = await clientPromise;
  return client.db(
    process.env.MONGO_DB_NAME ?? "exposure_monitor"
  ) as unknown as AppDb;
}

// Documents in this app use hex-string _ids (ObjectId().toHexString()), so
// the collection generic defaults to a string-id document instead of the
// driver's ObjectId-typed Document — otherwise every _id filter fails
// type-checking.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate: permissive index signature keeps driver filter/insert types workable for hex-string _ids
export type AppDocument = { [key: string]: any; _id?: any };
export type AppDb = Omit<Db, "collection"> & {
  collection<T extends AppDocument = AppDocument>(name: string): Collection<T>;
};

// Typed loosely (any) so it satisfies the driver's ObjectId-oriented
// insertOne/update-filter types without per-call casts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate: hex-string id accepted by driver insert/filter types without per-call casts
export function newId(): any {
  return new ObjectId().toHexString();
}

export { ObjectId };
export type { Collection };