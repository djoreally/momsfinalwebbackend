import { handle } from "hono/vercel";
import { app } from "../apps/api/src/app.js";

export const runtime = "nodejs";

export default handle(app);
