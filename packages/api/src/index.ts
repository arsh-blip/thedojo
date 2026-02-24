import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from the monorepo root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { app } from "./app.js";

const PORT = process.env.API_PORT || 3001;

app.listen(PORT, () => {
  console.log(`The Dojo API server running on http://localhost:${PORT}`);
});
