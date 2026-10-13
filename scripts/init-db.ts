import { openDatabase, dataDirectory } from "../src/lib/db.ts";
const db = openDatabase();
db.close();
console.log(`SQLite initialized: ${dataDirectory()}`);
