import { openDatabase, dataDirectory } from "../src/lib/db.ts";
import { initWorkflow } from "../src/lib/workflow/store.ts";
const db = openDatabase();
db.close();
initWorkflow();
console.log(`SQLite initialized: ${dataDirectory()}`);
