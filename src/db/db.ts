import {readFileSync} from "node:fs";
import {join} from "node:path";
import initSqlJs, {Database, SqlJsStatic} from "sql.js";

let SQL: SqlJsStatic | null = null;

export async function createDb(): Promise<Database> {
  if (!SQL) {
    SQL = await initSqlJs();
  }

  const db = new SQL.Database();
  const schema = readFileSync(join(process.cwd(), "src/db/schema.sql"), "utf8");
  db.run(schema);
  return db;
}
