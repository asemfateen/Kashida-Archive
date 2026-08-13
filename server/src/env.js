import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

// Load server/.env regardless of the process cwd (npm start runs from the repo root).
// Existing process env vars are never overridden.
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
