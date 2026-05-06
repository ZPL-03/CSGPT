import fs from "fs";
import path from "path";
import { CSGPT_MASKS } from "./csgpt";
import { CSGPT_MASKS_EN } from "./csgpt-en";

import { type BuiltinMask } from "./typing";

const BUILTIN_MASKS: Record<string, BuiltinMask[]> = {
  cn: CSGPT_MASKS,
  en: CSGPT_MASKS_EN,
};

const dirname = path.dirname(__filename);

fs.writeFile(
  dirname + "/../../public/masks.json",
  JSON.stringify(BUILTIN_MASKS, null, 4),
  function (error) {
    if (error) {
      console.error("[Build] failed to build masks", error);
    }
  },
);
