// Entry shim: registers the alias resolver before the script's own imports run.
import { register } from "node:module";
register("./alias-hooks.mjs", import.meta.url);
