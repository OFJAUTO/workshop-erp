// node --import ./tests/unit/register.mjs tests/unit/<test>.mjs  - runs our TypeScript directly (see hooks.mjs).
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
